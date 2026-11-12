import { describe, expect, it } from "vitest";
import {
  catalogIsCompatible,
  contextSchema,
  currencies,
  currencyDigits,
  defaultContext,
  markets,
} from "./markets";
import {
  createInitialInput,
  createScenario,
  defaultInput,
  scenarioSchema,
} from "../application/scenarios";
import { catalogRepository } from "../infrastructure/catalog-repository";

describe("market contexts", () => {
  it("keeps market and currency independent and rejects unsupported codes", () => {
    expect(contextSchema.parse({ market: "KZ", currency: "USD" })).toEqual({
      market: "KZ",
      currency: "USD",
    });
    expect(
      contextSchema.safeParse({ market: "KG", currency: "XXX" }).success,
    ).toBe(false);
    expect(markets).toHaveLength(5);
    expect(currencies).toHaveLength(8);
  });

  it("uses ISO currency precision including zero and three minor digits", () => {
    expect(currencyDigits("KGS")).toBe(2);
    expect(currencyDigits("JPY")).toBe(0);
    expect(currencyDigits("KWD")).toBe(3);
  });

  it("only offers connected catalog in its exact market and currency", () => {
    const catalog = catalogRepository.getCatalog();
    expect(catalogIsCompatible(defaultContext, catalog)).toBe(true);
    expect(
      catalogIsCompatible({ market: "KG", currency: "USD" }, catalog),
    ).toBe(false);
    expect(
      catalogIsCompatible({ market: "KZ", currency: "KGS" }, catalog),
    ).toBe(false);
    expect(catalogIsCompatible(defaultContext)).toBe(false);
  });

  it("initializes foreign contexts without invented prices or tax rates", () => {
    const input = createInitialInput(
      { market: "KZ", currency: "KZT" },
      catalogRepository.getCatalog(),
    );
    expect(input).toMatchObject({
      coffeePrice: 0,
      milkPrice: 0,
      salePrice: 0,
      rent: 0,
      salaries: 0,
      utilities: 0,
      otherFixed: 0,
      feePercent: 0,
      turnoverTaxPercent: 0,
    });
    expect(input.dose).toBe(defaultInput.dose);
    expect(input.daysPerMonth).toBe(defaultInput.daysPerMonth);
    expect(
      createInitialInput({ market: "KG", currency: "USD" }).salePrice,
    ).toBe(0);
  });

  it("retains the existing explicitly Kyrgyz demonstration", () => {
    expect(createInitialInput(defaultContext)).toEqual(defaultInput);
    expect(
      createInitialInput(defaultContext, catalogRepository.getCatalog())
        .coffeePrice,
    ).toBe(1899);
  });

  it("migrates legacy imports explicitly to KG/KGS", () => {
    const savedAt = "2026-11-12T00:00:00.000Z";
    expect(
      scenarioSchema.parse({ version: 1, savedAt, input: defaultInput }),
    ).toEqual({
      version: 2,
      savedAt,
      input: defaultInput,
      context: defaultContext,
    });
    const context = { market: "OTHER", currency: "KWD" } as const;
    expect(
      createScenario(defaultInput, new Date(savedAt), context).context,
    ).toEqual(context);
    expect(
      scenarioSchema.safeParse({
        version: 3,
        savedAt,
        input: defaultInput,
        context,
      }).success,
    ).toBe(false);
  });
});
