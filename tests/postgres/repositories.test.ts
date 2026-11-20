import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import * as schema from "../../db/postgres/schema";
import { createPostgresDatabase } from "../../src/server/postgres/database";
import { PostgresSettingsRepository } from "../../src/server/postgres/settings-repository";
import { PostgresAnalyticsRepository } from "../../src/server/postgres/analytics-repository";
import { PostgresDeliveryRepository } from "../../src/server/postgres/delivery-repository";
import { createNodeRuntime } from "../../src/server/node/bootstrap";
import { runWithApplicationRuntime } from "../../src/server/runtime-context";
import { getSiteSettings } from "../../src/server/runtime";
import { getAnalyticsDependencies } from "../../app/analytics-dependencies";
import { createDefaultSettings } from "../../src/application/site-settings";
import { defaultInput } from "../../src/application/scenarios";
import {
  defaultAnalyticsFilter,
  type AnalyticsEvent,
} from "../../src/domain/analytics";
import type { DeliveryRecord } from "../../src/server/contracts";
import { D1AnalyticsRepository } from "../../src/server/analytics-repository";
import { createSQLiteD1 } from "../../src/test-support/d1";

// A separate, generated database is created and dropped. The supplied database
// is only used to establish the administrative connection; its data is untouched.
const baseUrl = z.url().parse(process.env.TEST_DATABASE_URL);
const databaseName = `cm_integration_${crypto.randomUUID().replaceAll("-", "")}`;
const testUrl = new URL(baseUrl);
testUrl.pathname = `/${databaseName}`;
const admin = createPostgresDatabase({ connectionString: baseUrl, max: 1 });
const primary = createPostgresDatabase({
  connectionString: testUrl.href,
  max: 12,
  options: "-c timezone=Asia/Bishkek",
});
const peer = createPostgresDatabase({
  connectionString: testUrl.href,
  max: 12,
});
const settings = new PostgresSettingsRepository(primary.db);
const analytics = new PostgresAnalyticsRepository(primary.db);
const delivery = new PostgresDeliveryRepository(primary.db);
const migrationsFolder = fileURLToPath(
  new URL("../../drizzle-postgres", import.meta.url),
);
const now = Date.parse("2026-11-20T12:00:00Z");
let created = false;

beforeAll(async () => {
  await admin.db.execute(sql`CREATE DATABASE ${sql.identifier(databaseName)}`);
  created = true;
  await migrate(primary.db, { migrationsFolder });
});
beforeEach(async () => {
  await primary.db.execute(
    sql`TRUNCATE TABLE analytics_sessions,analytics_events,pnl_requests,pnl_updates,site_owner,site_settings,site_settings_audit CASCADE`,
  );
});
afterAll(async () => {
  await primary.pool.end();
  await peer.pool.end();
  try {
    if (created)
      await admin.db.execute(
        sql`DROP DATABASE ${sql.identifier(databaseName)} WITH (FORCE)`,
      );
  } finally {
    await admin.pool.end();
  }
});

const event = (
  name: AnalyticsEvent["name"] = "page_view",
  sequence = 1,
  sessionId = crypto.randomUUID(),
): AnalyticsEvent => ({
  version: 1,
  eventId: crypto.randomUUID(),
  sessionId,
  name,
  sequence,
  context: { market: "KG", currency: "KGS" },
  attribution: {
    source: "instagram",
    medium: "paid",
    campaign: "coffee_launch",
  },
});
const ticket = (analyticsSessionId?: string): DeliveryRecord => ({
  id: crypto.randomUUID(),
  payload: { input: defaultInput, context: { market: "KG", currency: "KGS" } },
  expiresAt: now + 900_000,
  chatId: null,
  userId: null,
  state: "pending",
  phone: "+996555123456",
  ...(analyticsSessionId ? { analyticsSessionId } : {}),
});

