import { describe, expect, it } from "vitest";
import { calculate, calculatorSchema } from "./calculator";
import { defaultInput, compareDemand } from "../application/scenarios";

describe("unit economics", () => {
  it("matches an independently worked example including loss, fees and tax", () => {
    // Ingredients: 20 + 10 = 30. With 20% loss: 30 / .8 = 37.5.
    // Production: 37.5 + 5 + 2 = 44.5. Contribution: 100 - 44.5 - 2 - 3 = 50.5.
    // 200 cups: 20,000 revenue - 9,900 variable - 10,000 fixed = 100.
    const result = calculate({
      ...defaultInput,
      coffeePrice: 1000,
      dose: 20,
      milkPrice: 100,
      milk: 100,
      syrup: 0,
      packaging: 5,
      otherPerCup: 2,
      lossPercent: 20,
      salePrice: 100,
      feePercent: 2,
      turnoverTaxPercent: 3,
      cupsPerDay: 10,
      daysPerMonth: 20,
      rent: 10000,
      salaries: 0,
      utilities: 0,
      otherFixed: 0,
    });
    expect(result).toMatchObject({
      productionCost: 44.5,
      variableCost: 49.5,
      contribution: 50.5,
      contributionMargin: 50.5,
      volume: 200,
      revenue: 20000,
      variableTotal: 9900,
      fixedCosts: 10000,
      profit: 100,
      breakEvenCups: 199,
      breakEvenPerDay: 10,
      fullCostPerCup: 99.5,
    });
  });

  it("does not round cup costs before calculating monthly totals", () => {
    const result = calculate(defaultInput);
    expect(result.productionCost).toBe(62.82);
    expect(result.profit).toBe(97649.89);
    expect(result.profit).not.toBe((180 - 62.82 - 3.6) * 1300 - 50000);
    expect(result.breakEvenCups).toBe(441);
    expect(result.breakEvenPerDay).toBe(17);
  });

  it("keeps fixed expenses when sales are zero", () => {
    expect(calculate({ ...defaultInput, cupsPerDay: 0 })).toMatchObject({
      revenue: 0,
      profit: -50000,
      volume: 0,
      fullCostPerCup: null,
    });
  });

  it("reports unreachable break-even when each sale loses money", () => {
    expect(calculate({ ...defaultInput, salePrice: 10 })).toMatchObject({
      breakEvenCups: null,
      breakEvenPerDay: null,
    });
  });

  it("handles zero contribution without division by zero", () => {
    expect(
      calculate({
        ...defaultInput,
        coffeePrice: 0,
        milk: 0,
        syrup: 0,
        packaging: 10,
        otherPerCup: 0,
        salePrice: 10,
        feePercent: 0,
      }),
    ).toMatchObject({ contribution: 0, breakEvenCups: null });
  });

  it("supports zero fixed expenses and zero-cost ingredients", () => {
    expect(
      calculate({
        ...defaultInput,
        coffeePrice: 0,
        milk: 0,
        syrup: 0,
        packaging: 0,
        otherPerCup: 0,
        rent: 0,
        salaries: 0,
        utilities: 0,
        otherFixed: 0,
      }),
    ).toMatchObject({ productionCost: 0, markup: null, breakEvenCups: 0 });
  });

  it("handles free drinks and losses without clamping profit", () => {
    const r = calculate({ ...defaultInput, salePrice: 0 });
    expect(r.contributionMargin).toBeNull();
    expect(r.profit).toBeLessThan(-50000);
  });

  it("applies ingredient losses without inflating packaging cost", () => {
    const r = calculate({
      ...defaultInput,
      coffeePrice: 0,
      milk: 0,
      syrup: 0,
      packaging: 10,
      otherPerCup: 5,
      lossPercent: 50,
    });
    expect(r.productionCost).toBe(15);
    expect(r.parts.loss).toBe(0);
  });

  it.each([
    { daysPerMonth: 0 },
    { daysPerMonth: 32 },
    { daysPerMonth: 2.5 },
    { cupsPerDay: -1 },
    { cupsPerDay: 10001 },
    { cupsPerDay: 1.5 },
    { coffeePrice: NaN },
    { coffeePrice: Infinity },
    { lossPercent: 100 },
    { feePercent: 60, turnoverTaxPercent: 41 },
  ])("rejects an invalid scenario: %j", (overrides) => {
    expect(
      calculatorSchema.safeParse({ ...defaultInput, ...overrides }).success,
    ).toBe(false);
    expect(() => calculate({ ...defaultInput, ...overrides })).toThrow();
  });

  it("uses the same model for all demand scenarios and leaves input unchanged", () => {
    const before = { ...defaultInput };
    const scenarios = compareDemand(defaultInput);
    expect(scenarios.map((s) => s.cupsPerDay)).toEqual([40, 50, 60]);
    expect(scenarios[1].result).toEqual(calculate(defaultInput));
    expect(scenarios[0].result.profit).toBeLessThan(scenarios[1].result.profit);
    expect(scenarios[2].result.profit).toBeGreaterThan(
      scenarios[1].result.profit,
    );
    expect(defaultInput).toEqual(before);
  });

  it("rounds currency results without rounding per-cup costs before monthly totals", () => {
    const input = {
      ...defaultInput,
      coffeePrice: 100,
      dose: 18,
      milk: 0,
      syrup: 0,
      lossPercent: 0,
      packaging: 0,
      otherPerCup: 0,
      feePercent: 0,
      turnoverTaxPercent: 0,
      salePrice: 10,
      cupsPerDay: 3,
      daysPerMonth: 1,
      rent: 0,
      salaries: 0,
      utilities: 0,
      otherFixed: 0,
    };
    const yen = calculate(input, 0);
    expect(yen.productionCost).toBe(2);
    expect(yen.variableTotal).toBe(5);
    expect(yen.profit).toBe(25);
    const dinar = calculate({ ...input, coffeePrice: 1.234, dose: 1 }, 3);
    expect(dinar.productionCost).toBe(0.001);
    expect(dinar.variableTotal).toBe(0.004);
    expect(dinar.profit).toBe(29.996);
    expect(() => calculate(input, 4)).toThrow();
  });
});
