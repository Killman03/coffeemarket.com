import { D1AnalyticsRepository } from "./analytics-repository";
import { D1DeliveryRepository } from "./d1-repository";
import { D1SettingsRepository } from "./settings-repository";
import type { ApplicationRuntime, RuntimeEnvironment } from "./runtime-context";

export type SitesEnvironment = RuntimeEnvironment & { PNL_DB?: D1Database };

/** Adapts request-scoped Sites bindings to the shared application ports. */
export function createSitesRuntime(
  environment: SitesEnvironment,
): ApplicationRuntime {
  const db = environment.PNL_DB;
  return {
    platform: "sites",
    environment,
    settings: db ? new D1SettingsRepository(db) : null,
    analytics: db ? new D1AnalyticsRepository(db) : null,
    delivery: db ? new D1DeliveryRepository(db) : null,
    async ready() {
      return Boolean(db && (await db.prepare("SELECT 1 AS ready").first()));
    },
    async close() {
      /* Request-scoped hosting bindings are not owned here. */
    },
  };
}
