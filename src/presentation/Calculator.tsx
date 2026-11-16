"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowRight,
  BookOpen,
  Calculator as CalculatorIcon,
  Check,
  ChevronDown,
  Coffee,
  Download,
  Leaf,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Upload,
  X,
} from "lucide-react";
import {
  calculatorSchema,
  calculate,
  type CalculatorInput,
} from "../domain/calculator";
import { pricePerKilogram, type Catalog } from "../domain/catalog";
import {
  createScenario,
  presets,
  scenarioSchema,
} from "../application/scenarios";
import { initialCalculatorInput } from "../application/public-calculator-settings";
import type { PublicSettings } from "../domain/site-settings";
import { BrowserScenarioStore } from "../infrastructure/scenario-storage";
import { NumberField } from "./NumberField";
import { Results, Summary } from "./Results";
import { createFormatters } from "./format";
import {
  catalogIsCompatible,
  currencyDigits,
  defaultContext,
  type MarketContext,
} from "../domain/markets";
import { MarketSettings } from "./MarketSettings";
import { PnlOffer } from "./PnlOffer";
import styles from "./Calculator.module.css";

/** Composes presentation, validation and use cases without business formulas. */
export type CalculatorProps = {
  catalog: Catalog;
  showIntro?: boolean;
  headingLevel?: 1 | 2;
  initialContext?: MarketContext;
  pnlAnchorId?: string;
  settings?: PublicSettings;
};

/** Composes the calculator with public defaults while preserving visitor inputs.
 *
 * Args:
 *   props: Catalog, optional validated settings and embedding presentation.
 *
 * Returns:
 *   A calculator whose saved scenarios take precedence over initial defaults.
 */
