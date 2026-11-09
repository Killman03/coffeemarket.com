import Decimal from "decimal.js";
import { z } from "zod";

const amount = z
  .number({ error: "Введите конечное число" })
  .finite()
  .min(0, "Не меньше нуля")
  .max(1_000_000_000, "Слишком большое значение");
const percent = amount.max(100, "Не больше 100%");

export const calculatorSchema = z
  .object({
    coffeePrice: amount,
    dose: amount.max(100, "Не больше 100 г"),
    milkPrice: amount,
    milk: amount.max(1000, "Не больше 1 000 мл"),
    syrupPrice: amount,
    syrup: amount.max(200, "Не больше 200 мл"),
    packaging: amount,
    otherPerCup: amount,
    lossPercent: percent.max(90, "Потери должны быть не больше 90%"),
    salePrice: amount,
    cupsPerDay: amount.int("Целое число").max(10000, "Не больше 10 000 чашек"),
    daysPerMonth: amount
      .int("Целое число")
      .min(1, "Минимум 1 день")
      .max(31, "Не больше 31 дня"),
    rent: amount,
    salaries: amount,
    utilities: amount,
    otherFixed: amount,
    feePercent: percent,
    turnoverTaxPercent: percent,
  })
  .superRefine((value, context) => {
    if (value.feePercent + value.turnoverTaxPercent > 100) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["turnoverTaxPercent"],
        message: "Сумма удержаний не может превышать 100%",
      });
    }
  });

export type CalculatorInput = z.infer<typeof calculatorSchema>;
const Money = Decimal.clone({ precision: 32, rounding: Decimal.ROUND_HALF_UP });
const money = (value: Decimal) => value.toDecimalPlaces(2).toNumber();

/** Calculates one-drink unit economics using decimal arithmetic.
 *
 * Args:
 *   raw: Untrusted scenario values, validated at the domain boundary.
 *
 * Returns:
 *   Unit costs, monthly results and break-even volume in KGS. Undefined
 *   ratios and unreachable break-even are null. Totals use unrounded costs.
 */
export function calculate(raw: CalculatorInput) {
  const input = calculatorSchema.parse(raw);
  const coffee = new Money(input.coffeePrice).times(input.dose).div(1000);
  const milk = new Money(input.milkPrice).times(input.milk).div(1000);
  const syrup = new Money(input.syrupPrice).times(input.syrup).div(1000);
  const ingredients = coffee.plus(milk).plus(syrup);
  const loss = ingredients
    .div(new Money(1).minus(new Money(input.lossPercent).div(100)))
    .minus(ingredients);
  const production = ingredients
    .plus(loss)
    .plus(input.packaging)
    .plus(input.otherPerCup);
  const fee = new Money(input.salePrice).times(input.feePercent).div(100);
  const turnoverTax = new Money(input.salePrice)
    .times(input.turnoverTaxPercent)
    .div(100);
  const variable = production.plus(fee).plus(turnoverTax);
  const contribution = new Money(input.salePrice).minus(variable);
  const volume = input.cupsPerDay * input.daysPerMonth;
  const fixed = new Money(input.rent)
    .plus(input.salaries)
    .plus(input.utilities)
    .plus(input.otherFixed);
  const revenue = new Money(input.salePrice).times(volume);
  const variableTotal = variable.times(volume);
  const contributionTotal = contribution.times(volume);
  const profit = contributionTotal.minus(fixed);
  const breakEvenCups = contribution.gt(0)
    ? fixed.div(contribution).ceil().toNumber()
    : null;
  return {
    parts: {
      coffee: money(coffee),
      milk: money(milk),
      syrup: money(syrup),
      loss: money(loss),
      packaging: input.packaging,
      other: input.otherPerCup,
      fee: money(fee),
      turnoverTax: money(turnoverTax),
    },
    productionCost: money(production),
    variableCost: money(variable),
    contribution: money(contribution),
    contributionMargin:
      input.salePrice > 0
        ? contribution
            .div(input.salePrice)
            .times(100)
            .toDecimalPlaces(2)
            .toNumber()
        : null,
    markup: production.gt(0)
      ? new Money(input.salePrice)
          .minus(production)
          .div(production)
          .times(100)
          .toDecimalPlaces(2)
          .toNumber()
      : null,
    volume,
    fixedCosts: money(fixed),
    revenue: money(revenue),
    variableTotal: money(variableTotal),
    contributionTotal: money(contributionTotal),
    profit: money(profit),
    fullCostPerCup: volume > 0 ? money(variable.plus(fixed.div(volume))) : null,
    breakEvenCups,
    breakEvenPerDay:
      breakEvenCups === null
        ? null
        : new Money(breakEvenCups).div(input.daysPerMonth).ceil().toNumber(),
  };
}

export type Calculation = ReturnType<typeof calculate>;