describe("PostgreSQL migrations and lifecycle", () => {
  it("serves persisted settings, collects events and rejects forged owners after a real Node restart", async () => {
    const next = createDefaultSettings();
    next.content.calculatorTitle = "Сервер PostgreSQL";
    await settings.save(next, 0, "owner", now);
    const reserve = createServer();
    reserve.listen(0, "127.0.0.1");
    await once(reserve, "listening");
    const address = reserve.address();
    if (!address || typeof address === "string")
      throw new Error("No test TCP port");
    const port = address.port;
    await new Promise<void>((resolve) => reserve.close(() => resolve()));
    const origin = `http://127.0.0.1:${port}`;
    const start = async () => {
      const child = spawn(
        process.execPath,
        [
          fileURLToPath(
            new URL("../../.next-node/standalone/server.js", import.meta.url),
          ),
        ],
        {
          env: {
            ...process.env,
            NODE_ENV: "production",
            STORAGE_DRIVER: "postgres",
            DATABASE_URL: testUrl.href,
            SITE_ORIGIN: origin,
            HOSTNAME: "127.0.0.1",
            PORT: String(port),
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let output = "";
      child.stdout.on("data", (chunk) => {
        output = (output + chunk).slice(-8000);
      });
      child.stderr.on("data", (chunk) => {
        output = (output + chunk).slice(-8000);
      });
      const stop = async () => {
        if (child.exitCode === null) {
          const closed = once(child, "close");
          child.kill();
          await closed;
        }
      };
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          const result = await fetch(`${origin}/api/health/ready`, {
            signal: AbortSignal.timeout(500),
          });
          if (result.ok) return stop;
        } catch {
          /* Wait for supported Next.js startup. */
        }
        if (child.exitCode !== null) break;
        await delay(100);
      }
      await stop();
      throw new Error(`Standalone did not become ready: ${output}`);
    };
    const stop = await start();
    try {
      expect(await (await fetch(`${origin}/api/health/ready`)).json()).toEqual({
        ready: true,
        storage: "postgres",
      });
      expect(await (await fetch(origin)).text()).toContain("Сервер PostgreSQL");
      const response = await fetch(`${origin}/api/analytics/events`, {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/json",
          "x-coffeemarket-analytics": "1",
        },
        body: JSON.stringify(event()),
      });
      expect(response.status).toBe(202);
      expect(
        await primary.db.select().from(schema.analyticsEvents),
      ).toHaveLength(1);
      const denied = await fetch(`${origin}/api/admin/settings`, {
        headers: {
          "oai-authenticated-user-id": "owner",
          "oai-authenticated-user-email": "owner@example.com",
        },
      });
      expect(denied.status).toBe(503);
      expect(await primary.db.select().from(schema.siteOwner)).toHaveLength(0);
    } finally {
      await stop();
    }
    const stopAgain = await start();
    try {
      expect(await (await fetch(origin)).text()).toContain("Сервер PostgreSQL");
    } finally {
      await stopAgain();
    }
  });
  it("applies the real Drizzle migrations twice without replaying DDL", async () => {
    await migrate(primary.db, { migrationsFolder });
    const rows = await primary.db.execute(
      sql`SELECT count(*)::integer n FROM drizzle.__drizzle_migrations`,
    );
    expect(rows.rows[0].n).toBe(1);
  });
  it("starts the Node composition root and observes live settings and analytics", async () => {
    const runtime = await createNodeRuntime({
      STORAGE_DRIVER: "postgres",
      DATABASE_URL: testUrl.href,
      SITE_ORIGIN: "https://example.com",
    });
    try {
      expect(await runtime.ready()).toBe(true);
      await runWithApplicationRuntime(runtime, async () => {
        expect((await getSiteSettings()).content.calculatorTitle).toBe(
          createDefaultSettings().content.calculatorTitle,
        );
        const next = createDefaultSettings();
        next.content.calculatorTitle = "Проверка PostgreSQL";
        await settings.save(next, 0, "owner", now);
        expect((await getSiteSettings()).content.calculatorTitle).toBe(
          "Проверка PostgreSQL",
        );
        const deps = await getAnalyticsDependencies();
        expect(deps?.excluded).toBe(false);
        expect(deps?.repository).toBe(runtime.analytics);
      });
    } finally {
      await runtime.close();
    }
  });
  it("fails startup on missing tables instead of falling back or applying DDL", async () => {
    const emptyName = `cm_empty_${crypto.randomUUID().replaceAll("-", "")}`;
    await admin.db.execute(sql`CREATE DATABASE ${sql.identifier(emptyName)}`);
    const empty = new URL(baseUrl);
    empty.pathname = `/${emptyName}`;
    try {
      await expect(
        createNodeRuntime({
          STORAGE_DRIVER: "postgres",
          DATABASE_URL: empty.href,
          SITE_ORIGIN: "https://example.com",
        }),
      ).rejects.toThrow("schema not migrated");
    } finally {
      await admin.db.execute(
        sql`DROP DATABASE ${sql.identifier(emptyName)} WITH (FORCE)`,
      );
    }
  });
});

