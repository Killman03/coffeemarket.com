import { z } from "zod";
import {
  calculatorSchema,
  calculate,
  type CalculatorInput,
} from "../domain/calculator";
import { pricePerKilogram, type Catalog } from "../domain/catalog";
import { demoPrices } from "./demo-prices";
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

/** Creates a populated, explicitly illustrative scenario in its own currency.
 *
 * Args:
 *   context: Market and currency of the new scenario.
 *   catalog: Optional validated catalog matching the selected context.
 *
 * Returns:
 *   Demonstration inputs; matching catalog prices are used only in KG/KGS.
 *   Optional unused ingredients and unspecified turnover tax remain zero.
 */
export function createInitialInput(
  context: MarketContext,
  catalog?: Catalog,
): CalculatorInput {
  const validated = contextSchema.parse(context);
  const initial = {
    ...defaultInput,
    ...(validated.currency === "KGS" ? {} : demoPrices[validated.currency]),
    cupsPerDay:
      validated.market === "KG" && validated.currency === "KGS"
        ? defaultInput.cupsPerDay
        : 20,
  };
  const product = catalogIsCompatible(validated, catalog)
    ? catalog?.products.find((item) => item.stock > 0)
    : undefined;
  return calculatorSchema.parse({
    ...initial,
    ...(product ? { coffeePrice: pricePerKilogram(product) } : {}),
  });
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
