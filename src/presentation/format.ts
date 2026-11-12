import { currencyDigits, type Currency } from "../domain/markets";

/** Builds Russian presentation formatters for a scenario currency.
 *
 * Args:
 *   currency: Validated ISO currency code, independent of the selected market.
 *
 * Returns:
 *   A decimal formatter; units are rendered separately beside the amount.
 */
export function createFormatters(currency: Currency) {
  const formatter = new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: currencyDigits(currency),
    minimumFractionDigits: 0,
  });
  return {
    money: (value: number | null) =>
      value === null ? "—" : formatter.format(value),
  };
}
const integerFormatter = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 0,
});
export const formatMoney = createFormatters("KGS").money;
export const formatInteger = (value: number | null) =>
  value === null ? "—" : integerFormatter.format(value);
