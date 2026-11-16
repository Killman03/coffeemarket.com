"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import {
  useForm,
  useWatch,
  type FieldErrors,
  type FieldPath,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  CircleAlert,
  Coffee,
  FileText,
  LoaderCircle,
  LogOut,
  Save,
  Send,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import { currencies, type Currency } from "../../domain/markets";
import type { CalculatorInput } from "../../domain/calculator";
import {
  siteSettingsSchema,
  settingsEnvelopeSchema,
  buildManagerTelegramUrl,
  type SiteSettings,
  type SettingsEnvelope,
} from "../../domain/site-settings";
import type { z } from "zod";
import styles from "./AdminPanel.module.css";

type Section = "telegram" | "defaults" | "content";
type AdminPanelProps = {
  initial: SettingsEnvelope;
  userDisplayName: string;
  status?: { deliveryReady: boolean; missing: string[] };
  onSave?: (payload: {
    revision: number;
    settings: SiteSettings;
  }) => Promise<SettingsEnvelope>;
};
type NumberSetting = {
  key: keyof CalculatorInput;
  label: string;
  unit: string;
  integer?: boolean;
  max?: number;
};
const SECTIONS = [
  { id: "telegram", label: "Telegram", icon: Send },
  { id: "defaults", label: "Начальные значения", icon: Settings2 },
  { id: "content", label: "Тексты сайта", icon: FileText },
] as const;
const DEFAULT_GROUPS: {
  title: string;
  description: string;
  fields: NumberSetting[];
}[] = [
  {
    title: "Рецептура и ингредиенты",
    description:
      "Исходная рецептура одного напитка. Все денежные значения относятся к выбранной валюте.",
    fields: [
      { key: "coffeePrice", label: "Цена зерна", unit: "валюта / кг" },
      { key: "dose", label: "Доза кофе", unit: "г", max: 100 },
      { key: "milkPrice", label: "Цена молока", unit: "валюта / л" },
      { key: "milk", label: "Молоко на порцию", unit: "мл", max: 1000 },
      { key: "syrupPrice", label: "Цена сиропа", unit: "валюта / л" },
      { key: "syrup", label: "Сироп на порцию", unit: "мл", max: 200 },
      { key: "packaging", label: "Упаковка", unit: "валюта / порцию" },
      {
        key: "otherPerCup",
        label: "Прочее на порцию",
        unit: "валюта / порцию",
      },
      { key: "lossPercent", label: "Потери ингредиентов", unit: "%", max: 90 },
    ],
  },
  {
    title: "Продажи и удержания",
    description:
      "Начальные предположения, которые посетитель сможет изменить самостоятельно.",
    fields: [
      { key: "salePrice", label: "Цена напитка", unit: "валюта" },
      {
        key: "cupsPerDay",
        label: "Продажи в день",
        unit: "чашек",
        integer: true,
        max: 10000,
      },
      {
        key: "daysPerMonth",
        label: "Рабочие дни в месяц",
        unit: "дней",
        integer: true,
        max: 31,
      },
      { key: "feePercent", label: "Комиссии с выручки", unit: "%", max: 100 },
      {
        key: "turnoverTaxPercent",
        label: "Налог с оборота",
        unit: "%",
        max: 100,
      },
    ],
  },
  {
    title: "Постоянные расходы",
    description:
      "Месячные суммы. Нулевое значение означает, что расход не задан.",
    fields: [
      { key: "rent", label: "Аренда", unit: "валюта / месяц" },
      { key: "salaries", label: "Персонал", unit: "валюта / месяц" },
      {
        key: "utilities",
        label: "Коммунальные услуги",
        unit: "валюта / месяц",
      },
      {
        key: "otherFixed",
        label: "Прочие постоянные расходы",
        unit: "валюта / месяц",
      },
    ],
  },
];
const CONTENT_FIELDS: {
  key: keyof SiteSettings["content"];
  label: string;
  description: string;
  multiline?: boolean;
  maxLength: number;
}[] = [
  {
    key: "calculatorTitle",
    label: "Заголовок калькулятора",
    description: "Главный заголовок страницы.",
    maxLength: 120,
  },
  {
    key: "calculatorDescription",
    label: "Описание калькулятора",
    description: "Кратко объясните, что получит посетитель.",
    multiline: true,
    maxLength: 500,
  },
  {
    key: "pnlTitle",
    label: "Заголовок предложения Excel",
    description: "Название блока с P&L на 3 месяца.",
    maxLength: 120,
  },
  {
    key: "pnlDescription",
    label: "Описание предложения Excel",
    description: "Польза файла и его содержание.",
    multiline: true,
    maxLength: 500,
  },
  {
    key: "pnlButtonLabel",
    label: "Текст кнопки Excel",
    description: "Короткое и понятное действие.",
    maxLength: 60,
  },
];

