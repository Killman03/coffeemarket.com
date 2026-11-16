// @vitest-environment node
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  BrowserAnalytics,
  captureAnalyticsAttribution,
  ANALYTICS_STORAGE_KEY,
} from "./browser-analytics";
import type { AnalyticsEvent } from "../domain/analytics";
const context = { market: "KG", currency: "KGS" } as const;
const attribution = { source: "instagram", medium: "paid", campaign: "coffee" };
function storage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}
afterEach(() => vi.useRealTimers());
describe("privacy-preserving browser observations", () => {
  it("handles unusual referrer hosts and unavailable browser capabilities without interrupting the caller", () => {
    expect(
      captureAnalyticsAttribution(
        "https://example.com/",
        "http://[::1]/private?phone=secret",
      ),
    ).toEqual({ source: "direct", medium: "none", campaign: "" });
    const tracker = new BrowserAnalytics(
      null,
      { source: "https://invalid.example/", medium: "", campaign: "" },
      async () => "accepted",
    );
    expect(() => tracker.track("page_view", context)).not.toThrow();
    expect(tracker.sessionId()).toBeUndefined();
  });
  it("extracts only UTM labels and an external hostname without retaining URL data", () => {
    expect(
      captureAnalyticsAttribution(
        "https://example.com/?utm_source=Instagram&utm_medium=Paid&utm_campaign=Coffee&phone=secret&fbclid=secret#private",
        "https://google.com/search?q=secret",
      ),
    ).toEqual({ source: "instagram", medium: "paid", campaign: "Coffee" });
    expect(
      captureAnalyticsAttribution(
        "https://example.com/",
        "https://google.com/search?q=secret",
      ),
    ).toEqual({ source: "google.com", medium: "referral", campaign: "" });
    expect(
      captureAnalyticsAttribution(
        "https://example.com/?utm_source=https://evil.example/person@example.com",
        "https://example.com/admin",
      ),
    ).toEqual({ source: "direct", medium: "none", campaign: "" });
  });
  it("creates one page milestone, preserves IDs across reload, and sends no financial data", async () => {
    const store = storage(),
      events: AnalyticsEvent[] = [],
      send = vi.fn(async (event: AnalyticsEvent) => {
        events.push(event);
        return "accepted" as const;
      });
    const first = new BrowserAnalytics(store, attribution, send);
    first.track("page_view", context);
    await first.flush();
    await Promise.resolve();
    const id = first.sessionId();
    first.stop();
    const next = new BrowserAnalytics(
      store,
      { source: "other", medium: "", campaign: "" },
      send,
    );
    next.track("page_view", context);
    next.track("calculation_started", context);
    await Promise.resolve();
    await Promise.resolve();
    expect(next.sessionId()).toBe(id);
    expect(events.map((event) => event.name)).toEqual([
      "page_view",
      "calculation_started",
    ]);
    expect(events[1].attribution.source).toBe("instagram");
    expect(Object.keys(events[1]).sort()).toEqual([
      "attribution",
      "context",
      "eventId",
      "name",
      "sequence",
      "sessionId",
      "version",
    ]);
    next.stop();
  });
  it("rotates after thirty minutes of inactivity and begins with a new page observation", async () => {
    let now = 1000;
    const send = vi.fn().mockResolvedValue("accepted"),
      tracker = new BrowserAnalytics(storage(), attribution, send, () => now);
    tracker.track("page_view", context);
    await Promise.resolve();
    const first = tracker.sessionId();
    now += 30 * 60_000;
    tracker.track("sample_clicked", context);
    await Promise.resolve();
    await Promise.resolve();
    expect(tracker.sessionId()).not.toBe(first);
    expect(send.mock.calls.map((call) => call[0].name)).toEqual([
      "page_view",
      "page_view",
      "sample_clicked",
    ]);
    tracker.stop();
  });
  it("retries with the same event ID and drains observations in order", async () => {
    vi.useFakeTimers();
    const send = vi
        .fn()
        .mockResolvedValueOnce("retry")
        .mockResolvedValue("accepted"),
      tracker = new BrowserAnalytics(storage(), attribution, send);
    tracker.track("page_view", context);
    tracker.track("calculation_started", context);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(2000);
    expect(send.mock.calls.map((call) => call[0].name)).toEqual([
      "page_view",
      "page_view",
      "calculation_started",
    ]);
    expect(send.mock.calls[0][0].eventId).toBe(send.mock.calls[1][0].eventId);
    tracker.stop();
  });
  it("erases local observations on opt-out and stops pending retries", async () => {
    vi.useFakeTimers();
    const store = storage(),
      send = vi.fn().mockResolvedValue("retry"),
      tracker = new BrowserAnalytics(store, attribution, send);
    tracker.track("page_view", context);
    await Promise.resolve();
    tracker.stop(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(store.getItem(ANALYTICS_STORAGE_KEY)).toBeNull();
    expect(tracker.sessionId()).toBeUndefined();
  });
  it("keeps storage failures and corrupt saved data from breaking the caller", async () => {
    const denied = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    const tracker = new BrowserAnalytics(
      denied,
      attribution,
      async () => "accepted",
    );
    expect(() => tracker.track("sample_clicked", context)).not.toThrow();
    tracker.stop(true);
    const store = storage();
    store.setItem(ANALYTICS_STORAGE_KEY, "{broken");
    expect(() =>
      new BrowserAnalytics(store, attribution, async () => "accepted").stop(),
    ).not.toThrow();
  });
});
