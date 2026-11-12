"use client";
import styles from "./Calculator.module.css";
import { lazy, Suspense } from "react";
import { ArrowDownRight, ArrowUpRight, Info, TrendingUp } from "lucide-react";
import type { CalculatorInput, Calculation } from "../domain/calculator";
import { compareDemand } from "../application/scenarios";
import {
  formatInteger as integer,
  formatMoney as decimal,
  createFormatters,
} from "./format";
import { currencyDigits, type Currency } from "../domain/markets";
const ProfitChart = lazy(() =>
  import("./ProfitChart").then((module) => ({ default: module.ProfitChart })),
);

export function Summary({
  result,
  currency = "KGS",
}: {
  result: Calculation | null;
  currency?: Currency;
}) {
  const { money } = createFormatters(currency);
  return (
    <section
      className={styles["summary-grid"]}
      aria-label="Основные показатели"
      aria-live="polite"
      aria-atomic="true"
    >
      <article className={styles["summary-card"]}>
        <div className={styles["metric-label"]}>
          Себестоимость чашки <span className={styles["metric-icon"]}>◎</span>
        </div>
        <div className={styles["metric-value"]}>
          {money(result?.productionCost ?? null)} <small>{currency}</small>
        </div>
        <div className={styles["metric-note"]}>
          Ингредиенты, потери и упаковка
        </div>
      </article>
      <article
        className={[
          styles["summary-card"],
          styles.featured,
          result && result.profit < 0 ? styles["loss-card"] : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div className={styles["metric-label"]}>
          {result && result.profit < 0
            ? "Прогноз убытка / месяц"
            : "Потенциальная прибыль / месяц"}{" "}
          <TrendingUp size={17} />
        </div>
        <div className={styles["metric-value"]} data-testid="monthly-profit">
          {money(result?.profit ?? null)} <small>{currency}</small>
        </div>
        <div className={styles["metric-note"]}>
          После всех указанных расходов
        </div>
      </article>
      <article className={styles["summary-card"]}>
        <div className={styles["metric-label"]}>
          Точка безубыточности <span className={styles["metric-icon"]}>↗</span>
        </div>
        <div className={styles["metric-value"]}>
          {integer(result?.breakEvenPerDay ?? null)} <small>чашек / день</small>
        </div>
        <div className={styles["metric-note"]}>
          {result?.breakEvenCups === null
            ? "Недостижима при текущей цене"
            : `${integer(result?.breakEvenCups ?? null)} чашек за рабочий месяц`}
        </div>
      </article>
    </section>
  );
}

export function Results({
  input,
  result,
  currency = "KGS",
}: {
  input: CalculatorInput;
  result: Calculation;
  currency?: Currency;
}) {
  const { money } = createFormatters(currency);
  const parts = [
    { label: "Кофе", value: result.parts.coffee, color: "#5c3a29" },
    { label: "Молоко", value: result.parts.milk, color: "#ba884d" },
    { label: "Сироп", value: result.parts.syrup, color: "#b59873" },
    { label: "Упаковка", value: result.parts.packaging, color: "#d7c6a8" },
    { label: "Потери сырья", value: result.parts.loss, color: "#e4d9c4" },
    { label: "Прочие на чашку", value: result.parts.other, color: "#b8a58f" },
  ];
  return (
    <aside className={styles["result-column"]} aria-label="Детали расчёта">
      <section className={styles["panel"] + " " + styles["breakdown"]}>
        <div className={styles["panel-heading"]}>
          <h2>Что внутри чашки</h2>
          <span className={styles["mini-tag"]}>1 порция</span>
        </div>
        <div className={styles["cost-total"]}>
          {money(result.productionCost)} <small>{currency}</small>
        </div>
        <div className={styles["cost-bar"]} aria-hidden="true">
          {parts.map((p) => (
            <span
              key={p.label}
              style={{ flex: p.value, background: p.color }}
            />
          ))}
        </div>
        <dl className={styles["breakdown-list"]}>
          {parts.map((p) => (
            <div key={p.label}>
              <dt>
                <i style={{ background: p.color }} />
                {p.label}
              </dt>
              <dd>
                {money(p.value)} <span>{currency}</span>
              </dd>
            </div>
          ))}
        </dl>
        <div className={styles["contribution-box"]}>
          <span>Маржинальная прибыль с чашки</span>
          <strong>
            {money(result.contribution)} {currency}
          </strong>
          <small>Цена − себестоимость − комиссии − налог с выручки</small>
        </div>
        <div className={styles["ratio-row"]}>
          <div>
            <span>Маржинальность</span>
            <strong>
              {decimal(result.contributionMargin)}
              {result.contributionMargin !== null && "%"}
            </strong>
          </div>
          <div>
            <span>Наценка на себестоимость</span>
            <strong>
              {decimal(result.markup)}
              {result.markup !== null && "%"}
            </strong>
          </div>
        </div>
      </section>
      <section className={styles["panel"] + " " + styles["forecast"]}>
        <div className={styles["panel-heading"]}>
          <h2>Месяц в цифрах</h2>
          <span className={styles["mini-tag"]}>
            {input.daysPerMonth} рабочих дней
          </span>
        </div>
        <dl className={styles["monthly-list"]}>
          <div>
            <dt>Продано чашек</dt>
            <dd>{integer(result.volume)}</dd>
          </div>
          <div>
            <dt>Выручка</dt>
            <dd>
              {money(result.revenue)} {currency}
            </dd>
          </div>
          <div>
            <dt>
              Переменные расходы{" "}
              <Info size={13} aria-label="Включая комиссии и налог с выручки" />
            </dt>
            <dd>
              −{money(result.variableTotal)} {currency}
            </dd>
          </div>
          <div>
            <dt>Постоянные расходы</dt>
            <dd>
              −{money(result.fixedCosts)} {currency}
            </dd>
          </div>
          <div
            className={[
              styles["profit-row"],
              result.profit < 0 ? styles.negative : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <dt>
              {result.profit < 0
                ? "Потенциальный убыток"
                : "Потенциальная прибыль"}
            </dt>
            <dd>
              {money(result.profit)} {currency}
            </dd>
          </div>
        </dl>
        <div className={styles["inline-note"]}>
          <Info size={16} />
          <span>
            Полная себестоимость с долей постоянных расходов:{" "}
            <strong>
              {money(result.fullCostPerCup)} {currency} / чашка
            </strong>
            {result.fullCostPerCup === null && " (нет продаж)"}
          </span>
        </div>
      </section>
      <section className={styles["panel"]}>
        <div className={styles["panel-heading"]}>
          <h2>Если продавать больше?</h2>
          <TrendingUp size={17} />
        </div>
        <Suspense
          fallback={
            <div className={styles["chart-loading"]}>Загрузка графика…</div>
          }
        >
          <ProfitChart input={input} currency={currency} />
        </Suspense>
        <table className={styles["scenario-table"]}>
          <caption>Три сценария спроса</caption>
          <thead>
            <tr>
              <th scope="col">Спрос</th>
              <th scope="col">Чашек / день</th>
              <th scope="col">Прибыль / мес.</th>
            </tr>
          </thead>
          <tbody>
            {compareDemand(input, currencyDigits(currency)).map((s) => (
              <tr
                key={s.factor}
                className={s.factor === 1 ? styles["base-scenario"] : undefined}
              >
                <th scope="row">
                  {s.factor < 1 ? (
                    <>
                      <ArrowDownRight size={13} /> −20%
                    </>
                  ) : s.factor > 1 ? (
                    <>
                      <ArrowUpRight size={13} /> +20%
                    </>
                  ) : (
                    "Текущий"
                  )}
                </th>
                <td>{integer(s.cupsPerDay)}</td>
                <td>
                  {money(s.result.profit)} {currency}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </aside>
  );
}
