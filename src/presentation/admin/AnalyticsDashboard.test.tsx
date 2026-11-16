import { afterEach, describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AnalyticsDashboard } from "./AnalyticsDashboard";
import {
  defaultAnalyticsFilter,
  type AnalyticsReport,
} from "../../domain/analytics";
vi.mock("./TrafficChart", () => ({ default: () => <div>График сессий</div> }));
const now = Date.now(),
  filter = defaultAnalyticsFilter(now);
function report(): AnalyticsReport {
  return {
    window: { ...filter, timeZone: "UTC", generatedAt: now },
    metrics: {
      sessions: 0,
      views: 0,
      engaged: 0,
      completed: 0,
      sampleClicks: 0,
      pnlOpened: 0,
      telegramClicks: 0,
    },
    daily: [],
    sources: [],
    markets: [],
    requests: { accepted: 0, chatReceived: 0, delivered: 0, unattributed: 0 },
  };
}
afterEach(() => vi.unstubAllGlobals());
describe("owner analytics dashboard", () => {
  it("renders truthful empty states, attribution filters and disconnected delivery", () => {
    render(
      <AnalyticsDashboard
        initial={report()}
        initialFilter={filter}
        userDisplayName="Владелец"
        deliveryReady={false}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Пока нет сессий за этот период" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Рынок при входе")).toHaveValue("");
    expect(screen.getByText(/Telegram пока не подключён/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Настройки" })).toHaveAttribute(
      "href",
      "/admin",
    );
  });
  it("applies validated filters through the protected report endpoint", async () => {
    const fetch_ = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          ...report(),
          metrics: { ...report().metrics, sessions: 2 },
        }),
      });
    vi.stubGlobal("fetch", fetch_);
    render(
      <AnalyticsDashboard
        initial={report()}
        initialFilter={filter}
        userDisplayName="Владелец"
        deliveryReady={false}
      />,
    );
    fireEvent.change(screen.getByLabelText("Источник"), {
      target: { value: "Instagram" },
    });
    fireEvent.change(screen.getByLabelText("Рынок при входе"), {
      target: { value: "KZ" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Применить фильтры" }));
    await waitFor(() => expect(fetch_).toHaveBeenCalledTimes(1));
    expect(fetch_.mock.calls[0][0]).toContain("source=instagram");
    expect(fetch_.mock.calls[0][0]).toContain("market=KZ");
    expect(fetch_.mock.calls[0][1].cache).toBe("no-store");
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", {
          name: "Пока нет сессий за этот период",
        }),
      ).not.toBeInTheDocument(),
    );
  });
  it("preserves the last report and explains expired owner authorization", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401 }),
    );
    render(
      <AnalyticsDashboard
        initial={report()}
        initialFilter={filter}
        userDisplayName="Владелец"
        deliveryReady={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Обновить данные" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Сессия владельца завершилась",
    );
    expect(
      screen.getByRole("heading", { name: "Пока нет сессий за этот период" }),
    ).toBeInTheDocument();
  });
});