describe("PostgreSQL settings and owner races", () => {
  it("does not write default settings just because a visitor opens a page", async () => {
    expect((await settings.get()).revision).toBe(0);
    expect(await primary.db.select().from(schema.siteSettings)).toEqual([]);
  });
  it("pins one owner across competing connections and accepts its retry", async () => {
    const other = new PostgresSettingsRepository(peer.db);
    const results = await Promise.all([
      settings.claimOwner("first", now),
      other.claimOwner("second", now),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const owner = (await settings.getOwner())!;
    expect(await other.claimOwner(owner.subject, now + 1)).toBe(true);
    expect(await primary.db.select().from(schema.siteOwner)).toHaveLength(1);
  });
  it("permits one racing first save and audits only the winner", async () => {
    const other = new PostgresSettingsRepository(peer.db);
    const writes = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        (index % 2 ? other : settings).save(
          createDefaultSettings(),
          0,
          `owner-${index}`,
          now,
        ),
      ),
    );
    expect(writes.filter(Boolean)).toHaveLength(1);
    expect((await settings.get()).revision).toBe(1);
    expect(
      await primary.db.select().from(schema.siteSettingsAudit),
    ).toHaveLength(1);
  });
  it("rejects stale revisions across connections and audits the exact changed section", async () => {
    await settings.save(createDefaultSettings(), 0, "owner", now);
    const next = createDefaultSettings();
    next.content.pnlTitle = "Изменённый заголовок";
    const other = new PostgresSettingsRepository(peer.db);
    const writes = await Promise.all([
      settings.save(next, 1, "first", now + 1),
      other.save(next, 1, "second", now + 2),
    ]);
    expect(writes.filter(Boolean)).toHaveLength(1);
    const audits = await primary.db
      .select()
      .from(schema.siteSettingsAudit)
      .orderBy(schema.siteSettingsAudit.revision);
    expect(audits).toHaveLength(2);
    expect(audits[1].changedSections).toEqual(["content"]);
  });
  it("rolls back settings when the audit write fails", async () => {
    await primary.db.execute(
      sql`ALTER TABLE site_settings_audit ADD CONSTRAINT test_reject_audit CHECK (false) NOT VALID`,
    );
    try {
      await expect(
        settings.save(createDefaultSettings(), 0, "owner", now),
      ).rejects.toThrow();
    } finally {
      await primary.db.execute(
        sql`ALTER TABLE site_settings_audit DROP CONSTRAINT test_reject_audit`,
      );
    }
    expect((await settings.get()).revision).toBe(0);
  });
  it("rejects corrupted stored settings rather than replacing them with defaults", async () => {
    await settings.save(createDefaultSettings(), 0, "owner", now);
    await primary.db.execute(sql`UPDATE site_settings SET payload='{}'::jsonb`);
    await expect(settings.get()).rejects.toThrow();
  });
});

