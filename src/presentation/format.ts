const moneyFormatter = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});
const integerFormatter = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 0,
});
export const formatMoney = (value: number | null) =>
  value === null ? "—" : moneyFormatter.format(value);
export const formatInteger = (value: number | null) =>
  value === null ? "—" : integerFormatter.format(value);
