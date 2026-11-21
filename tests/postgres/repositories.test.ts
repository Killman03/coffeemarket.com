import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import * as schema from "../../db/postgres/schema";
import { createPostgresDatabase } from "../../src/server/postgres/database";
import { PostgresSettingsRepository } from "../../src/server/postgres/settings-repository";
import { PostgresAnalyticsRepository } from "../../src/server/postgres/analytics-repository";
import { PostgresDeliveryRepository } from "../../src/server/postgres/delivery-repository";
import { createNodeRuntime } from "../../src/server/node/bootstrap";
import { createNodeAuthentication } from "../../src/server/node/authentication";
import {
  createOwner,
  resetOwnerPassword,
  revokeOwnerSessions,
} from "../../src/server/node/owner-management";
import { hashPassword } from "better-auth/crypto";
import { getAdminAccess, handleAdminSettings } from "../../src/server/admin";
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
    sql`TRUNCATE TABLE analytics_sessions,analytics_events,pnl_requests,pnl_updates,site_owner,site_settings,site_settings_audit,auth_user,auth_session,auth_account,auth_verification,auth_rate_limit,auth_audit CASCADE`,
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
    const secret = randomBytes(48).toString("base64url");
    const credentials = {
      email: "owner@example.com",
      password: randomBytes(24).toString("base64url"),
      name: "Владелец",
    };
    await createOwner(primary.db, credentials);
    let cookie = "";
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
            BETTER_AUTH_SECRET: secret,
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
      expect(denied.status).toBe(401);
      expect(await (await fetch(`${origin}/admin`)).text()).toContain(
        "Email владельца",
      );
      const login = await fetch(`${origin}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({
          email: credentials.email,
          password: credentials.password,
        }),
      });
      expect(login.status).toBe(200);
      cookie = login.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");
      expect(cookie).toContain("coffee-market.session_token=");
      expect(
        (await fetch(`${origin}/api/admin/settings`, { headers: { cookie } }))
          .status,
      ).toBe(200);
      expect(
        await (await fetch(`${origin}/admin`, { headers: { cookie } })).text(),
      ).toContain("Сохранить изменения");
      const ownerEvent = await fetch(`${origin}/api/analytics/events`, {
        method: "POST",
        headers: {
          origin,
          cookie,
          "content-type": "application/json",
          "x-coffeemarket-analytics": "1",
        },
        body: JSON.stringify(event()),
      });
      expect(ownerEvent.status).toBe(204);
      expect(
        await primary.db.select().from(schema.analyticsEvents),
      ).toHaveLength(1);
    } finally {
      await stop();
    }
    const stopAgain = await start();
    try {
      expect(await (await fetch(origin)).text()).toContain("Сервер PostgreSQL");
      expect(
        (await fetch(`${origin}/api/admin/settings`, { headers: { cookie } }))
          .status,
      ).toBe(200);
      expect(
        (await fetch(`${origin}/api/admin/analytics`, { headers: { cookie } }))
          .status,
      ).toBe(400);
      const signOut = await fetch(`${origin}/api/auth/sign-out`, {
        method: "POST",
        headers: { origin, cookie, "content-type": "application/json" },
        body: "{}",
      });
      expect(signOut.status).toBe(200);
      expect(
        (await fetch(`${origin}/api/admin/settings`, { headers: { cookie } }))
          .status,
      ).toBe(401);
    } finally {
      await stopAgain();
    }
  });
  it("applies the real Drizzle migrations twice without replaying DDL", async () => {
    await migrate(primary.db, { migrationsFolder });
    const rows = await primary.db.execute(
      sql`SELECT count(*)::integer n FROM drizzle.__drizzle_migrations`,
    );
    expect(rows.rows[0].n).toBe(2);
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

describe("Node owner authentication on PostgreSQL", () => {
  const origin = "https://calculator.example.com";
  const secret = randomBytes(48).toString("base64url");
  const credentials = {
    email: "owner@example.com",
    password: randomBytes(24).toString("base64url"),
    name: "Owner",
  };
  const config = { origin, secret };
  const auth = () => createNodeAuthentication(primary.db, config);
  const post = (
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    new Request(`${origin}/api/auth/${path}`, {
      method: "POST",
      headers: { origin, "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  const cookieOf = (response: Response) =>
    response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
  const login = async () => {
    const response = await auth().handle(post("sign-in/email", credentials));
    expect(response.status).toBe(200);
    return new Headers({ cookie: cookieOf(response) });
  };
  const deps = async (headers: Headers) => ({
    repository: settings,
    user: await auth().getIdentity(headers),
    origin,
    bootstrapEmail: undefined,
    deliveryStatus: { deliveryReady: false, missing: [] },
  });

  it("creates exactly one owner under racing operator commands", async () => {
    const results = await Promise.allSettled([
      createOwner(primary.db, credentials),
      createOwner(peer.db, { ...credentials, email: "other@example.com" }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(await primary.db.select().from(schema.authUser)).toHaveLength(1);
    expect(await primary.db.select().from(schema.authAccount)).toHaveLength(1);
    expect(await primary.db.select().from(schema.siteOwner)).toHaveLength(1);
    expect(await primary.db.select().from(schema.authAudit)).toMatchObject([
      { action: "owner_created" },
    ]);
    const [account] = await primary.db.select().from(schema.authAccount);
    expect(account.password).not.toBe(credentials.password);
    expect(
      JSON.stringify(await primary.db.select().from(schema.authAudit)),
    ).not.toContain(credentials.password);
  });

  it("rolls back owner provisioning and its audit together", async () => {
    await primary.db.execute(
      sql`ALTER TABLE auth_audit ADD CONSTRAINT test_reject_auth_audit CHECK (action <> 'owner_created')`,
    );
    try {
      await expect(createOwner(primary.db, credentials)).rejects.toThrow();
      expect(await primary.db.select().from(schema.authUser)).toHaveLength(0);
      expect(await primary.db.select().from(schema.authAccount)).toHaveLength(
        0,
      );
      expect(await primary.db.select().from(schema.siteOwner)).toHaveLength(0);
    } finally {
      await primary.db.execute(
        sql`ALTER TABLE auth_audit DROP CONSTRAINT test_reject_auth_audit`,
      );
    }
  });

  it("issues secure cookies, validates stored sessions across instances and saves as the pinned owner", async () => {
    const id = await createOwner(primary.db, credentials);
    const response = await auth().handle(post("sign-in/email", credentials));
    expect(response.status).toBe(200);
    const setCookies = response.headers.getSetCookie().join(";");
    expect(setCookies).toContain("HttpOnly");
    expect(setCookies).toContain("Secure");
    expect(setCookies).toContain("SameSite=Lax");
    expect(response.headers.get("cache-control")).toContain("no-store");
    const headers = new Headers({ cookie: cookieOf(response) });
    expect(
      await createNodeAuthentication(peer.db, config).getIdentity(headers),
    ).toMatchObject({ userId: id, email: credentials.email });
    const ownerDeps = await deps(headers);
    expect(await getAdminAccess(ownerDeps)).toBe("authorized");
    const saved = await handleAdminSettings(
      new Request(`${origin}/api/admin/settings`, {
        method: "PUT",
        headers: {
          origin,
          "x-coffeemarket-admin": "1",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          revision: 0,
          settings: createDefaultSettings(),
        }),
      }),
      ownerDeps,
    );
    expect(saved.status).toBe(200);
    expect(
      await primary.db.select().from(schema.siteSettingsAudit),
    ).toMatchObject([{ actor: id }]);
  });

  it("rejects altered and expired cookies and ignores forged identity headers", async () => {
    await createOwner(primary.db, credentials);
    const headers = await login();
    const forged = new Headers({
      cookie: `${headers.get("cookie")}corrupted`,
      "oai-authenticated-user-id": (await settings.getOwner())!.subject,
    });
    expect(await auth().getIdentity(forged)).toBeNull();
    expect(
      await auth().getIdentity(
        new Headers({
          "oai-authenticated-user-id": (await settings.getOwner())!.subject,
          "oai-authenticated-user-email": credentials.email,
        }),
      ),
    ).toBeNull();
    await primary.db
      .update(schema.authSession)
      .set({ expiresAt: new Date(Date.now() - 1_000) });
    expect(await auth().getIdentity(headers)).toBeNull();
  });

  it("does not grant ownership to another valid session, even if its email is the bootstrap email", async () => {
    const owner = await createOwner(primary.db, credentials);
    const outsider = crypto.randomUUID();
    await primary.db
      .insert(schema.authUser)
      .values({ id: outsider, name: "Other", email: "other@example.com" });
    await primary.db
      .insert(schema.authAccount)
      .values({
        id: crypto.randomUUID(),
        userId: outsider,
        accountId: outsider,
        providerId: "credential",
        password: await hashPassword(credentials.password),
      });
    const response = await auth().handle(
      post("sign-in/email", { ...credentials, email: "other@example.com" }),
    );
    expect(response.status).toBe(200);
    const otherDeps = await deps(new Headers({ cookie: cookieOf(response) }));
    expect(otherDeps.user?.userId).toBe(outsider);
    expect(
      await getAdminAccess({
        ...otherDeps,
        bootstrapEmail: "other@example.com",
      }),
    ).toBe("forbidden");
    expect((await settings.getOwner())?.subject).toBe(owner);
  });

  it("revokes server sessions on logout and does not allow logout through GET or a foreign origin", async () => {
    await createOwner(primary.db, credentials);
    const headers = await login();
    const cookie = headers.get("cookie")!;
    expect(
      (
        await auth().handle(
          new Request(`${origin}/api/auth/sign-out`, { headers }),
        )
      ).status,
    ).toBe(405);
    expect(
      (
        await auth().handle(
          post("sign-out", {}, { cookie, origin: "https://evil.example" }),
        )
      ).status,
    ).toBe(403);
    expect(await auth().getIdentity(headers)).not.toBeNull();
    expect((await auth().handle(post("sign-out", {}, { cookie }))).status).toBe(
      200,
    );
    expect(await auth().getIdentity(headers)).toBeNull();
  });

  it("rejects public signup, self-service endpoints, cross-origin login and oversized bodies", async () => {
    await createOwner(primary.db, credentials);
    for (const path of [
      "sign-up/email",
      "change-email",
      "delete-user",
      "request-password-reset",
      "update-user",
      "change-password",
      "link-social",
    ]) {
      expect((await auth().handle(post(path, credentials))).status).toBe(404);
    }
    expect(
      (
        await auth().handle(
          post("sign-in/email", credentials, {
            origin: "https://evil.example",
          }),
        )
      ).status,
    ).toBe(403);
    const noOrigin = post("sign-in/email", credentials);
    noOrigin.headers.delete("origin");
    expect((await auth().handle(noOrigin)).status).toBe(403);
    expect(
      (
        await auth().handle(
          post("sign-in/email", {
            ...credentials,
            password: "a".repeat(9_000),
          }),
        )
      ).status,
    ).toBe(400);
    expect(await primary.db.select().from(schema.authSession)).toHaveLength(0);
    expect(await primary.db.select().from(schema.authUser)).toHaveLength(1);
  });

  it("atomically limits concurrent login attempts across pools despite spoofed IP headers", async () => {
    await createOwner(primary.db, credentials);
    const attempts = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        createNodeAuthentication(
          index % 2 ? primary.db : peer.db,
          config,
        ).handle(
          post(
            "sign-in/email",
            { ...credentials, password: "incorrect-password" },
            {
              "x-forwarded-for": `192.0.2.${index + 1}`,
              "cf-connecting-ip": `198.51.100.${index + 1}`,
            },
          ),
        ),
      ),
    );
    expect(attempts.filter((response) => response.status === 401)).toHaveLength(
      5,
    );
    expect(attempts.filter((response) => response.status === 429)).toHaveLength(
      3,
    );
    const throttled = attempts.find((response) => response.status === 429)!;
    expect(Number(throttled.headers.get("x-retry-after"))).toBeGreaterThan(0);
    expect(await primary.db.select().from(schema.authRateLimit)).toHaveLength(
      1,
    );
  });

  it("changes the password atomically, revokes sessions and refuses to reset another account", async () => {
    await createOwner(primary.db, credentials);
    const headers = await login();
    const replacement = randomBytes(24).toString("base64url");
    await expect(
      resetOwnerPassword(primary.db, "other@example.com", replacement),
    ).rejects.toThrow("не найден");
    expect(await auth().getIdentity(headers)).not.toBeNull();
    await resetOwnerPassword(peer.db, credentials.email, replacement);
    expect(await auth().getIdentity(headers)).toBeNull();
    expect(
      (await auth().handle(post("sign-in/email", credentials))).status,
    ).toBe(401);
    expect(
      (
        await auth().handle(
          post("sign-in/email", { ...credentials, password: replacement }),
        )
      ).status,
    ).toBe(200);
    expect(await primary.db.select().from(schema.authAudit)).toMatchObject([
      { action: "owner_created" },
      { action: "password_reset" },
    ]);
  });

  it("serializes password reset with in-flight login so old credentials cannot leave a session", async () => {
    await createOwner(primary.db, credentials);
    const replacement = randomBytes(24).toString("base64url");
    const [response] = await Promise.all([
      auth().handle(post("sign-in/email", credentials)),
      resetOwnerPassword(peer.db, credentials.email, replacement),
    ]);
    if (response.status === 200)
      expect(
        await auth().getIdentity(new Headers({ cookie: cookieOf(response) })),
      ).toBeNull();
    else expect(response.status).toBe(401);
    expect(await primary.db.select().from(schema.authSession)).toHaveLength(0);
  });

  it("rolls back password changes and session revocation if the audit write fails", async () => {
    await createOwner(primary.db, credentials);
    const headers = await login();
    const [before] = await primary.db.select().from(schema.authAccount);
    await primary.db.execute(
      sql`ALTER TABLE auth_audit ADD CONSTRAINT test_reject_password_audit CHECK (action <> 'password_reset')`,
    );
    try {
      await expect(
        resetOwnerPassword(
          primary.db,
          credentials.email,
          randomBytes(24).toString("base64url"),
        ),
      ).rejects.toThrow();
      const [after] = await primary.db.select().from(schema.authAccount);
      expect(after.password).toBe(before.password);
      expect(await auth().getIdentity(headers)).not.toBeNull();
    } finally {
      await primary.db.execute(
        sql`ALTER TABLE auth_audit DROP CONSTRAINT test_reject_password_audit`,
      );
    }
  });

  it("revokes every owner session from the operator command", async () => {
    await createOwner(primary.db, credentials);
    const first = await login(),
      second = await login();
    await revokeOwnerSessions(peer.db);
    expect(await auth().getIdentity(first)).toBeNull();
    expect(await auth().getIdentity(second)).toBeNull();
    expect(await primary.db.select().from(schema.authAudit)).toHaveLength(2);
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
