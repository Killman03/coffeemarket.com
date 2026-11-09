import { describe, expect, it } from "vitest";
import { BrowserScenarioStore } from "./scenario-storage";
import { defaultInput, scenarioSchema } from "../application/scenarios";
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
    expect(adapter.load()?.version).toBe(1);
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
        version: 2,
        savedAt: new Date().toISOString(),
        input: defaultInput,
      }).success,
    ).toBe(false);
    expect(scenarioSchema.safeParse({ version: 1, input: {} }).success).toBe(
      false,
    );
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
