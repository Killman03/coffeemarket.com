import { describe, expect, it } from "vitest";
import { BrowserScenarioStore } from "./scenario-storage";
import {
  createScenario,
  defaultInput,
  scenarioSchema,
} from "../application/scenarios";
import { defaultContext } from "../domain/markets";
import { catalogRepository } from "./catalog-repository";

function store() {
  const values = new Map<string, string>();
  return new BrowserScenarioStore({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  });
}

describe("data adapters", () => {
  it("round-trips a versioned, validated scenario", () => {
    const adapter = store();
    expect(adapter.load()).toBeNull();
    adapter.save(defaultInput);
    expect(adapter.load()?.input).toEqual(defaultInput);
    expect(adapter.load()?.version).toBe(2);
    expect(adapter.load()?.context).toEqual(defaultContext);
  });

  it("rejects corrupt saved data", () => {
    const adapter = new BrowserScenarioStore({
      getItem: () => "{bad",
      setItem: () => {},
    });
    expect(() => adapter.load()).toThrow();
  });

  it("rejects unknown versions and incomplete imports", () => {
    expect(
      scenarioSchema.safeParse({
        version: 3,
        savedAt: new Date().toISOString(),
        input: defaultInput,
      }).success,
    ).toBe(false);
    expect(scenarioSchema.safeParse({ version: 1, input: {} }).success).toBe(
      false,
    );
  });

  it("isolates markets and currencies without relabeling monetary values", () => {
    const adapter = store();
    const kazakhstan = { market: "KZ", currency: "KZT" } as const;
    const dollars = { market: "KZ", currency: "USD" } as const;
    adapter.save(defaultInput);
    expect(adapter.load(kazakhstan)).toBeNull();
    adapter.save({ ...defaultInput, rent: 700000 }, kazakhstan);
    adapter.save({ ...defaultInput, rent: 1500 }, dollars);
    expect(adapter.load()?.input.rent).toBe(20000);
    expect(adapter.load(kazakhstan)?.input.rent).toBe(700000);
    expect(adapter.load(dollars)?.input.rent).toBe(1500);
  });

  it("migrates old storage into KG/KGS only", () => {
    const values = new Map<string, string>([
      [
        "coffeemarket.calculator.v1",
        JSON.stringify({
          version: 1,
          savedAt: new Date().toISOString(),
          input: defaultInput,
        }),
      ],
    ]);
    const adapter = new BrowserScenarioStore({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
    });
    expect(adapter.load({ market: "KG", currency: "USD" })).toBeNull();
    expect(adapter.load()?.context).toEqual(defaultContext);
    expect(values.has("coffeemarket.calculator.v2.KG.KGS")).toBe(true);
  });

  it("persists last context independently and validates it", () => {
    const adapter = store();
    expect(adapter.getLastContext()).toBeNull();
    adapter.saveLastContext({ market: "OTHER", currency: "JPY" });
    expect(adapter.getLastContext()).toEqual({
      market: "OTHER",
      currency: "JPY",
    });
    expect(adapter.load({ market: "OTHER", currency: "JPY" })).toBeNull();
  });

  it("rejects misfiled currency context and validates before writing", () => {
    const adapter = new BrowserScenarioStore({
      getItem: () =>
        JSON.stringify(
          createScenario(defaultInput, new Date(), {
            market: "KG",
            currency: "USD",
          }),
        ),
      setItem: () => {},
    });
    expect(() => adapter.load()).toThrow("другому рынку");
    const empty = store();
    expect(() => empty.save({ ...defaultInput, salePrice: -1 })).toThrow();
    expect(empty.load()).toBeNull();
  });

  it("propagates storage errors for the presentation layer to handle", () => {
    const adapter = new BrowserScenarioStore({
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceeded");
      },
    });
    expect(() => adapter.save(defaultInput)).toThrow("QuotaExceeded");
  });

  it("preserves catalog provenance, package size and zero stock", () => {
    const catalog = catalogRepository.getCatalog();
    expect(catalog.currency).toBe("KGS");
    expect(catalog.products).toHaveLength(6);
    expect(catalog.products.find((p) => p.id === 60)).toMatchObject({
      price: 1899,
      packageGrams: 1000,
      stock: 10,
    });
    expect(catalog.products.find((p) => p.id === 42)).toMatchObject({
      price: 849,
      packageGrams: 250,
      stock: 0,
    });
  });
});
