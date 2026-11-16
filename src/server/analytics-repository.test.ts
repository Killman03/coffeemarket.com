// @vitest-environment node
import { afterEach, describe, it, expect } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createSQLiteD1 } from "../test-support/d1";
import { D1AnalyticsRepository } from "./analytics-repository";
import { D1DeliveryRepository } from "./d1-repository";
import { defaultInput } from "../application/scenarios";
import {
  defaultAnalyticsFilter,
  type AnalyticsEvent,
} from "../domain/analytics";
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
const now = Date.parse("2026-11-16T10:00:00Z");
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
function setup() {
  const { db, sql } = createSQLiteD1();
  databases.push(sql);
  return {
    repository: new D1AnalyticsRepository(db),
    delivery: new D1DeliveryRepository(db),
    sql,
  };
}

describe("durable first-party analytics", () => {
  it("limits new sessions globally without creating orphan rows for replayed event IDs", async () => {
    const { repository, sql } = setup(),
      view = event();
    await repository.ingest(view, now);
    expect(
      await repository.ingest({ ...view, sessionId: crypto.randomUUID() }, now),
    ).toBe("duplicate");
    expect(
      sql.prepare("SELECT COUNT(*) n FROM analytics_sessions").get()!.n,
    ).toBe(1);
    for (let index = 1; index < 100; index++)
      await repository.ingest(event(), now);
    expect(await repository.ingest(event(), now)).toBe("limited");
    expect(
      sql.prepare("SELECT COUNT(*) n FROM analytics_sessions").get()!.n,
    ).toBe(100);
  });
  it("enforces the aggregate event quota before creating another session", async () => {
    const { repository, sql } = setup();
    for (let index = 0; index < 6; index++) {
      const view = event();
      await repository.ingest(view, now);
      for (let sequence = 2; sequence <= 100; sequence++)
        await repository.ingest(
          event("sample_clicked", sequence, view.sessionId),
          now,
        );
    }
    expect(await repository.ingest(event(), now)).toBe("limited");
    expect(
      sql.prepare("SELECT COUNT(*) n FROM analytics_events").get()!.n,
    ).toBe(600);
    expect(
      sql.prepare("SELECT COUNT(*) n FROM analytics_sessions").get()!.n,
    ).toBe(6);
  });
  it("deduplicates retries atomically and does not extend activity", async () => {
    const { repository, sql } = setup(),
      view = event();
    expect(
      await Promise.all([
        repository.ingest(view, now),
        repository.ingest(view, now + 100),
      ]),
    ).toEqual(["accepted", "duplicate"]);
    expect(
      sql.prepare("SELECT COUNT(*) n FROM analytics_events").get()!.n,
    ).toBe(1);
    expect(
      sql.prepare("SELECT last_seen_at FROM analytics_sessions").get()!
        .last_seen_at,
    ).toBe(now);
    expect(
      (await repository.report(defaultAnalyticsFilter(now), now)).metrics,
    ).toMatchObject({ sessions: 1, views: 1, engaged: 0, completed: 0 });
  });
  it("requires a page observation before accepting other session events", async () => {
    const { repository } = setup();
    expect(await repository.ingest(event("calculation_started"), now)).toBe(
      "limited",
    );
    expect(
      (await repository.report(defaultAnalyticsFilter(now), now)).metrics
        .sessions,
    ).toBe(0);
  });
  it("counts chronological session milestones and independent Excel actions", async () => {
    const { repository } = setup(),
      view = event();
    await repository.ingest(view, now);
    for (const [name, sequence] of [
      ["calculation_started", 2],
      ["calculation_completed", 3],
      ["sample_clicked", 4],
      ["sample_clicked", 5],
    ] as const)
      await repository.ingest(
        event(name, sequence, view.sessionId),
        now + sequence,
      );
    const result = await repository.report(defaultAnalyticsFilter(now), now);
    expect(result.metrics).toMatchObject({
      sessions: 1,
      engaged: 1,
      completed: 1,
      sampleClicks: 1,
    });
    expect(result.daily).toHaveLength(7);
    expect(result.daily.at(-1)).toMatchObject({
      date: "2026-11-16",
      sessions: 1,
      completed: 1,
    });
  });
  it("does not count a completion received before the start sequence", async () => {
    const { repository } = setup(),
      view = event();
    await repository.ingest(view, now);
    await repository.ingest(
      event("calculation_completed", 2, view.sessionId),
      now + 1,
    );
    await repository.ingest(
      event("calculation_started", 3, view.sessionId),
      now + 2,
    );
    expect(
      (await repository.report(defaultAnalyticsFilter(now), now)).metrics,
    ).toMatchObject({ engaged: 1, completed: 0 });
  });
  it("preserves acquisition and initial context across later market changes", async () => {
    const { repository } = setup(),
      view = event();
    await repository.ingest(view, now);
    await repository.ingest(
      {
        ...event("market_changed", 2, view.sessionId),
        context: { market: "KZ", currency: "KZT" },
        attribution: { source: "other", medium: "", campaign: "" },
      },
      now + 1,
    );
    const filter = defaultAnalyticsFilter(now);
    expect(
      (
        await repository.report(
          { ...filter, source: "instagram", market: "KG" },
          now,
        )
      ).metrics.sessions,
    ).toBe(1);
    expect(
      (await repository.report({ ...filter, market: "KZ" }, now)).metrics
        .sessions,
    ).toBe(0);
    expect(
      (await repository.report({ ...filter, campaign: "missing" }, now)).metrics
        .sessions,
    ).toBe(0);
  });
  it("bounds writes per session without blocking duplicate acknowledgments", async () => {
    const { repository, sql } = setup(),
      view = event();
    await repository.ingest(view, now);
    for (let index = 2; index <= 120; index++)
      await repository.ingest(
        event("sample_clicked", index, view.sessionId),
        now + index,
      );
    expect(
      await repository.ingest(
        event("sample_clicked", 121, view.sessionId),
        now + 200,
      ),
    ).toBe("limited");
    expect(await repository.ingest(view, now + 300)).toBe("duplicate");
    expect(
      sql.prepare("SELECT COUNT(*) n FROM analytics_events").get()!.n,
    ).toBe(120);
  });
  it("rolls back session creation when event storage fails", async () => {
    const { repository, sql } = setup();
    sql.exec(
      "CREATE TRIGGER fail_event BEFORE INSERT ON analytics_events BEGIN SELECT RAISE(ABORT,'unavailable'); END;",
    );
    await expect(repository.ingest(event(), now)).rejects.toThrow();
    expect(
      sql.prepare("SELECT COUNT(*) n FROM analytics_sessions").get()!.n,
    ).toBe(0);
  });
  it("uses inclusive UTC dates and excludes events after the report end", async () => {
    const { repository } = setup(),
      view = event();
    const beforeMidnight = Date.parse("2026-11-15T23:59:59Z");
    await repository.ingest(view, beforeMidnight);
    await repository.ingest(
      event("calculation_started", 2, view.sessionId),
      Date.parse("2026-11-16T00:00:00Z"),
    );
    const result = await repository.report(
      { from: "2026-11-15", to: "2026-11-15" },
      now,
    );
    expect(result.metrics).toMatchObject({ sessions: 1, engaged: 0 });
    expect(
      (await repository.report({ from: "2026-11-16", to: "2026-11-16" }, now))
        .metrics.sessions,
    ).toBe(0);
  });
  it("prunes expired sessions and cascading events independently of Telegram", async () => {
    const { repository, sql } = setup();
    await repository.ingest(event(), now - 100 * 86_400_000);
    await repository.ingest(event(), now);
    await repository.cleanup(now);
    expect(
      sql.prepare("SELECT COUNT(*) n FROM analytics_sessions").get()!.n,
    ).toBe(1);
    expect(
      sql.prepare("SELECT COUNT(*) n FROM analytics_events").get()!.n,
    ).toBe(1);
  });
  it("derives confirmed counters from durable requests, never from browser assertions", async () => {
    const { repository, delivery } = setup(),
      view = event();
    await repository.ingest(view, now);
    const base = {
      payload: {
        input: defaultInput,
        context: { market: "KG", currency: "KGS" } as const,
      },
      phone: "+12025550123",
      expiresAt: now + 900_000,
      chatId: null,
      userId: null,
      state: "pending" as const,
    };
    await delivery.create(
      { ...base, id: "linked", analyticsSessionId: view.sessionId },
      "one",
      now,
    );
    await delivery.create(
      { ...base, id: "unlinked", analyticsSessionId: crypto.randomUUID() },
      "two",
      now,
    );
    await delivery.bind("linked", 42, 42, now + 1);
    await delivery.setState("linked", "delivered");
    expect(
      (await repository.report(defaultAnalyticsFilter(now), now)).requests,
    ).toEqual({ accepted: 2, chatReceived: 1, delivered: 1, unattributed: 1 });
    expect(
      (
        await repository.report(
          { ...defaultAnalyticsFilter(now), source: "instagram" },
          now,
        )
      ).requests,
    ).toEqual({ accepted: 1, chatReceived: 1, delivered: 1, unattributed: 0 });
  });
});
