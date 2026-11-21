import { sql } from "drizzle-orm";
import * as schema from "../../../db/postgres/schema";
import { createPostgresDatabase } from "../postgres/database";
import { PostgresSettingsRepository } from "../postgres/settings-repository";
import { PostgresAnalyticsRepository } from "../postgres/analytics-repository";
import { PostgresDeliveryRepository } from "../postgres/delivery-repository";
import {
  getApplicationRuntime,
  installNodeRuntime,
  type ApplicationRuntime,
  type RuntimeEnvironment,
} from "../runtime-context";
import { readNodeConfiguration } from "./config";
import { createNodeAuthentication } from "./authentication";

/** Creates server-owned adapters, failing startup for an unreachable/unmigrated DB.
 *
 * Args:
 *   environment: Node process environment, never passed to browser components.
 *
 * Returns:
 *   Runtime with one pool and explicit lifecycle methods; no schema is mutated.
 */
export async function createNodeRuntime(
  environment: Readonly<Record<string, string | undefined>>,
): Promise<ApplicationRuntime> {
  const config = readNodeConfiguration(environment);
  const values: RuntimeEnvironment = {
    SITE_ORIGIN: config.SITE_ORIGIN,
    TELEGRAM_BOT_TOKEN: environment.TELEGRAM_BOT_TOKEN,
    TELEGRAM_MANAGER_USER_ID: environment.TELEGRAM_MANAGER_USER_ID,
    TELEGRAM_BUSINESS_CONNECTION_ID:
      environment.TELEGRAM_BUSINESS_CONNECTION_ID,
    TELEGRAM_WEBHOOK_SECRET: environment.TELEGRAM_WEBHOOK_SECRET,
    PNL_PUBLIC_ORIGIN: environment.PNL_PUBLIC_ORIGIN ?? config.SITE_ORIGIN,
  };
  if (config.STORAGE_DRIVER === "demo")
    return {
      platform: "demo",
      environment: values,
      settings: null,
      analytics: null,
      delivery: null,
      async ready() {
        return true;
      },
      async close() {},
    };
  const { db, pool } = createPostgresDatabase({
    connectionString: config.DATABASE_URL,
    max: config.PG_POOL_MAX,
  });
  try {
    // Reading every column verifies required migrations, without running DDL on
    // application startup or creating data from a public page request.
    await db.select().from(schema.siteOwner).limit(0);
    await db.select().from(schema.siteSettings).limit(0);
    await db.select().from(schema.siteSettingsAudit).limit(0);
    await db.select().from(schema.analyticsSessions).limit(0);
    await db.select().from(schema.analyticsEvents).limit(0);
    await db.select().from(schema.pnlRequests).limit(0);
    await db.select().from(schema.pnlUpdates).limit(0);
    if (config.BETTER_AUTH_SECRET) {
      await db.select().from(schema.authUser).limit(0);
      await db.select().from(schema.authAccount).limit(0);
      await db.select().from(schema.authSession).limit(0);
      await db.select().from(schema.authRateLimit).limit(0);
      await db.select().from(schema.authVerification).limit(0);
    }
  } catch {
    await pool.end();
    throw new Error(
      "PostgreSQL unavailable or schema not migrated; run db:postgres:migrate before startup",
    );
  }
  return {
    platform: "node",
    environment: values,
    settings: new PostgresSettingsRepository(db),
    analytics: new PostgresAnalyticsRepository(db),
    delivery: new PostgresDeliveryRepository(db),
    ...(config.BETTER_AUTH_SECRET
      ? {
          authentication: createNodeAuthentication(db, {
            origin: config.SITE_ORIGIN,
            secret: config.BETTER_AUTH_SECRET,
          }),
        }
      : {}),
    async ready() {
      await db.execute(sql`select 1`);
      return true;
    },
    async close() {
      await pool.end();
    },
  };
}

/** Registers dependencies once per Next.js server instance before HTTP traffic. */
export async function initializeNodeRuntime(): Promise<void> {
  if (getApplicationRuntime()) return;
  installNodeRuntime(await createNodeRuntime(process.env));
  // Next.js owns SIGTERM/SIGINT and drains HTTP requests before process exit.
  // Closing the pool from a competing signal listener would reject subsequent
  // database operations inside requests that are still being drained.
}
