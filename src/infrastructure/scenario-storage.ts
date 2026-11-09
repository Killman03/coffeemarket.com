import {
  createScenario,
  scenarioSchema,
  type Scenario,
} from "../application/scenarios";
import type { CalculatorInput } from "../domain/calculator";

export interface ScenarioStore {
  load(): Scenario | null;
  save(input: CalculatorInput): void;
}

/** Browser persistence adapter; Storage is injected for deterministic tests. */
export class BrowserScenarioStore implements ScenarioStore {
  private readonly key = "coffeemarket.calculator.v1";

  constructor(private readonly storage: Pick<Storage, "getItem" | "setItem">) {}

  /** Loads and validates saved data. Corrupt or incompatible data throws. */
  load(): Scenario | null {
    const raw = this.storage.getItem(this.key);
    return raw === null ? null : scenarioSchema.parse(JSON.parse(raw));
  }

  /** Saves only validated input. Storage errors are handled by the UI. */
  save(input: CalculatorInput): void {
    this.storage.setItem(this.key, JSON.stringify(createScenario(input)));
  }
}
