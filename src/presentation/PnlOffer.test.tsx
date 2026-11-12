import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { PnlOffer } from "./PnlOffer";
import { defaultInput } from "../application/scenarios";
import { defaultContext } from "../domain/markets";
import { CONSENT_TEXT } from "../domain/contact";

afterEach(() => vi.unstubAllGlobals());

describe("P&L manager handoff", () => {
  it("offers a real example without collecting contacts when delivery is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ ready: false })),
    );
    render(<PnlOffer input={defaultInput} context={defaultContext} />);
    await screen.findByText(/Выдача через менеджера пока не подключена/);
    expect(
      screen.getByRole("button", { name: "Получить в Telegram" }),
    ).toBeDisabled();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(
      screen.getByRole("link", { name: /Посмотреть пример Excel/ }),
    ).toHaveAttribute("href", "/templates/coffee-market-pnl-3-months.xlsx");
  });

  it("validates consent and phone before preparing an explicit manager message", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ready: true }))
      .mockResolvedValueOnce(
        Response.json({
          telegramUrl: "https://t.me/manager?text=CM_example",
          expiresAt: Date.now() + 900000,
        }),
      );
    vi.stubGlobal("fetch", fetcher);
    render(<PnlOffer input={defaultInput} context={defaultContext} />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Получить в Telegram" }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Получить в Telegram" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Подготовить сообщение/ }),
    );
    await screen.findByText("Подтвердите передачу данных для получения файла");
    expect(fetcher).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("Ваш номер с кодом страны"), {
      target: { value: "+12025550123" },
    });
    fireEvent.click(screen.getByLabelText(CONSENT_TEXT));
    fireEvent.click(
      screen.getByRole("button", { name: /Подготовить сообщение/ }),
    );
    const link = await screen.findByRole("link", {
      name: /Открыть чат менеджера/,
    });
    expect(link).toHaveAttribute(
      "href",
      "https://t.me/manager?text=CM_example",
    );
    const sent = JSON.parse(fetcher.mock.calls[1][1].body);
    expect(sent).toMatchObject({
      input: defaultInput,
      context: defaultContext,
      phone: "+12025550123",
      consent: true,
    });
  });

  it("does not retain a manager link after changing the underlying calculation", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ready: true }))
      .mockResolvedValueOnce(
        Response.json({
          telegramUrl: "https://t.me/manager?text=CM_example",
          expiresAt: Date.now() + 900000,
        }),
      );
    vi.stubGlobal("fetch", fetcher);
    const page = render(
      <PnlOffer input={defaultInput} context={defaultContext} />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Получить в Telegram" }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Получить в Telegram" }),
    );
    fireEvent.change(screen.getByLabelText("Ваш номер с кодом страны"), {
      target: { value: "+12025550123" },
    });
    fireEvent.click(screen.getByLabelText(CONSENT_TEXT));
    fireEvent.click(
      screen.getByRole("button", { name: /Подготовить сообщение/ }),
    );
    await screen.findByRole("link", { name: /Открыть чат менеджера/ });
    page.rerender(
      <PnlOffer
        input={{ ...defaultInput, salePrice: 250 }}
        context={defaultContext}
      />,
    );
    expect(
      screen.queryByRole("link", { name: /Открыть чат менеджера/ }),
    ).toBeNull();
  });

  it("ignores a delayed response for a scenario whose currency changed", async () => {
    let resolveDelivery!: (response: Response) => void;
    const pendingDelivery = new Promise<Response>((resolve) => {
      resolveDelivery = resolve;
    });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ready: true }))
      .mockReturnValueOnce(pendingDelivery);
    vi.stubGlobal("fetch", fetcher);
    const page = render(
      <PnlOffer input={defaultInput} context={defaultContext} />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Получить в Telegram" }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Получить в Telegram" }),
    );
    fireEvent.change(screen.getByLabelText("Ваш номер с кодом страны"), {
      target: { value: "+12025550123" },
    });
    fireEvent.click(screen.getByLabelText(CONSENT_TEXT));
    fireEvent.click(
      screen.getByRole("button", { name: /Подготовить сообщение/ }),
    );
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    page.rerender(
      <PnlOffer
        input={{ ...defaultInput, salePrice: 10 }}
        context={{ market: "OTHER", currency: "USD" }}
      />,
    );
    await act(async () => {
      resolveDelivery(
        Response.json({
          telegramUrl: "https://t.me/manager?text=old-KGS-scenario",
          expiresAt: Date.now() + 900000,
        }),
      );
      await pendingDelivery;
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Подготовить сообщение/ }),
      ).toBeEnabled(),
    );
    expect(
      screen.queryByRole("link", { name: /Открыть чат менеджера/ }),
    ).toBeNull();
    expect(screen.getByLabelText("Ваш номер с кодом страны")).toHaveValue(
      "+12025550123",
    );
  });

  it("does not show an old request error after changing the scenario", async () => {
    let rejectDelivery!: (reason: Error) => void;
    const pendingDelivery = new Promise<Response>((_resolve, reject) => {
      rejectDelivery = reject;
    });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ready: true }))
      .mockReturnValueOnce(pendingDelivery);
    vi.stubGlobal("fetch", fetcher);
    const page = render(
      <PnlOffer input={defaultInput} context={defaultContext} />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Получить в Telegram" }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Получить в Telegram" }),
    );
    fireEvent.change(screen.getByLabelText("Ваш номер с кодом страны"), {
      target: { value: "+12025550123" },
    });
    fireEvent.click(screen.getByLabelText(CONSENT_TEXT));
    fireEvent.click(
      screen.getByRole("button", { name: /Подготовить сообщение/ }),
    );
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    page.rerender(
      <PnlOffer
        input={{ ...defaultInput, salePrice: 10 }}
        context={defaultContext}
      />,
    );
    await act(async () => {
      rejectDelivery(new Error("Delayed network failure"));
      await pendingDelivery.catch(() => {});
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Подготовить сообщение/ }),
      ).toBeEnabled(),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps a prepared handoff when an unrelated parent render recreates equal values", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ready: true }))
      .mockResolvedValueOnce(
        Response.json({
          telegramUrl: "https://t.me/manager?text=CM_equal",
          expiresAt: Date.now() + 900000,
        }),
      );
    vi.stubGlobal("fetch", fetcher);
    const page = render(
      <PnlOffer input={defaultInput} context={defaultContext} />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Получить в Telegram" }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Получить в Telegram" }),
    );
    fireEvent.change(screen.getByLabelText("Ваш номер с кодом страны"), {
      target: { value: "+12025550123" },
    });
    fireEvent.click(screen.getByLabelText(CONSENT_TEXT));
    fireEvent.click(
      screen.getByRole("button", { name: /Подготовить сообщение/ }),
    );
    await screen.findByRole("link", { name: /Открыть чат менеджера/ });
    page.rerender(
      <PnlOffer input={{ ...defaultInput }} context={{ ...defaultContext }} />,
    );
    expect(
      screen.getByRole("link", { name: /Открыть чат менеджера/ }),
    ).toHaveAttribute("href", "https://t.me/manager?text=CM_equal");
  });
});
