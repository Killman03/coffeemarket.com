// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { collectAnalytics, readAnalyticsReport } from "./analytics";
import {
  analyticsEventSchema,
  analyticsFilterSchema,
  analyticsInterval,
  defaultAnalyticsFilter,
} from "../domain/analytics";
import { createDefaultSettings } from "../application/site-settings";
import type { AdminDependencies } from "./admin";
const now = Date.parse("2026-11-16T12:00:00Z");
const event = {
  version: 1,
  eventId: crypto.randomUUID(),
  sessionId: crypto.randomUUID(),
  name: "page_view",
  sequence: 1,
  context: { market: "KG", currency: "KGS" },
  attribution: { source: "instagram", medium: "paid", campaign: "launch" },
};
function setup() {
  const repository = {
    ingest: vi.fn().mockResolvedValue("accepted"),
    report: vi.fn().mockResolvedValue({ ok: true }),
    cleanup: vi.fn().mockResolvedValue(undefined),
  };
  const admin: AdminDependencies = {
    repository: {
      get: vi
        .fn()
        .mockResolvedValue({
          revision: 0,
          updatedAt: null,
          settings: createDefaultSettings(),
        }),
      getOwner: vi.fn().mockResolvedValue({ subject: "owner" }),
      claimOwner: vi.fn(),
      save: vi.fn(),
    },
    user: { userId: "owner", email: "owner@example.com", displayName: "Owner" },
    bootstrapEmail: undefined,
    origin: "https://example.com",
    deliveryStatus: { deliveryReady: false, missing: [] },
  };
  return {
    repository,
    admin,
    deps: {
      repository,
      origin: "https://example.com",
      excluded: false,
      now: () => now,
    },
  };
}
const request = (body: unknown = event, headers: Record<string, string> = {}) =>
  new Request("https://example.com/api/analytics/events", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      "X-CoffeeMarket-Analytics": "1",
      ...headers,
    },
    body: JSON.stringify(body),
  });

describe("analytics boundaries", () => {
  it("rejects sensitive, unknown and server-only event fields", () => {
    for (const body of [
      { ...event, phone: "secret" },
      { ...event, input: { salePrice: 100 } },
      { ...event, name: "pnl_delivered" },
      { ...event, context: { ...event.context, profit: 999 } },
      { ...event, attribution: { ...event.attribution, fbclid: "secret" } },
    ])
      expect(analyticsEventSchema.safeParse(body).success).toBe(false);
  });
  it("requires exact origin, custom header and bounded JSON before writing", async () => {
    const { deps, repository } = setup();
    expect(
      (
        await collectAnalytics(
          request(event, { origin: "https://other.example" }),
          deps,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await collectAnalytics(
          request(event, { "X-CoffeeMarket-Analytics": "" }),
          deps,
        )
      ).status,
    ).toBe(403);
    expect(
      (await collectAnalytics(request({ padding: "x".repeat(5000) }), deps))
        .status,
    ).toBe(400);
    expect(
      (
        await collectAnalytics(
          request(event, { "content-type": "text/plain" }),
          deps,
        )
      ).status,
    ).toBe(400);
    expect(repository.ingest).not.toHaveBeenCalled();
  });
  it("ignores verified owners and browser privacy signals without recording", async () => {
    const { deps, repository } = setup();
    expect(
      (await collectAnalytics(request(), { ...deps, excluded: true })).status,
    ).toBe(204);
    expect(
      (await collectAnalytics(request(event, { dnt: "1" }), deps)).status,
    ).toBe(204);
    expect(
      (await collectAnalytics(request(event, { "sec-gpc": "1" }), deps)).status,
    ).toBe(204);
    expect(repository.ingest).not.toHaveBeenCalled();
    expect(repository.cleanup).not.toHaveBeenCalled();
  });
  it("acknowledges durable events, duplicates and quotas without leaking errors", async () => {
    const { deps, repository } = setup();
    expect((await collectAnalytics(request(), deps)).status).toBe(202);
    repository.ingest.mockResolvedValueOnce("duplicate");
    expect((await collectAnalytics(request(), deps)).status).toBe(200);
    repository.ingest.mockResolvedValueOnce("limited");
    expect((await collectAnalytics(request(), deps)).status).toBe(429);
    repository.ingest.mockRejectedValueOnce(
      new Error("private database details"),
    );
    const response = await collectAnalytics(request(), deps);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private");
  });
  it("protects reports from anonymous and other signed-in users", async () => {
    const { repository, admin } = setup(),
      req = new Request(
        "https://example.com/api/admin/analytics?from=2026-11-10&to=2026-11-16",
      );
    expect(
      (
        await readAnalyticsReport(
          req,
          { ...admin, user: null },
          repository,
          now,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await readAnalyticsReport(
          req,
          { ...admin, user: { ...admin.user!, userId: "other" } },
          repository,
          now,
        )
      ).status,
    ).toBe(403);
    expect(repository.report).not.toHaveBeenCalled();
  });
  it("bounds periods and validates filters before executing report queries", async () => {
    const { repository, admin } = setup();
    for (const params of [
      "from=2026-01-01&to=2026-11-16",
      "from=2026-11-17&to=2026-11-18",
      "from=2026-11-16&to=2026-11-10",
      "from=2026-11-10&to=2026-11-16&sql=DROP",
    ]) {
      expect(
        (
          await readAnalyticsReport(
            new Request(`https://example.com/api/admin/analytics?${params}`),
            admin,
            repository,
            now,
          )
        ).status,
      ).toBe(400);
    }
    const response = await readAnalyticsReport(
      new Request(
        "https://example.com/api/admin/analytics?from=2026-11-10&to=2026-11-16",
      ),
      admin,
      repository,
      now,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(repository.report).toHaveBeenCalledTimes(1);
  });
  it("handles UTC month boundaries and inclusive days with standard date validation", () => {
    expect(
      defaultAnalyticsFilter(Date.parse("2026-01-02T00:00:01Z"), 7),
    ).toEqual({ from: "2025-12-27", to: "2026-01-02" });
    expect(
      analyticsInterval(defaultAnalyticsFilter(now, 90), now),
    ).not.toBeNull();
    expect(
      analyticsFilterSchema.safeParse({ from: "2026-02-30", to: "2026-11-16" })
        .success,
    ).toBe(false);
  });
});