class SaveFailure extends Error {
  constructor(readonly status: number) {
    super("Settings save failed");
  }
}

/** Saves an authenticated, revision-checked settings draft through the API.
 *
 * Args:
 *   payload: Complete settings and the revision originally opened by the owner.
 *
 * Returns:
 *   Validated server state after a successful atomic update.
 *
 * Raises:
 *   SaveFailure: The server rejects the request, including revision conflicts.
 */
async function saveSettings(payload: {
  revision: number;
  settings: SiteSettings;
}): Promise<SettingsEnvelope> {
  const response = await fetch("/api/admin/settings", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-CoffeeMarket-Admin": "1",
    },
    credentials: "same-origin",
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new SaveFailure(response.status);
  return settingsEnvelopeSchema.parse(await response.json());
}

/** Provides an accessible owner-only settings editor with optimistic concurrency.
 *
 * Args:
 *   initial: Validated settings snapshot and its server revision.
 *   userDisplayName: Name of the authenticated owner, rendered as plain text.
 *   status: Server delivery readiness with non-secret configuration labels.
 *   onSave: Optional persistence adapter; defaults to the authenticated API.
 *
 * Returns:
 *   A Russian settings panel preserving drafts across sections and currencies.
 */
export function AdminPanel({
  initial,
  userDisplayName,
  status = { deliveryReady: false, missing: [] },
  onSave = saveSettings,
}: AdminPanelProps) {
  const id = useId();
  const [section, setSection] = useState<Section>("telegram");
  const [currency, setCurrency] = useState<Currency>("KGS");
  const [snapshot, setSnapshot] = useState(initial);
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState(false);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const form = useForm<
    z.input<typeof siteSettingsSchema>,
    unknown,
    SiteSettings
  >({
    resolver: zodResolver(siteSettingsSchema),
    defaultValues: initial.settings,
    shouldUnregister: false,
  });
  const telegram = useWatch({ control: form.control, name: "telegram" });
  const content = useWatch({ control: form.control, name: "content" });
  const { errors, isDirty, isSubmitting, dirtyFields } = form.formState;
  useEffect(() => {
    if (!isDirty) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [isDirty]);
  const telegramResult = siteSettingsSchema.shape.telegram.safeParse(telegram);
  let previewUrl: string | null = null;
  let previewText = "";
  if (telegramResult.success) {
    previewUrl = buildManagerTelegramUrl(telegramResult.data, {
      code: "CM_пример",
      market: "Кыргызстан",
      currency: "KGS",
    });
    if (previewUrl)
      previewText = new URL(previewUrl).searchParams.get("text") ?? "";
  }
  const changedCurrencies = Object.keys(dirtyFields.defaults ?? {}).length;
  const modifiedAt =
    snapshot.updatedAt === null
      ? "Начальные настройки"
      : new Intl.DateTimeFormat("ru-RU", {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(snapshot.updatedAt);

  function selectTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const offset =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? SECTIONS.length - 1
          : offset
            ? (index + offset + SECTIONS.length) % SECTIONS.length
            : null;
    if (next === null) return;
    event.preventDefault();
    setSection(SECTIONS[next].id);
    tabs.current[next]?.focus();
  }

  async function submit(settings: SiteSettings) {
    setNotice("");
    setConflict(false);
    setSaved(false);
    try {
      const response = settingsEnvelopeSchema.parse(
        await onSave({ revision: snapshot.revision, settings }),
      );
      setSnapshot(response);
      form.reset(response.settings);
      setSaved(true);
    } catch (error) {
      if (error instanceof SaveFailure && error.status === 409) {
        setConflict(true);
        setNotice(
          "Настройки изменились в другом окне. Ваши изменения остаются здесь и не были перезаписаны.",
        );
      } else if (
        error instanceof SaveFailure &&
        [401, 403].includes(error.status)
      ) {
        setNotice(
          "Сессия администратора завершилась или доступ ограничен. Сохраните введённые значения и войдите снова.",
        );
      } else if (error instanceof SaveFailure && error.status === 400) {
        setNotice(
          "Сервер не принял настройки. Проверьте значения и повторите сохранение.",
        );
      } else if (error instanceof SaveFailure && error.status === 422) {
        setNotice(
          "Приём заявок пока нельзя включить: на сервере не завершена настройка доставки. Настройте недостающие подключения или выключите приём заявок перед сохранением.",
        );
      } else {
        setNotice(
          "Не удалось сохранить изменения. Ваши значения остаются в форме. Попробуйте ещё раз.",
        );
      }
    }
  }

  function invalid(allErrors: FieldErrors<z.input<typeof siteSettingsSchema>>) {
    setSaved(false);
    setNotice("Исправьте отмеченные поля перед сохранением.");
    if (allErrors.telegram) setSection("telegram");
    else if (allErrors.defaults) {
      setSection("defaults");
      const failedCurrency = currencies.find(
        (item) => allErrors.defaults?.[item.code],
      );
      if (failedCurrency) setCurrency(failedCurrency.code);
    } else if (allErrors.content) setSection("content");
  }

  function fieldError(name: FieldPath<SiteSettings>) {
    return form.getFieldState(name, form.formState).error?.message;
  }

  return (
    <main className={styles.root}>
      <div className={styles.shell}>
        <header className={styles.topbar}>
          <a className={styles.brand} href="/">
            <Coffee size={23} aria-hidden="true" />
            <span>
              COFFEE MARKET<small>Панель управления</small>
            </span>
          </a>
          <div className={styles.account}>
            <span>{userDisplayName}</span>
            <a
              href="/signout-with-chatgpt?return_to=%2Fadmin"
              target="_top"
              aria-label="Выйти из аккаунта"
            >
              <LogOut size={17} aria-hidden="true" />
              <span>Выйти</span>
            </a>
          </div>
        </header>
        <div className={styles.heading}>
          <div>
            <a className={styles.back} href="/">
              <ArrowLeft size={15} aria-hidden="true" />К калькулятору
            </a>
            <h1>Настройки сайта</h1>
            <p>
              Управляйте Telegram, исходными значениями и текстами калькулятора.
            </p>
          </div>
          <span className={styles.private}>
            <ShieldCheck size={15} aria-hidden="true" />
            Доступ владельца
          </span>
        </div>
        <form onSubmit={form.handleSubmit(submit, invalid)} noValidate>
          <fieldset disabled={isSubmitting} className={styles.formFields}>
            <legend className={styles.srOnly}>Настройки сайта</legend>
            <div
              className={styles.tabs}
              role="tablist"
              aria-label="Разделы настроек"
            >
              {SECTIONS.map(({ id: tabId, label, icon: Icon }, index) => (
                <button
                  key={tabId}
                  ref={(element) => {
                    tabs.current[index] = element;
                  }}
                  type="button"
                  role="tab"
                  id={`${id}-${tabId}-tab`}
                  aria-selected={section === tabId}
                  aria-controls={`${id}-${tabId}-panel`}
                  tabIndex={section === tabId ? 0 : -1}
                  onClick={() => setSection(tabId)}
                  onKeyDown={(event) => selectTab(event, index)}
                >
                  <Icon size={18} aria-hidden="true" />
                  <span>{label}</span>
                  {dirtyFields[tabId] && (
                    <span
                      className={styles.dirtyDot}
                      aria-label="Есть изменения"
                    />
                  )}
                </button>
              ))}
            </div>
            {section === "telegram" && (
              <section
                role="tabpanel"
                aria-labelledby={`${id}-telegram-tab`}
                id={`${id}-telegram-panel`}
                className={styles.panel}
              >
                <div className={styles.sectionHeading}>
                  <span className={styles.sectionIcon}>
                    <Send size={23} aria-hidden="true" />
                  </span>
                  <div>
                    <h2>Заявки в Telegram</h2>
                    <p>
                      Кому посетитель отправит сообщение о персональном Excel.
                    </p>
                  </div>
                </div>
                <div className={styles.twoColumns}>
                  <div className={styles.card}>
                    <label className={styles.toggle} htmlFor={`${id}-enabled`}>
                      <span>
                        <strong>Принимать заявки на Excel</strong>
                        <small>
                          Включает предложение связаться с менеджером.
                        </small>
                      </span>
                      <input
                        type="checkbox"
                        role="switch"
                        id={`${id}-enabled`}
                        {...form.register("telegram.enabled")}
                      />
                    </label>
                    <div className={styles.field}>
                      <label htmlFor={`${id}-username`}>
                        Username менеджера
                      </label>
                      <input
                        id={`${id}-username`}
                        autoComplete="off"
                        placeholder="coffeemarket_manager"
                        {...form.register("telegram.managerUsername")}
                        aria-invalid={Boolean(errors.telegram?.managerUsername)}
                        aria-describedby={`${id}-username-help`}
                      />
                      <small id={`${id}-username-help`}>
                        {errors.telegram?.managerUsername?.message ||
                          "Публичное имя Telegram. Например, @coffeemarket_manager."}
                      </small>
                    </div>
                    <div className={styles.field}>
                      <label htmlFor={`${id}-phone`}>Телефон менеджера</label>
                      <input
                        id={`${id}-phone`}
                        type="tel"
                        inputMode="tel"
                        autoComplete="off"
                        placeholder="+996…"
                        {...form.register("telegram.managerPhone")}
                        aria-invalid={Boolean(errors.telegram?.managerPhone)}
                        aria-describedby={`${id}-phone-help`}
                      />
                      <small id={`${id}-phone-help`}>
                        {errors.telegram?.managerPhone?.message ||
                          "Международный формат. Используется, когда username не задан."}
                      </small>
                    </div>
                    <div className={styles.field}>
                      <label htmlFor={`${id}-message`}>
                        Текст сообщения менеджеру
                      </label>
                      <textarea
                        id={`${id}-message`}
                        rows={5}
                        maxLength={1000}
                        {...form.register("telegram.messageTemplate")}
                        aria-invalid={Boolean(errors.telegram?.messageTemplate)}
                        aria-describedby={`${id}-message-help`}
                      />
                      <small id={`${id}-message-help`}>
                        {errors.telegram?.messageTemplate?.message ||
                          "Добавьте один {code}. Также доступны {market} и {currency}."}
                      </small>
                    </div>
                  </div>
                  <aside className={styles.sideStack}>
                    <div className={styles.preview}>
                      <div className={styles.eyebrow}>
                        Предпросмотр сообщения
                      </div>
                      <h3>Переход в чат менеджера</h3>
                      {previewUrl ? (
                        <>
                          <p className={styles.message}>{previewText}</p>
                          <a
                            className={styles.previewLink}
                            href={previewUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Открыть пример в Telegram
                            <ArrowUpRight size={16} aria-hidden="true" />
                          </a>
                          <small>
                            Это пример с условным кодом. Заявка не создаётся.
                          </small>
                        </>
                      ) : (
                        <p className={styles.muted}>
                          Укажите корректный username или телефон и шаблон с
                          кодом заявки, чтобы увидеть ссылку.
                        </p>
                      )}
                    </div>
                    <div
                      className={styles.readiness}
                      aria-label="Статус доставки на сервере"
                    >
                      <div className={styles.statusTitle}>
                        {status.deliveryReady ? (
                          <Check size={18} aria-hidden="true" />
                        ) : (
                          <CircleAlert size={18} aria-hidden="true" />
                        )}
                        <h3>
                          {status.deliveryReady
                            ? "Доставка настроена"
                            : "Доставка требует настройки"}
                        </h3>
                      </div>
                      {status.missing.length > 0 && (
                        <>
                          <p>Нужно настроить на сервере:</p>
                          <ul>
                            {status.missing.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </>
                      )}
                      <p>
                        Изменение username не подключает бота. Токен и другие
                        секреты настраиваются на сервере.
                      </p>
                      <small>Статус проверен при открытии страницы.</small>
                    </div>
                  </aside>
                </div>
              </section>
            )}
            {section === "defaults" && (
              <section
                role="tabpanel"
                aria-labelledby={`${id}-defaults-tab`}
                id={`${id}-defaults-panel`}
                className={styles.panel}
              >
                <div className={styles.sectionHeading}>
                  <span className={styles.sectionIcon}>
                    <Settings2 size={23} aria-hidden="true" />
                  </span>
                  <div>
                    <h2>Начальные значения расчёта</h2>
                    <p>
                      Отдельные исходные данные для каждой валюты.
                      Автоматической конвертации нет.
                    </p>
                  </div>
                </div>
                <div className={styles.currencyBar}>
                  <div className={styles.field}>
                    <label htmlFor={`${id}-currency`}>
                      Валюта исходных значений
                    </label>
                    <select
                      id={`${id}-currency`}
                      value={currency}
                      onChange={(event) =>
                        setCurrency(event.target.value as Currency)
                      }
                    >
                      {currencies.map((item) => (
                        <option key={item.code} value={item.code}>
                          {item.code} — {item.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <p>
                    Посетитель сможет изменить любое значение.
                    <br />
                    Кнопка «Сохранить изменения» применяет настройки всех валют.
                  </p>
                  {changedCurrencies > 0 && (
                    <span className={styles.currencyCount}>
                      Изменено валют: {changedCurrencies}
                    </span>
                  )}
                </div>
                <div key={currency} className={styles.defaultGroups}>
                  {DEFAULT_GROUPS.map((group) => (
                    <section key={group.title} className={styles.card}>
                      <h3>{group.title}</h3>
                      <p className={styles.groupDescription}>
                        {group.description}
                      </p>
                      <div className={styles.numberGrid}>
                        {group.fields.map((field) => {
                          const name =
                            `defaults.${currency}.${field.key}` as const;
                          const error = fieldError(name);
                          const inputId = `${id}-${currency}-${field.key}`;
                          const unit = field.unit.replace("валюта", currency);
                          return (
                            <div key={field.key} className={styles.field}>
                              <label htmlFor={inputId}>{field.label}</label>
                              <div className={styles.numberWrap}>
                                <input
                                  id={inputId}
                                  type="number"
                                  inputMode={
                                    field.integer ? "numeric" : "decimal"
                                  }
                                  min={field.key === "daysPerMonth" ? 1 : 0}
                                  max={field.max ?? 1_000_000_000}
                                  step={field.integer ? 1 : "any"}
                                  {...form.register(name, {
                                    valueAsNumber: true,
                                  })}
                                  aria-invalid={Boolean(error)}
                                  aria-describedby={`${inputId}-help`}
                                />
                                <span>{unit}</span>
                              </div>
                              <small
                                id={`${inputId}-help`}
                                className={
                                  error ? styles.fieldError : styles.unit
                                }
                              >
                                {error || unit}
                              </small>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              </section>
            )}
            {section === "content" && (
              <section
                role="tabpanel"
                aria-labelledby={`${id}-content-tab`}
                id={`${id}-content-panel`}
                className={styles.panel}
              >
                <div className={styles.sectionHeading}>
                  <span className={styles.sectionIcon}>
                    <FileText size={23} aria-hidden="true" />
                  </span>
                  <div>
                    <h2>Тексты сайта</h2>
                    <p>
                      Русский интерфейс для всех рынков. Изменения применятся
                      после сохранения.
                    </p>
                  </div>
                </div>
                <div className={styles.twoColumns}>
                  <div className={styles.card}>
                    {CONTENT_FIELDS.map((field) => {
                      const inputId = `${id}-${field.key}`;
                      const name = `content.${field.key}` as const;
                      const error = fieldError(name);
                      const props = {
                        id: inputId,
                        maxLength: field.maxLength,
                        ...form.register(name),
                        "aria-invalid": Boolean(error),
                        "aria-describedby": `${inputId}-help`,
                      };
                      return (
                        <div key={field.key} className={styles.field}>
                          <label htmlFor={inputId}>{field.label}</label>
                          {field.multiline ? (
                            <textarea {...props} rows={4} />
                          ) : (
                            <input {...props} />
                          )}
                          <small id={`${inputId}-help`}>
                            {error || field.description}
                          </small>
                        </div>
                      );
                    })}
                  </div>
                  <aside className={styles.preview}>
                    <div className={styles.eyebrow}>Предпросмотр текстов</div>
                    <h3>
                      {content.calculatorTitle || "Заголовок калькулятора"}
                    </h3>
                    <p>{content.calculatorDescription}</p>
                    <div className={styles.contentDivider} />
                    <FileText size={23} aria-hidden="true" />
                    <h3>{content.pnlTitle || "Предложение Excel"}</h3>
                    <p>{content.pnlDescription}</p>
                    <span className={styles.buttonPreview}>
                      {content.pnlButtonLabel || "Текст кнопки"}
                    </span>
                    <small>
                      Предпросмотр показывает тексты без отправки заявки.
                    </small>
                  </aside>
                </div>
              </section>
            )}
          </fieldset>
          {notice && (
            <div role="alert" className={styles.errorNotice}>
              <CircleAlert size={19} aria-hidden="true" />
              <div>
                <p>{notice}</p>
                {conflict && (
                  <p>
                    Скопируйте нужные значения, затем обновите страницу, чтобы
                    открыть актуальную версию. Эта форма не перезагружается
                    автоматически.
                  </p>
                )}
              </div>
            </div>
          )}
          <footer className={styles.saveBar}>
            <div aria-live="polite" className={styles.saveState}>
              {isSubmitting ? (
                <>
                  <LoaderCircle
                    size={18}
                    className={styles.spinner}
                    aria-hidden="true"
                  />
                  <span>Сохраняем настройки…</span>
                </>
              ) : isDirty ? (
                <>
                  <span className={styles.unsavedDot} />
                  <span>Есть несохранённые изменения</span>
                </>
              ) : saved ? (
                <>
                  <Check size={18} aria-hidden="true" />
                  <span>Настройки сохранены</span>
                </>
              ) : (
                <>
                  <ShieldCheck size={18} aria-hidden="true" />
                  <span>Все изменения сохранены</span>
                </>
              )}
              <small>
                Версия {snapshot.revision} · {modifiedAt}
              </small>
            </div>
            <button
              className={styles.saveButton}
              type="submit"
              disabled={!isDirty || isSubmitting}
            >
              <Save size={17} aria-hidden="true" />
              {isSubmitting ? "Сохранение…" : "Сохранить изменения"}
            </button>
          </footer>
        </form>
        <p className={styles.footerNote}>
          Начальные значения применяются к новым расчётам. Личные сохранённые
          сценарии посетителей не перезаписываются.
        </p>
      </div>
    </main>
  );
}
