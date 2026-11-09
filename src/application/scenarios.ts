import { z } from "zod";
import {
  calculatorSchema,
  calculate,
  type CalculatorInput,
} from "../domain/calculator";

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

export const scenarioSchema = z.object({
  version: z.literal(1),
  savedAt: z.string().datetime(),
  input: calculatorSchema,
});
export type Scenario = z.infer<typeof scenarioSchema>;

/** Builds demand scenarios through the same calculation use case.
 *
 * Args:
 *   input: Validated base scenario.
 *
 * Returns:
 *   Low, base and high demand results with unchanged prices and recipes.
 */
export function compareDemand(input: CalculatorInput) {
  return [0.8, 1, 1.2].map((factor) => {
    const cupsPerDay = Math.min(10000, Math.round(input.cupsPerDay * factor));
    return { factor, cupsPerDay, result: calculate({ ...input, cupsPerDay }) };
  });
}

/** Serializes a versioned scenario without embedding catalog or credentials. */
export function createScenario(
  input: CalculatorInput,
  now = new Date(),
): Scenario {
  return scenarioSchema.parse({
    version: 1,
    savedAt: now.toISOString(),
    input,
  });
}
