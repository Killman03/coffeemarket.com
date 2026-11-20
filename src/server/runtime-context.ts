import { AsyncLocalStorage } from "node:async_hooks";
import type { SettingsRepository } from "./settings-contracts";
import type { AnalyticsRepository } from "./analytics-contracts";
import type { DeliveryRepository } from "./contracts";

export type RuntimeEnvironment = {
  SITE_ORIGIN?: string;
  ADMIN_BOOTSTRAP_EMAIL?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_MANAGER_USER_ID?: string;
  TELEGRAM_BUSINESS_CONNECTION_ID?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  PNL_PUBLIC_ORIGIN?: string;
};

export type ApplicationRuntime = {
  platform: "sites" | "node" | "demo";
  environment: RuntimeEnvironment;
  settings: SettingsRepository | null;
  analytics: AnalyticsRepository | null;
  delivery: DeliveryRepository | null;
  ready(): Promise<boolean>;
  close(): Promise<void>;
};

const requests = new AsyncLocalStorage<ApplicationRuntime>();
// Next.js instrumentation and route bundles share the process-owned runtime.
// Only Node's composition root installs it; Sites bindings remain request-local.
const server = globalThis as typeof globalThis & {
  coffeeMarketNodeRuntime?: ApplicationRuntime;
};

/** Returns request-local Sites dependencies or the process-owned Node runtime. */
export function getApplicationRuntime(): ApplicationRuntime | undefined {
  return requests.getStore() ?? server.coffeeMarketNodeRuntime;
}

/** Isolates hosting bindings for a request without changing Node's singleton. */
export function runWithApplicationRuntime<T>(
  runtime: ApplicationRuntime,
  callback: () => T,
): T {
  return requests.run(runtime, callback);
}

/** Installs one Node composition root; callers must close it before replacement. */
export function installNodeRuntime(runtime: ApplicationRuntime): void {
  if (runtime.platform === "sites" || server.coffeeMarketNodeRuntime)
    throw new Error("Node runtime already configured or invalid");
  server.coffeeMarketNodeRuntime = runtime;
}

/** Releases the installed runtime after HTTP shutdown or an explicit test teardown. */
export async function closeNodeRuntime(): Promise<void> {
  const runtime = server.coffeeMarketNodeRuntime;
  delete server.coffeeMarketNodeRuntime;
  await runtime?.close();
}
