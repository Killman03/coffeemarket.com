"use client";
import { lazy, Suspense } from "react";
import { ArrowDownRight, ArrowUpRight, Info, TrendingUp } from "lucide-react";
import type { CalculatorInput, Calculation } from "../domain/calculator";
import { compareDemand } from "../application/scenarios";
import { formatInteger as integer, formatMoney as money } from "./format";
const ProfitChart = lazy(() =>
  import("./ProfitChart").then((module) => ({ default: module.ProfitChart })),
);

export function Summary({ result }: { result: Calculation | null }) {
  return (
    <section
      className="summary-grid"
      aria-label="Основные показатели"
      aria-live="polite"
      aria-atomic="true"
    >
      <article className="summary-card">
        <div className="metric-label">
          Себестоимость чашки <span className="metric-icon">◎</span>
        </div>
        <div className="metric-value">
          {money(result?.productionCost ?? null)} <small>сом</small>
        </div>
        <div className="metric-note">Ингредиенты, потери и упаковка</div>
      </article>
      <article
        className={`summary-card featured${result && result.profit < 0 ? " loss-card" : ""}`}
      >
        <div className="metric-label">
          {result && result.profit < 0
            ? "Прогноз убытка / месяц"
            : "Потенциальная прибыль / месяц"}{" "}
          <TrendingUp size={17} />
        </div>
        <div className="metric-value" data-testid="monthly-profit">
          {money(result?.profit ?? null)} <small>сом</small>
        </div>
        <div className="metric-note">После всех указанных расходов</div>
      </article>
      <article className="summary-card">
        <div className="metric-label">
          Точка безубыточности <span className="metric-icon">↗</span>
        </div>
        <div className="metric-value">
          {integer(result?.breakEvenPerDay ?? null)} <small>чашек / день</small>
        </div>
        <div className="metric-note">
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
}: {
  input: CalculatorInput;
  result: Calculation;
}) {
  const parts = [
    { label: "Кофе", value: result.parts.coffee, color: "#385644" },
    { label: "Молоко", value: result.parts.milk, color: "#91a27b" },
    { label: "Сироп", value: result.parts.syrup, color: "#b59873" },
    { label: "Упаковка", value: result.parts.packaging, color: "#d7c6a8" },
    { label: "Потери сырья", value: result.parts.loss, color: "#e4d9c4" },
    { label: "Прочие на чашку", value: result.parts.other, color: "#c3cbc0" },
  ];
  return (
    <aside className="result-column" aria-label="Детали расчёта">
      <section className="panel breakdown">
        <div className="panel-heading">
          <h2>Что внутри чашки</h2>
          <span className="mini-tag">1 порция</span>
        </div>
        <div className="cost-total">
          {money(result.productionCost)} <small>сом</small>
        </div>
        <div className="cost-bar" aria-hidden="true">
          {parts.map((p) => (
            <span
              key={p.label}
              style={{ flex: p.value, background: p.color }}
            />
          ))}
        </div>
        <dl className="breakdown-list">
          {parts.map((p) => (
            <div key={p.label}>
              <dt>
                <i style={{ background: p.color }} />
                {p.label}
              </dt>
              <dd>
                {money(p.value)} <span>сом</span>
              </dd>
            </div>
          ))}
        </dl>
        <div className="contribution-box">
          <span>Маржинальная прибыль с чашки</span>
          <strong>{money(result.contribution)} сом</strong>
          <small>Цена − себестоимость − комиссии − налог с выручки</small>
        </div>
        <div className="ratio-row">
          <div>
            <span>Маржинальность</span>
            <strong>
              {money(result.contributionMargin)}
              {result.contributionMargin !== null && "%"}
            </strong>
          </div>
          <div>
            <span>Наценка на себестоимость</span>
            <strong>
              {money(result.markup)}
              {result.markup !== null && "%"}
            </strong>
          </div>
        </div>
      </section>
      <section className="panel forecast">
        <div className="panel-heading">
          <h2>Месяц в цифрах</h2>
          <span className="mini-tag">{input.daysPerMonth} рабочих дней</span>
        </div>
        <dl className="monthly-list">
          <div>
            <dt>Продано чашек</dt>
            <dd>{integer(result.volume)}</dd>
          </div>
          <div>
            <dt>Выручка</dt>
            <dd>{money(result.revenue)} сом</dd>
          </div>
          <div>
            <dt>
              Переменные расходы{" "}
              <Info size={13} aria-label="Включая комиссии и налог с выручки" />
            </dt>
            <dd>−{money(result.variableTotal)} сом</dd>
          </div>
          <div>
            <dt>Постоянные расходы</dt>
            <dd>−{money(result.fixedCosts)} сом</dd>
          </div>
          <div className={`profit-row${result.profit < 0 ? " negative" : ""}`}>
            <dt>
              {result.profit < 0
                ? "Потенциальный убыток"
                : "Потенциальная прибыль"}
            </dt>
            <dd>{money(result.profit)} сом</dd>
          </div>
        </dl>
        <div className="inline-note">
          <Info size={16} />
          <span>
            Полная себестоимость с долей постоянных расходов:{" "}
            <strong>{money(result.fullCostPerCup)} сом / чашка</strong>
            {result.fullCostPerCup === null && " (нет продаж)"}
          </span>
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>Если продавать больше?</h2>
          <TrendingUp size={17} />
        </div>
        <Suspense
          fallback={<div className="chart-loading">Загрузка графика…</div>}
        >
          <ProfitChart input={input} />
        </Suspense>
        <table className="scenario-table">
          <caption>Три сценария спроса</caption>
          <thead>
            <tr>
              <th scope="col">Спрос</th>
              <th scope="col">Чашек / день</th>
              <th scope="col">Прибыль / мес.</th>
            </tr>
          </thead>
          <tbody>
            {compareDemand(input).map((s) => (
              <tr
                key={s.factor}
                className={s.factor === 1 ? "base-scenario" : ""}
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
                <td>{money(s.result.profit)} сом</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </aside>
  );
}
