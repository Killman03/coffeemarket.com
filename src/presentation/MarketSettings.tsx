"use client";

import { useId, useState } from "react";
import { ArrowRight, Globe2 } from "lucide-react";
import { currencies, markets, type MarketContext } from "../domain/markets";
import styles from "./Calculator.module.css";

/** Lets users explicitly switch market scenarios without implicit FX conversion.
 *
 * Args:
 *   context: Current scenario identity.
 *   onChange: Switches to the separately stored target after confirmation.
 *
 * Returns:
 *   Accessible controls and an inline confirmation for changing money units.
 */
export function MarketSettings({
  context,
  onChange,
}: {
  context: MarketContext;
  onChange: (next: MarketContext) => void;
}) {
  const id = useId();
  const [pending, setPending] = useState<MarketContext | null>(null);
  const nextMarket = markets.find((item) => item.code === pending?.market);
  return (
    <section className={styles["market-settings"]} aria-label="Рынок и валюта">
      <div className={styles["market-heading"]}>
        <Globe2 size={19} />
        <div>
          <strong>Где вы планируете работать?</strong>
          <p>Один сценарий — один рынок и одна валюта</p>
        </div>
      </div>
      <div className={styles["market-controls"]}>
        <div>
          <label htmlFor={id + "-market"}>Рынок</label>
          <select
            id={id + "-market"}
            value={context.market}
            onChange={(event) => {
              const market = markets.find(
                (item) => item.code === event.target.value,
              )!;
              setPending({ market: market.code, currency: market.currency });
            }}
          >
            {markets.map((market) => (
              <option key={market.code} value={market.code}>
                {market.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={id + "-currency"}>Валюта расчёта</label>
          <select
            id={id + "-currency"}
            value={context.currency}
            onChange={(event) =>
              setPending({
                ...context,
                currency: event.target.value as MarketContext["currency"],
              })
            }
          >
            {currencies.map((currency) => (
              <option key={currency.code} value={currency.code}>
                {currency.code} · {currency.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {pending &&
        (pending.market !== context.market ||
          pending.currency !== context.currency) && (
          <div
            className={styles["market-confirm"]}
            role="group"
            aria-label="Подтверждение смены сценария"
          >
            <div>
              <strong>
                {nextMarket?.name} · {pending.currency}
              </strong>
              <p>
                Откроется отдельный сценарий. Текущий расчёт будет сохранён.
                Суммы не конвертируются и не переносятся в другую валюту.
              </p>
            </div>
            <button
              className={styles["primary-button"]}
              onClick={() => {
                onChange(pending);
                setPending(null);
              }}
            >
              Перейти <ArrowRight size={15} />
            </button>
            <button
              className={styles["secondary-button"]}
              onClick={() => setPending(null)}
            >
              Отмена
            </button>
          </div>
        )}
    </section>
  );
}