export function Calculator({
  catalog,
  showIntro = true,
  headingLevel = 1,
  initialContext = defaultContext,
  pnlAnchorId,
  settings,
}: CalculatorProps) {
  const [context, setContext] = useState<MarketContext>(initialContext);
  const currency = context.currency;
  const { money: formatMoney } = useMemo(
    () => createFormatters(currency),
    [currency],
  );
  const compatibleCatalog = catalogIsCompatible(context, catalog);
  const drafts = useRef(new Map<string, CalculatorInput>());
  const restored = useRef(false);
  const instanceId = useId();
  const formId = instanceId + "-form";
  const productSelectId = instanceId + "-product";
  const resultId = instanceId + "-results";
  const methodId = instanceId + "-method";
  const Heading = headingLevel === 1 ? "h1" : "h2";
  const initialProduct =
    catalog.products.find((product) => product.stock > 0) ??
    catalog.products[0];
  const initialInput = initialCalculatorInput(context, catalog, settings);
  const initialProductId =
    !settings &&
    compatibleCatalog &&
    initialInput.coffeePrice === pricePerKilogram(initialProduct)
      ? String(initialProduct.id)
      : "custom";
  const form = useForm<CalculatorInput>({
    defaultValues: initialInput,
    resolver: zodResolver(calculatorSchema),
    mode: "onChange",
  });
  const watched = useWatch({ control: form.control });
  const validated = calculatorSchema.safeParse(watched);
  const input = validated.success ? validated.data : null;
  const result = input ? calculate(input, currencyDigits(currency)) : null;
  const [drink, setDrink] = useState<keyof typeof presets | "custom">(
    "cappuccino",
  );
  const [productId, setProductId] = useState(initialProductId);
  const [notice, setNotice] = useState("");
  const [methodOpen, setMethodOpen] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  const selectedProduct = compatibleCatalog
    ? catalog.products.find((p) => String(p.id) === productId)
    : undefined;
  const selectedPrice = selectedProduct
    ? pricePerKilogram(selectedProduct)
    : null;
  const editedPrice = selectedPrice !== watched.coffeePrice;

  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    try {
      const store = new BrowserScenarioStore(window.localStorage);
      const savedContext = store.getLastContext() ?? initialContext;
      const saved = store.load(savedContext);
      setContext(savedContext);
      if (saved) {
        form.reset(saved.input);
        setDrink("custom");
        setProductId("custom");
        setNotice("Сохранённый расчёт восстановлен на этом устройстве.");
      } else
        form.reset(initialCalculatorInput(savedContext, catalog, settings));
    } catch {
      setNotice("Сохранённый расчёт недоступен. Загружены начальные значения.");
    }
  }, [form, catalog, initialContext, settings]);

  /** Switches isolated market scenarios without relabeling monetary amounts.
   *
   * Args:
   *   next: Explicitly confirmed target market and currency.
   */
  function changeContext(next: MarketContext) {
    if (!input) {
      void form.trigger();
      setNotice(
        "Исправьте ошибки, чтобы сохранить текущий сценарий перед переходом.",
      );
      return;
    }
    drafts.current.set(`${context.market}:${currency}`, input);
    let target = drafts.current.get(`${next.market}:${next.currency}`);
    let persisted = false;
    try {
      const store = new BrowserScenarioStore(window.localStorage);
      store.save(input, context);
      target ??= store.load(next)?.input;
      store.saveLastContext(next);
      persisted = true;
    } catch {
      /* Session drafts remain available when browser storage is disabled. */
    }
    form.reset(target ?? initialCalculatorInput(next, catalog, settings));
    setContext(next);
    setDrink("custom");
    setProductId("custom");
    setNotice(
      `${target ? "Сценарий восстановлен" : "Создан отдельный сценарий"}. Суммы не конвертировались. Предыдущий расчёт ${persisted ? "сохранён в браузере" : "сохранён до закрытия страницы"}.`,
    );
  }

  function selectDrink(key: keyof typeof presets) {
    setDrink(key);
    const preset = presets[key];
    (compatibleCatalog && !settings
      ? (["dose", "milk", "syrup", "salePrice"] as const)
      : (["dose", "milk", "syrup"] as const)
    ).forEach((name) =>
      form.setValue(name, preset[name], {
        shouldValidate: true,
        shouldDirty: true,
      }),
    );
    setNotice(
      compatibleCatalog && !settings
        ? `Выбран ${preset.name.toLowerCase()}. Рецептура и цена продажи — пример, их можно изменить.`
        : `Выбран ${preset.name.toLowerCase()}. Рецептура — пример, её можно изменить. Цена продажи сохранена.`,
    );
  }

  function save() {
    if (!input) {
      void form.trigger();
      setNotice("Исправьте ошибки перед сохранением.");
      return;
    }
    try {
      const store = new BrowserScenarioStore(window.localStorage);
      store.save(input, context);
      store.saveLastContext(context);
      setNotice("Расчёт сохранён в браузере на этом устройстве.");
    } catch {
      setNotice("Браузер не разрешил сохранение. Используйте экспорт JSON.");
    }
  }

  function download() {
    if (!input) {
      void form.trigger();
      setNotice("Исправьте ошибки перед экспортом.");
      return;
    }
    const blob = new Blob(
      [
        JSON.stringify(
          {
            ...createScenario(input, new Date(), context),
            result,
            catalogFetchedAt: catalog.fetchedAt,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "coffee-market-calculation.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("Расчёт экспортирован в JSON. Его можно импортировать обратно.");
  }

  async function importScenario(file?: File) {
    if (!file) return;
    try {
      if (file.size > 100000) throw new Error("File too large");
      const scenario = scenarioSchema.parse(JSON.parse(await file.text()));
      if (input) drafts.current.set(`${context.market}:${currency}`, input);
      setContext(scenario.context);
      form.reset(scenario.input);
      setProductId("custom");
      setDrink("custom");
      setNotice(
        "Расчёт импортирован. Чтобы оставить его на устройстве, нажмите «Сохранить».",
      );
    } catch {
      setNotice(
        "Не удалось импортировать файл. Выберите JSON, экспортированный этим калькулятором.",
      );
    }
    if (upload.current) upload.current.value = "";
  }

  return (
    <section className={styles["root"]} aria-label="Калькулятор Coffee Market">
      <a href={"#" + formId} className={styles["skip-link"]}>
        Перейти к расчёту
      </a>
      {showIntro && (
        <header className={styles["intro"]}>
          <div className={styles["eyebrow"]}>
            <span /> ДЛЯ ВАШЕГО КОФЕЙНОГО БИЗНЕСА
          </div>
          <Heading className={styles["title"]}>
            {settings?.content.calculatorTitle ??
              "Сколько приносит ваша чашка кофе?"}
          </Heading>
          <p>
            {settings?.content.calculatorDescription ??
              "Рассчитайте себестоимость напитка и потенциальную прибыль. Подставьте свои цены, рецепт и объём продаж."}
          </p>
          <div className={styles["intro-tags"]}>
            <span>
              <Check size={14} /> Бесплатно, без регистрации
            </span>
            <span>
              <Check size={14} /> Ваш рынок и валюта
            </span>
            <span>
              <Check size={14} /> Все параметры можно изменить
            </span>
          </div>
        </header>
      )}
      <MarketSettings context={context} onChange={changeContext} />
      <Summary result={result} currency={currency} />
      <div className={styles["mobile-feedback"]}>
        <div>
          <span>Себестоимость чашки</span>
          <strong>
            {formatMoney(result?.productionCost ?? null)}{" "}
            <small>{currency}</small>
          </strong>
        </div>
        <a href={"#" + resultId}>
          <span>
            {result && result.profit < 0 ? "Убыток / месяц" : "Прибыль / месяц"}
          </span>
          <strong>
            {formatMoney(result?.profit ?? null)} <small>{currency}</small>
            <ArrowRight size={16} />
          </strong>
        </a>
      </div>
      <div className={styles["workspace-heading"]}>
        <div>
          <h2>Настройте ваш расчёт</h2>
          <p>Меняйте параметры — результат пересчитывается сразу.</p>
        </div>
        <div className={styles["toolbar"]}>
          <button
            className={styles["icon-button"]}
            onClick={() => {
              form.reset(initialInput);
              setProductId(initialProductId);
              setDrink("cappuccino");
              setNotice(
                "Начальные значения восстановлены. Сохранённый расчёт изменится после нажатия «Сохранить».",
              );
            }}
            title="Сбросить параметры"
            aria-label="Сбросить параметры"
          >
            <RotateCcw size={17} />
          </button>
          <button className={styles["secondary-button"]} onClick={download}>
            <Download size={15} />
            <span>Экспорт</span>
          </button>
          <button className={styles["primary-button"]} onClick={save}>
            <Save size={15} />
            <span>Сохранить</span>
          </button>
        </div>
      </div>
      {notice && (
        <div className={styles["notice"]} role="status">
          <span>{notice}</span>
          <button
            onClick={() => setNotice("")}
            aria-label="Закрыть уведомление"
          >
            <X size={15} />
          </button>
        </div>
      )}
      <div className={styles["calculator-layout"]}>
        <FormProvider {...form}>
          <form
            id={formId}
            noValidate
            onSubmit={form.handleSubmit(save)}
            className={styles["form-column"]}
          >
            <section className={styles["panel"]}>
              <div className={styles["step-heading"]}>
                <span className={styles["step-number"]}>01</span>
                <div>
                  <h2>Выберите напиток</h2>
                  <p>Начните с рецепта и настройте под себя</p>
                </div>
                <Coffee size={20} />
              </div>
              <div
                className={styles["drink-tabs"]}
                role="group"
                aria-label="Рецепты напитков"
              >
                {Object.entries(presets).map(([key, p]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={drink === key}
                    className={drink === key ? styles.selected : undefined}
                    onClick={() => selectDrink(key as keyof typeof presets)}
                  >
                    <Coffee size={20} />
                    <strong>{p.name}</strong>
                    <span>{p.volume}</span>
                  </button>
                ))}
              </div>
              <div className={styles["demo-note"]}>
                Рецепты и цены продажи — примеры. Все параметры можно изменить.
              </div>
            </section>
            <section className={styles["panel"]}>
              <div className={styles["step-heading"]}>
                <span className={styles["step-number"]}>02</span>
                <div>
                  <h2>Состав и себестоимость</h2>
                  <p>Сырьё, упаковка и расход на одну порцию</p>
                </div>
                <Leaf size={20} />
              </div>
              {compatibleCatalog ? (
                <div className={styles["catalog-field"]}>
                  <label htmlFor={productSelectId}>
                    Кофе из каталога Coffee Market
                  </label>
                  <div className={styles["select-wrap"]}>
                    <select
                      id={productSelectId}
                      value={productId}
                      onChange={(event) => {
                        const id = event.target.value;
                        setProductId(id);
                        const p = catalog.products.find(
                          (p) => String(p.id) === id,
                        );
                        if (p)
                          form.setValue("coffeePrice", pricePerKilogram(p), {
                            shouldValidate: true,
                            shouldDirty: true,
                          });
                      }}
                    >
                      <option value="custom">Свой кофе / ручная цена</option>
                      {catalog.products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} · {formatMoney(p.price)} {currency}
                          {p.stock === 0 ? " · нет в наличии" : ""}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={16} />
                  </div>
                  <div className={styles["catalog-meta"]}>
                    <span className={styles["source-badge"]}>
                      <span /> Цены каталога CoffeeMarket
                    </span>
                    <span>
                      Получены{" "}
                      {new Intl.DateTimeFormat("ru-RU", {
                        dateStyle: "short",
                        timeZone: "Asia/Bishkek",
                      }).format(new Date(catalog.fetchedAt))}
                    </span>
                  </div>
                  {selectedProduct && (
                    <div className={styles["product-note"]}>
                      {editedPrice
                        ? "Цена за кг изменена вручную. "
                        : `${selectedProduct.packageGrams} г · ${formatMoney(selectedProduct.price)} ${currency} за упаковку. `}
                      {selectedProduct.stock === 0 &&
                        "Нет в наличии на дату получения. "}
                      <a
                        href={selectedProduct.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Карточка товара ↗
                      </a>
                    </div>
                  )}
                </div>
              ) : (
                <div className={styles["manual-note"]}>
                  <strong>Ваши цены — ваш расчёт</strong>
                  <p>
                    Для выбранного рынка и валюты каталог не подключён. Укажите
                    цены поставщиков и расходы в {currency}.{" "}
                    {settings
                      ? "Начальные значения настроены владельцем калькулятора. Проверьте их для вашего бизнеса."
                      : "Для начала заполнен небольшой демонстрационный сценарий. Это условные суммы, а не местные рыночные цены или минимальные требования к бизнесу."}
                  </p>
                </div>
              )}
              <div className={styles["field-grid"]}>
                <NumberField
                  name="coffeePrice"
                  label="Цена кофе"
                  unit={`${currency} / кг`}
                />
                <NumberField name="dose" label="Кофе на порцию" unit="г" />
                <NumberField
                  name="milkPrice"
                  label="Цена молока"
                  unit={`${currency} / л`}
                />
                <NumberField name="milk" label="Молоко на порцию" unit="мл" />
                <NumberField
                  name="syrupPrice"
                  label="Цена сиропа"
                  unit={`${currency} / л`}
                />
                <NumberField name="syrup" label="Сироп на порцию" unit="мл" />
                <NumberField
                  name="packaging"
                  label="Стакан, крышка и прочее"
                  unit={currency}
                />
                <NumberField
                  name="otherPerCup"
                  label="Прочие расходы на чашку"
                  unit={currency}
                  hint="Вода, сахар, салфетка и т. п."
                />
                <NumberField
                  name="lossPercent"
                  label="Потери сырья"
                  unit="%"
                  hint="Доля закупленного сырья, которая теряется"
                />
              </div>
            </section>
            <section className={styles["panel"]}>
              <div className={styles["step-heading"]}>
                <span className={styles["step-number"]}>03</span>
                <div>
                  <h2>Продажи и расходы</h2>
                  <p>Параметры вашего бизнеса</p>
                </div>
                <SlidersHorizontal size={20} />
              </div>
              <div className={styles["field-grid"]}>
                <NumberField
                  name="salePrice"
                  label="Цена продажи чашки"
                  unit={currency}
                />
                <NumberField
                  name="cupsPerDay"
                  label="Чашек в день"
                  unit="шт."
                  integer
                />
                <NumberField
                  name="daysPerMonth"
                  label="Рабочих дней в месяц"
                  unit="дней"
                  integer
                />
                <NumberField
                  name="feePercent"
                  label="Комиссия с выручки"
                  unit="%"
                  hint="Средняя комиссия эквайринга и площадок"
                />
                <NumberField
                  name="turnoverTaxPercent"
                  label="Налог с выручки"
                  unit="%"
                  hint="Задайте ставку для вашей модели расчёта"
                />
              </div>
              <div className={styles["section-divider"]}>
                <span>ПОСТОЯННЫЕ РАСХОДЫ В МЕСЯЦ</span>
              </div>
              <div className={styles["field-grid"]}>
                <NumberField name="rent" label="Аренда" unit={currency} />
                <NumberField name="salaries" label="Зарплаты" unit={currency} />
                <NumberField
                  name="utilities"
                  label="Коммунальные расходы"
                  unit={currency}
                />
                <NumberField
                  name="otherFixed"
                  label="Прочие постоянные"
                  unit={currency}
                  hint="Аренда техники, сервис, реклама и т. п."
                />
              </div>
              <div className={styles["assumption-note"]}>
                Начальные расходы и объёмы — демонстрационные. Укажите свои
                значения, включая все применимые расходы.
              </div>
            </section>
          </form>
        </FormProvider>
        {input && result ? (
          <div id={resultId} className={styles["results-anchor"]}>
            <Results input={input} result={result} currency={currency} />
          </div>
        ) : (
          <aside
            className={styles["panel"] + " " + styles["invalid-state"]}
            role="status"
          >
            <CalculatorIcon size={32} />
            <h2>Проверим параметры</h2>
            <p>Исправьте выделенные поля, чтобы увидеть актуальный расчёт.</p>
          </aside>
        )}
      </div>
      <PnlOffer
        input={input}
        context={context}
        anchorId={pnlAnchorId}
        settings={settings}
      />
      <section
        className={styles["methodology"] + " " + styles["panel"]}
        id={methodId}
      >
        <button
          className={styles["method-toggle"]}
          aria-expanded={methodOpen}
          aria-controls={methodId + "-content"}
          onClick={() => setMethodOpen(!methodOpen)}
        >
          <span>
            <BookOpen size={18} /> Прозрачный расчёт: формулы и допущения
          </span>
          <ChevronDown
            size={18}
            className={methodOpen ? styles.rotated : undefined}
          />
        </button>
        {methodOpen && (
          <div id={methodId + "-content"} className={styles["method-content"]}>
            <div>
              <h3>Себестоимость чашки</h3>
              <p>
                Стоимость кофе = цена за кг × граммы / 1 000. Молоко и сироп
                считаются аналогично в миллилитрах. Сырьё с потерями = сумма
                ингредиентов / (1 − доля потерь). Затем прибавляются упаковка и
                прочие расходы на чашку.
              </p>
            </div>
            <div>
              <h3>Потенциальная прибыль</h3>
              <p>
                Объём = чашек в день × рабочих дней. Выручка = цена × объём.
                Прибыль = выручка − все переменные расходы − постоянные расходы.
                Комиссия и заданный налог считаются от выручки. Неучтённые
                расходы не вычитаются автоматически.
              </p>
            </div>
            <div>
              <h3>Точка безубыточности</h3>
              <p>
                Чашек в месяц = постоянные расходы / маржинальная прибыль с
                чашки, с округлением вверх. Чашек в день = месячный объём /
                рабочие дни, также вверх. Если маржинальная прибыль ≤ 0, точка
                недостижима. Расчёт предполагает продажу одного выбранного
                напитка.
              </p>
            </div>
            <div>
              <h3>Источники и ограничения</h3>
              <p>
                {compatibleCatalog ? (
                  <>
                    Цены кофе — снимок публичного каталога CoffeeMarket от{" "}
                    {new Intl.DateTimeFormat("ru-RU", {
                      dateStyle: "long",
                      timeZone: "Asia/Bishkek",
                    }).format(new Date(catalog.fetchedAt))}
                    . Они не обновляются автоматически. Остальные значения —
                    редактируемые примеры.
                  </>
                ) : (
                  <>
                    Цены и расходы задаёт пользователь. Источник региональных
                    цен не подключён.
                  </>
                )}{" "}
                Расчёты выполняются без промежуточного округления; итоги
                округляются по точности {currency}. Смена рынка создаёт
                отдельный сценарий и не конвертирует суммы. Налог моделируется
                только как заданный процент выручки; налоговый режим страны
                автоматически не определяется.
              </p>
            </div>
          </div>
        )}
      </section>
      <div className={styles["import-row"]}>
        <input
          ref={upload}
          type="file"
          accept="application/json,.json"
          className={styles["visually-hidden"]}
          aria-label="Файл расчёта JSON"
          onChange={(event) => void importScenario(event.target.files?.[0])}
        />
        <button onClick={() => upload.current?.click()}>
          <Upload size={14} /> Импортировать расчёт JSON
        </button>
        <span>Сохранения хранятся только в вашем браузере</span>
      </div>
    </section>
  );
}
