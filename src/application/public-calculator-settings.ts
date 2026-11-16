import type { CalculatorInput } from "../domain/calculator";
import type { Catalog } from "../domain/catalog";
import type { MarketContext } from "../domain/markets";
import type { PublicSettings } from "../domain/site-settings";
import { createInitialInput } from "./scenarios";

/** Resolves initial values without replacing configured prices with catalog data.
 *
 * Args:
 *   context: Selected market and currency.
 *   catalog: Validated public catalog for unconfigured demonstration values.
 *   settings: Optional administrator-defined defaults, validated by the caller.
 *
 * Returns:
 *   An independent input object; callers can edit it without changing defaults.
 */
export function initialCalculatorInput(
  context: MarketContext,
  catalog: Catalog,
  settings?: PublicSettings,
): CalculatorInput {
  return settings
    ? { ...settings.defaults[context.currency] }
    : createInitialInput(context, catalog);
}
