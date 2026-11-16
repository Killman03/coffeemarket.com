import { useEffect } from "react";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AnalyticsProvider, useAnalytics } from "./AnalyticsProvider";
import { Calculator } from "./Calculator";
import { catalogRepository } from "../infrastructure/catalog-repository";
import {
  ANALYTICS_STORAGE_KEY,
  ANALYTICS_PREFERENCE_KEY,
} from "../infrastructure/browser-analytics";
vi.mock("./ProfitChart", () => ({ ProfitChart: () => null }));
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function Probe() {
  const analytics = useAnalytics();
  useEffect(() => {
    if (analytics.ready)
      analytics.track("page_view", { market: "KG", currency: "KGS" });
  }, [analytics.ready, analytics.track]);
  return (
    <button
      onClick={() =>
        analytics.track("sample_clicked", { market: "KG", currency: "KGS" })
      }
    >
      Пример
    </button>
  );
}
function transport() {
  const fetch_ = vi.fn(async (url: string) => ({
    ok: true,
    status: 202,
    json: async () =>
      url === "/api/pnl/config" ? { ready: false } : { ok: true },
  }));
  vi.stubGlobal("fetch", fetch_);
  return fetch_;
}

describe("scoped analytics instrumentation", () => {
  it("does not record owner visits or widgets without a provider", async () => {
    const fetch_ = transport();
    render(
      <AnalyticsProvider enabled={false}>
        <Probe />
      </AnalyticsProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Пример" }));
    expect(fetch_).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(ANALYTICS_STORAGE_KEY)).toBeNull();
  });
  it("clears the session on opt-out and remembers only the boolean preference", async () => {
    const fetch_ = transport();
    render(
      <AnalyticsProvider enabled>
        <Probe />
      </AnalyticsProvider>,
    );
    await waitFor(() => expect(fetch_).toHaveBeenCalledTimes(1));
    expect(sessionStorage.getItem(ANALYTICS_STORAGE_KEY)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Отключить" }));
    expect(localStorage.getItem(ANALYTICS_PREFERENCE_KEY)).toBe("off");
    expect(sessionStorage.getItem(ANALYTICS_STORAGE_KEY)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Пример" }));
    expect(fetch_).toHaveBeenCalledTimes(1);
  });
  it("honors browser Do Not Track before creating any session", async () => {
    vi.stubGlobal("navigator", { doNotTrack: "1" });
    const fetch_ = transport();
    render(
      <AnalyticsProvider enabled>
        <Probe />
      </AnalyticsProvider>,
    );
    await screen.findByText("Статистика отключена настройкой браузера");
    expect(fetch_).not.toHaveBeenCalled();
  });
  it("counts the initial view but waits for an explicit edit before start and completion", async () => {
    const observations: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options?: RequestInit) => {
        if (url === "/api/analytics/events")
          observations.push(JSON.parse(String(options?.body)).name);
        return { ok: true, status: 200, json: async () => ({ ready: false }) };
      }),
    );
    render(
      <AnalyticsProvider enabled>
        <Calculator catalog={catalogRepository.getCatalog()} />
      </AnalyticsProvider>,
    );
    await waitFor(() => expect(observations).toEqual(["page_view"]));
    fireEvent.change(screen.getByLabelText("Цена кофе"), {
      target: { value: "2100" },
    });
    await waitFor(
      () => expect(observations).toContain("calculation_completed"),
      { timeout: 2500 },
    );
    expect(observations.slice(0, 3)).toEqual([
      "page_view",
      "calculation_started",
      "calculation_completed",
    ]);
  });
});