describe("PostgreSQL analytics transactions and parity", () => {
  it("deduplicates concurrent requests from separate pools without extending activity", async () => {
    const observation = event(),
      other = new PostgresAnalyticsRepository(peer.db);
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        (index % 2 ? other : analytics).ingest(observation, now),
      ),
    );
    expect(results.filter((value) => value === "accepted")).toHaveLength(1);
    expect(results.filter((value) => value === "duplicate")).toHaveLength(11);
    expect(
      await analytics.ingest(
        { ...observation, sessionId: crypto.randomUUID() },
        now + 100,
      ),
    ).toBe("duplicate");
    const sessions = await primary.db.select().from(schema.analyticsSessions);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].lastSeenAt).toBe(now);
  });
  it("requires page_view and rolls back orphan sessions if event storage fails", async () => {
    expect(await analytics.ingest(event("calculation_started"), now)).toBe(
      "limited",
    );
    await primary.db.execute(
      sql`ALTER TABLE analytics_events ADD CONSTRAINT test_reject_view CHECK (name<>'page_view') NOT VALID`,
    );
    try {
      await expect(analytics.ingest(event(), now)).rejects.toThrow();
    } finally {
      await primary.db.execute(
        sql`ALTER TABLE analytics_events DROP CONSTRAINT test_reject_view`,
      );
    }
    expect(await primary.db.select().from(schema.analyticsSessions)).toEqual(
      [],
    );
  });
  it("enforces the new-session quota under parallel writes", async () => {
    for (let index = 0; index < 99; index++)
      await analytics.ingest(event(), now);
    const other = new PostgresAnalyticsRepository(peer.db);
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        (index % 2 ? other : analytics).ingest(event(), now),
      ),
    );
    expect(results.filter((value) => value === "accepted")).toHaveLength(1);
    expect(
      await primary.db.select().from(schema.analyticsSessions),
    ).toHaveLength(100);
  });
  it("enforces event and per-session quotas while accepting duplicate retries", async () => {
    const views: AnalyticsEvent[] = [];
    for (let group = 0; group < 5; group++) {
      const view = event();
      views.push(view);
      await analytics.ingest(view, now);
      for (let index = 2; index <= (group === 4 ? 119 : 120); index++)
        await analytics.ingest(
          event("sample_clicked", index, view.sessionId),
          now,
        );
    }
    const other = new PostgresAnalyticsRepository(peer.db);
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        (index % 2 ? other : analytics).ingest(
          event("sample_clicked", 120, views[4].sessionId),
          now,
        ),
      ),
    );
    expect(results.filter((value) => value === "accepted")).toHaveLength(1);
    expect(await analytics.ingest(views[0], now)).toBe("duplicate");
    expect(
      await analytics.ingest(
        event("sample_clicked", 121, views[0].sessionId),
        now + 60_001,
      ),
    ).toBe("limited");
    expect(await analytics.ingest(event(), now)).toBe("limited");
  });
  it("returns identical reports to D1 with UTC boundaries and initial attribution", async () => {
    const sqlite = createSQLiteD1();
    try {
      const legacy = new D1AnalyticsRepository(sqlite.db),
        view = event();
      const observations = [
        { value: view, time: Date.parse("2026-11-19T23:59:59Z") },
        { value: event("calculation_started", 2, view.sessionId), time: now },
        {
          value: event("calculation_completed", 3, view.sessionId),
          time: now + 1,
        },
        {
          value: {
            ...event("sample_clicked", 4, view.sessionId),
            context: { market: "KZ" as const, currency: "USD" as const },
          },
          time: now + 2,
        },
        { value: event(), time: now },
      ];
      for (const item of observations) {
        await analytics.ingest(item.value, item.time);
        await legacy.ingest(item.value, item.time);
      }
      for (const filter of [
        defaultAnalyticsFilter(now),
        { from: "2026-11-19", to: "2026-11-19" },
        { ...defaultAnalyticsFilter(now), market: "KZ" as const },
        { ...defaultAnalyticsFilter(now), source: "instagram" },
      ]) {
        expect(await analytics.report(filter, now)).toEqual(
          await legacy.report(filter, now),
        );
      }
    } finally {
      sqlite.sql.close();
    }
  });
  it("counts confirmed deliveries, ignores spoofed session links, and nulls deleted attribution", async () => {
    const view = event();
    await analytics.ingest(view, now);
    const linked = ticket(view.sessionId),
      unlinked = ticket(crypto.randomUUID());
    await delivery.create(linked, "linked", now);
    await delivery.create(unlinked, "unlinked", now);
    await delivery.bind(linked.id, 42, 43, now);
    await delivery.setState(linked.id, "delivered");
    expect(
      (await analytics.report(defaultAnalyticsFilter(now), now)).requests,
    ).toEqual({ accepted: 2, chatReceived: 1, delivered: 1, unattributed: 1 });
    await primary.db
      .delete(schema.analyticsSessions)
      .where(eq(schema.analyticsSessions.id, view.sessionId));
    expect(
      (await analytics.report(defaultAnalyticsFilter(now), now)).requests
        .unattributed,
    ).toBe(2);
    expect(await primary.db.select().from(schema.analyticsEvents)).toEqual([]);
  });
  it("bounds retention batches and keeps the current UTC window", async () => {
    for (let index = 0; index < 30; index++)
      await analytics.ingest(event(), now - 100 * 86_400_000);
    await analytics.ingest(event(), now);
    await analytics.cleanup(now);
    expect(
      await primary.db.select().from(schema.analyticsSessions),
    ).toHaveLength(6);
    await analytics.cleanup(now);
    expect(
      await primary.db.select().from(schema.analyticsSessions),
    ).toHaveLength(1);
  });
});

