import { z } from "zod";

export const marketSchema = z.enum(["KG", "KZ", "UZ", "RU", "OTHER"]);
export const currencySchema = z.enum([
  "KGS",
  "KZT",
  "UZS",
  "RUB",
  "USD",
  "EUR",
  "JPY",
  "KWD",
]);
export const contextSchema = z.object({
  market: marketSchema,
  currency: currencySchema,
});

export type MarketContext = z.infer<typeof contextSchema>;
export type Currency = z.infer<typeof currencySchema>;

export const markets = [
  { code: "KG", name: "Кыргызстан", currency: "KGS" },
  { code: "KZ", name: "Казахстан", currency: "KZT" },
  { code: "UZ", name: "Узбекистан", currency: "UZS" },
  { code: "RU", name: "Россия", currency: "RUB" },
  { code: "OTHER", name: "Другая страна", currency: "USD" },
] as const satisfies readonly {
  code: MarketContext["market"];
  name: string;
  currency: Currency;
}[];

export const currencies = [
  { code: "KGS", name: "Кыргызский сом" },
  { code: "KZT", name: "Казахстанский тенге" },
  { code: "UZS", name: "Узбекский сум" },
  { code: "RUB", name: "Российский рубль" },
  { code: "USD", name: "Доллар США" },
  { code: "EUR", name: "Евро" },
  { code: "JPY", name: "Японская иена" },
  { code: "KWD", name: "Кувейтский динар" },
] as const satisfies readonly { code: Currency; name: string }[];

export const defaultContext: MarketContext = { market: "KG", currency: "KGS" };

/** Returns currency precision from the standard internationalization database.
 *
 * Args:
 *   currency: Supported ISO 4217 currency code.
 *
 * Returns:
 *   Number of minor-unit decimal places used for monetary results.
 */
export function currencyDigits(currency: Currency): number {
  return (
    new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency: currencySchema.parse(currency),
    }).resolvedOptions().maximumFractionDigits ?? 2
  );
}

/** Determines whether catalog prices can be used without currency conversion.
 *
 * Args:
 *   context: Market and currency of the scenario.
 *   catalog: Optional catalog provenance and currency.
 *
 * Returns:
 *   Whether the connected Kyrgyz catalog matches this exact context.
 */
export function catalogIsCompatible(
  context: MarketContext,
  catalog?: { currency: string; market?: string },
): boolean {
  return (
    context.market === "KG" &&
    context.currency === "KGS" &&
    catalog !== undefined &&
    catalog.currency === context.currency &&
    (catalog.market ?? "KG") === context.market
  );
}
