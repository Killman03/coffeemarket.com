import { z } from "zod";
import Decimal from "decimal.js";

export const coffeeProductSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  price: z.number().finite().positive(),
  packageGrams: z.number().finite().positive(),
  stock: z.number().int().nonnegative(),
  url: z.string().url(),
  updatedAt: z.string().datetime({ offset: true }),
});

export const catalogSchema = z.object({
  source: z.literal("CoffeeMarket MCP / get_business_context"),
  fetchedAt: z.string().datetime({ offset: true }),
  currency: z.literal("KGS"),
  products: z.array(coffeeProductSchema).min(1),
});

export type Catalog = z.infer<typeof catalogSchema>;

/** Converts an explicitly known package size to a per-kilogram price.
 *
 * Args:
 *   product: Validated catalog entry with an explicit package weight.
 *
 * Returns:
 *   KGS per kilogram, without premature rounding.
 */
export function pricePerKilogram(
  product: z.infer<typeof coffeeProductSchema>,
): number {
  return new Decimal(product.price)
    .times(1000)
    .div(product.packageGrams)
    .toNumber();
}

/** Port for catalog access; hosting and transport remain adapter details. */
export interface CatalogRepository {
  getCatalog(): Catalog;
}
