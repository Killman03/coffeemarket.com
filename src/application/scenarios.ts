import { z } from "zod";
import {
  calculatorSchema,
  calculate,
  type CalculatorInput,
} from "../domain/calculator";
import { pricePerKilogram, type Catalog } from "../domain/catalog";
import {
  catalogIsCompatible,
  contextSchema,
  defaultContext,
  type MarketContext,
} from "../domain/markets";

export const presets = {
  cappuccino: {
    name: "Капучино",
    volume: "250 мл",
    dose: 18,
    milk: 160,
    syrup: 0,
    salePrice: 180,
  },
  latte: {
    name: "Латте",
    volume: "350 мл",
    dose: 18,
    milk: 240,
    syrup: 0,
    salePrice: 200,
  },
  americano: {
    name: "Американо",
    volume: "200 мл",
    dose: 18,
    milk: 0,
    syrup: 0,
    salePrice: 130,
  },
  espresso: {
    name: "Эспрессо",
    volume: "40 мл",
    dose: 18,
    milk: 0,
    syrup: 0,
    salePrice: 100,
  },
} as const;

export const defaultInput: CalculatorInput = {
  coffeePrice: 1899,
  dose: 18,
  milkPrice: 100,
  milk: 160,
  syrupPrice: 600,
  syrup: 0,
  packaging: 8,
  otherPerCup: 2,
  lossPercent: 5,
  salePrice: 180,
  cupsPerDay: 50,
  daysPerMonth: 26,
  rent: 20000,
  salaries: 25000,
  utilities: 3000,
  otherFixed: 2000,
  feePercent: 2,
  turnoverTaxPercent: 0,
};

const legacyScenarioSchema = z.object({
  version: z.literal(1),
  savedAt: z.string().datetime(),
  input: calculatorSchema,
});
const currentScenarioSchema = z.object({
  version: z.literal(2),
  context: contextSchema,
  savedAt: z.string().datetime(),
  input: calculatorSchema,
});
export const scenarioSchema = z.union([
  currentScenarioSchema,
  legacyScenarioSchema.transform((scenario) => ({
    ...scenario,
    version: 2 as const,
    context: { ...defaultContext },
  })),
]);
export type Scenario = z.infer<typeof scenarioSchema>;

/** Creates an initial scenario without inventing local market prices.
 *
 * Args:
 *   context: Market and currency of the new scenario.
 *   catalog: Optional validated catalog matching the selected context.
 *
 * Returns:
 *   Existing Kyrgyz demonstration or a manual scenario with zero prices.
 */
export function createInitialInput(
  context: MarketContext,
  catalog?: Catalog,
): CalculatorInput {
  const validated = contextSchema.parse(context);
  if (validated.market === "KG" && validated.currency === "KGS") {
    const product = catalogIsCompatible(validated, catalog)
      ? catalog?.products.find((item) => item.stock > 0)
      : undefined;
    return {
      ...defaultInput,
      coffeePrice: product
        ? pricePerKilogram(product)
        : defaultInput.coffeePrice,
    };
  }
  return {
    ...defaultInput,
    coffeePrice: 0,
    milkPrice: 0,
    syrupPrice: 0,
    packaging: 0,
    otherPerCup: 0,
    salePrice: 0,
    rent: 0,
    salaries: 0,
    utilities: 0,
    otherFixed: 0,
    feePercent: 0,
    turnoverTaxPercent: 0,
  };
}

/** Builds demand scenarios through the same calculation use case.
 *
 * Args:
 *   input: Validated base scenario.
 *   precision: Monetary decimal places for the selected currency.
 *
 * Returns:
 *   Low, base and high demand results with unchanged prices and recipes.
 */
export function compareDemand(input: CalculatorInput, precision = 2) {
  return [0.8, 1, 1.2].map((factor) => {
    const cupsPerDay = Math.min(10000, Math.round(input.cupsPerDay * factor));
    return {
      factor,
      cupsPerDay,
      result: calculate({ ...input, cupsPerDay }, precision),
    };
  });
}

/** Serializes a validated scenario with explicit market and currency.
 *
 * Args:
 *   input: Scenario values to validate and serialize.
 *   now: Timestamp for deterministic exports and tests.
 *   context: Explicit monetary context; legacy callers use KG/KGS.
 *
 * Returns:
 *   Current version scenario without catalog data or credentials.
 */
export function createScenario(
  input: CalculatorInput,
  now = new Date(),
  context: MarketContext = defaultContext,
): Scenario {
  return scenarioSchema.parse({
    version: 2,
    context,
    savedAt: now.toISOString(),
    input,
  });
}
