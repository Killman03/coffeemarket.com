"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowUpRight, Check, FileSpreadsheet, Send } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { phoneSchema, CONSENT_TEXT } from "../domain/contact";
import type { CalculatorInput } from "../domain/calculator";
import type { MarketContext } from "../domain/markets";
import styles from "./Calculator.module.css";

const contactSchema = z.object({
  phone: phoneSchema,
  consent: z
    .boolean()
    .refine(Boolean, "Подтвердите передачу данных для получения файла"),
});
const configSchema = z.object({
  ready: z.boolean(),
  message: z.string().optional(),
});
const deliverySchema = z.object({
  telegramUrl: z
    .url()
    .refine((value) => new URL(value).origin === "https://t.me"),
  expiresAt: z.union([z.string(), z.number()]),
});

/** Offers a quarterly workbook and an explicit handoff to the manager's chat.
 *
 * Args:
 *   input: Valid scenario or null while the calculator has validation errors.
 *   context: Market and currency included in the personalized workbook.
 *
 * Returns:
 *   Workbook preview and a contact form only when delivery is configured.
 */
export function PnlOffer({
  input,
  context,
  anchorId,
}: {
  input: CalculatorInput | null;
  context: MarketContext;
  anchorId?: string;
}) {
  const id = useId();
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [telegramUrl, setTelegramUrl] = useState("");
  const requestVersion = useRef(0);
  const scenarioKey = JSON.stringify({ input, context });
  const form = useForm<z.infer<typeof contactSchema>>({
    resolver: zodResolver(contactSchema),
    defaultValues: { phone: "", consent: false },
  });
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/pnl/config", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((body) => setReady(configSchema.parse(body).ready))
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) setLoaded(true);
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    requestVersion.current += 1;
    setTelegramUrl("");
    setError("");
    return () => {
      requestVersion.current += 1;
    };
  }, [scenarioKey]);
  async function requestFile(values: z.infer<typeof contactSchema>) {
    if (!input) return;
    const version = requestVersion.current;
    setError("");
    setTelegramUrl("");
    try {
      const response = await fetch("/api/pnl/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input, context, ...values }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok)
        throw new Error(
          response.status === 429
            ? "Слишком много запросов. Попробуйте немного позже."
            : "Не удалось подготовить файл. Ваш расчёт сохранён на странице; попробуйте ещё раз.",
        );
      const delivery = deliverySchema.parse(await response.json());
      if (version !== requestVersion.current) return;
      setTelegramUrl(delivery.telegramUrl);
      form.reset();
    } catch (cause) {
      if (version !== requestVersion.current) return;
      setError(
        cause instanceof Error && cause.message.startsWith("Слишком")
          ? cause.message
          : "Не удалось подготовить файл. Попробуйте ещё раз.",
      );
    }
  }
  return (
    <section
      id={anchorId ?? id + "-pnl"}
      className={styles["pnl-offer"]}
      aria-labelledby={id + "-title"}
    >
      <div className={styles["pnl-copy"]}>
        <span className={styles["pnl-kicker"]}>
          <FileSpreadsheet size={17} /> EXCEL ДЛЯ ВАШЕГО БИЗНЕСА
        </span>
        <h2 id={id + "-title"}>
          Следующий шаг — P&amp;L
          <br />
          на 3 месяца
        </h2>
        <p>
          Превратите расчёт одной чашки в редактируемый план кофейной точки.
          Добавьте меню, сравните сценарии и отслеживайте план и факт.
        </p>
        <ul>
          {[
            "Ваши данные и валюта уже в модели",
            "Меню напитков и помесячные расходы",
            "Сценарии и сравнение плана с фактом",
          ].map((text) => (
            <li key={text}>
              <Check size={16} />
              {text}
            </li>
          ))}
        </ul>
        <div className={styles["pnl-actions"]}>
          <button
            className={styles["primary-button"]}
            disabled={!ready || !input}
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-controls={id + "-contact"}
          >
            <Send size={16} />
            Получить в Telegram
          </button>
          <a
            href="/templates/coffee-market-pnl-3-months.xlsx"
            download
            className={styles["pnl-sample"]}
          >
            Посмотреть пример Excel <ArrowUpRight size={15} />
          </a>
        </div>
        <p className={styles["pnl-delivery-note"]}>
          {!loaded
            ? "Проверяем доступность выдачи…"
            : ready
              ? "Откроется чат менеджера с готовым сообщением. После отправки файл придёт автоматически; на вопросы ответит менеджер."
              : "Выдача через менеджера пока не подключена. Пример Excel доступен без номера телефона."}
        </p>
      </div>
      <div
        className={styles["pnl-preview"]}
        aria-label="Содержание Excel: три месяца, P&L, меню, сценарии и план-факт"
      >
        <div className={styles["sheet-top"]}>
          <FileSpreadsheet size={17} />
          <strong>План вашей кофейной точки</strong>
          <span>.xlsx</span>
        </div>
        <div className={styles["sheet-grid"]}>
          <span>Показатель</span>
          <span>Месяц 1</span>
          <span>Месяц 2</span>
          <span>Месяц 3</span>
          <span>Выручка</span>
          <i />
          <i />
          <i />
          <span>Себестоимость</span>
          <i />
          <i />
          <i />
          <strong>Валовая прибыль</strong>
          <i />
          <i />
          <i />
          <span>Расходы</span>
          <i />
          <i />
          <i />
          <strong>Результат</strong>
          <i />
          <i />
          <i />
        </div>
        <div className={styles["sheet-tabs"]}>
          <span>P&amp;L</span>
          <span>Меню</span>
          <span>Сценарии</span>
          <span>План / факт</span>
        </div>
        <p>Формулы пересчитываются после изменения исходных данных</p>
      </div>
      {open && ready && (
        <form
          id={id + "-contact"}
          className={styles["pnl-contact"]}
          onSubmit={form.handleSubmit(requestFile)}
          noValidate
        >
          <div>
            <label htmlFor={id + "-phone"}>Ваш номер с кодом страны</label>
            <input
              id={id + "-phone"}
              type="tel"
              autoComplete="tel"
              placeholder="+996 …"
              {...form.register("phone")}
              aria-invalid={!!form.formState.errors.phone}
              aria-describedby={id + "-phone-error"}
            />
            <span id={id + "-phone-error"} className={styles["field-error"]}>
              {form.formState.errors.phone?.message}
            </span>
          </div>
          <label className={styles["consent"]}>
            <input type="checkbox" {...form.register("consent")} />
            {CONSENT_TEXT}
          </label>
          {form.formState.errors.consent && (
            <p className={styles["field-error"]}>
              {form.formState.errors.consent.message}
            </p>
          )}
          <button
            className={styles["primary-button"]}
            disabled={form.formState.isSubmitting || !input}
            type="submit"
          >
            {form.formState.isSubmitting
              ? "Готовим переход…"
              : "Подготовить сообщение менеджеру"}
            <Send size={15} />
          </button>
          {error && <p role="alert">{error}</p>}
          {telegramUrl && (
            <div role="status">
              <strong>Сообщение подготовлено.</strong>
              <p>
                Нажмите кнопку и отправьте сообщение в Telegram. Ссылка
                действует 15 минут.
              </p>
              <a
                className={styles["primary-button"]}
                href={telegramUrl}
                target="_blank"
                rel="noreferrer"
              >
                Открыть чат менеджера <ArrowUpRight size={16} />
              </a>
            </div>
          )}
        </form>
      )}
    </section>
  );
}
