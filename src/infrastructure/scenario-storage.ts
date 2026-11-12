import {
  createScenario,
  scenarioSchema,
  type Scenario,
} from "../application/scenarios";
import type { CalculatorInput } from "../domain/calculator";
import {
  contextSchema,
  defaultContext,
  type MarketContext,
} from "../domain/markets";

export interface ScenarioStore {
  load(context?: MarketContext): Scenario | null;
  save(input: CalculatorInput, context?: MarketContext): void;
  getLastContext(): MarketContext | null;
  saveLastContext(context: MarketContext): void;
}

/** Browser persistence adapter; Storage is injected for deterministic tests. */
export class BrowserScenarioStore implements ScenarioStore {
  private readonly legacyKey = "coffeemarket.calculator.v1";
  private readonly activeKey = "coffeemarket.calculator.context.v1";

  constructor(private readonly storage: Pick<Storage, "getItem" | "setItem">) {}

  /** Loads and validates saved data. Corrupt or incompatible data throws. */
  load(context: MarketContext = defaultContext): Scenario | null {
    const validated = contextSchema.parse(context);
    const raw = this.storage.getItem(this.key(validated));
    if (raw !== null) {
      const scenario = scenarioSchema.parse(JSON.parse(raw));
      if (
        scenario.context.market !== validated.market ||
        scenario.context.currency !== validated.currency
      ) {
        throw new Error(
          "Сохранённый сценарий относится к другому рынку или валюте",
        );
      }
      return scenario;
    }
    if (validated.market !== "KG" || validated.currency !== "KGS") return null;
    const legacy = this.storage.getItem(this.legacyKey);
    if (legacy === null) return null;
    const migrated = scenarioSchema.parse(JSON.parse(legacy));
    if (
      migrated.context.market !== "KG" ||
      migrated.context.currency !== "KGS"
    ) {
      throw new Error("Неверная валюта старого сценария");
    }
    this.storage.setItem(this.key(validated), JSON.stringify(migrated));
    return migrated;
  }

  /** Saves only validated input. Storage errors are handled by the UI. */
  save(input: CalculatorInput, context: MarketContext = defaultContext): void {
    const scenario = createScenario(input, new Date(), context);
    this.storage.setItem(this.key(scenario.context), JSON.stringify(scenario));
  }

  /** Returns the explicitly selected context, validating persisted values. */
  getLastContext(): MarketContext | null {
    const raw = this.storage.getItem(this.activeKey);
    return raw === null ? null : contextSchema.parse(JSON.parse(raw));
  }

  /** Persists context independently of scenario validity or form edits. */
  saveLastContext(context: MarketContext): void {
    this.storage.setItem(
      this.activeKey,
      JSON.stringify(contextSchema.parse(context)),
    );
  }

  /** Builds a validated storage slot; each market/currency keeps its own data. */
  private key(context: MarketContext): string {
    const validated = contextSchema.parse(context);
    return `coffeemarket.calculator.v2.${validated.market}.${validated.currency}`;
  }
}