describe("PostgreSQL delivery concurrency and retention", () => {
  it("enforces one per-key quota across simultaneous connections", async () => {
    const other = new PostgresDeliveryRepository(peer.db);
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        (index % 2 ? other : delivery).create(ticket(), "one-key", now),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(5);
    expect(await primary.db.select().from(schema.pnlRequests)).toHaveLength(5);
  });
  it("enforces the aggregate quota under concurrent requests with distinct keys", async () => {
    const other = new PostgresDeliveryRepository(peer.db);
    const results = await Promise.all(
      Array.from({ length: 105 }, (_, index) =>
        (index % 2 ? other : delivery).create(ticket(), `key-${index}`, now),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(100);
  });
  it("binds one sender and claims one delivery, preserving bigint Telegram IDs", async () => {
    const record = ticket();
    await delivery.create(record, "key", now);
    const other = new PostgresDeliveryRepository(peer.db);
    const bound = await Promise.all([
      delivery.bind(record.id, 1_000_000_000_001, 1_000_000_000_002, now),
      other.bind(record.id, 3, 4, now),
    ]);
    expect(bound.filter(Boolean)).toHaveLength(1);
    const winner = bound.find(Boolean)!;
    expect(
      (await delivery.pending(winner.chatId!, winner.userId!, now))?.id,
    ).toBe(record.id);
    expect(
      (
        await Promise.all([
          delivery.claimDelivery(record.id, now),
          other.claimDelivery(record.id, now),
        ])
      ).filter(Boolean),
    ).toHaveLength(1);
    expect(await delivery.bind(record.id, 7, 8, now)).toBeNull();
  });
  it("does not bind or claim expired tickets", async () => {
    const record = { ...ticket(), expiresAt: now };
    await delivery.create(record, "key", now);
    expect(await delivery.bind(record.id, 42, 43, now)).toBeNull();
    expect(await delivery.claimDelivery(record.id, now)).toBe(false);
  });
  it("deduplicates Telegram updates and only reopens explicit failures", async () => {
    const other = new PostgresDeliveryRepository(peer.db);
    const results = await Promise.all([
      delivery.claimUpdate(123, now),
      other.claimUpdate(123, now),
    ]);
    expect(results.sort()).toEqual(["busy", "claimed"]);
    await delivery.finishUpdate(123, false);
    expect(await other.claimUpdate(123, now + 1)).toBe("claimed");
    await other.finishUpdate(123, true);
    await delivery.finishUpdate(123, false);
    expect(await delivery.claimUpdate(123, now + 2)).toBe("done");
  });
  it("persists consent and independently removes old contacts and update IDs", async () => {
    await delivery.create(ticket(), "old", now - 31 * 86_400_000);
    await delivery.create(ticket(), "current", now);
    await delivery.claimUpdate(123, now - 8 * 86_400_000);
    await delivery.claimUpdate(124, now);
    await delivery.cleanup(now);
    const rows = await primary.db.select().from(schema.pnlRequests);
    expect(rows).toHaveLength(1);
    expect(rows[0].consentedAt).toBe(now);
    expect(rows[0].consentVersion).toBeTruthy();
    expect(
      (await primary.db.select().from(schema.pnlUpdates)).map((row) => row.id),
    ).toEqual([124]);
  });
});
