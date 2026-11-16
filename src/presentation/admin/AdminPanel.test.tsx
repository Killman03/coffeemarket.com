import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createDefaultSettings } from "../../application/site-settings";
import type { SettingsEnvelope } from "../../domain/site-settings";
import { currencies } from "../../domain/markets";
import { AdminPanel } from "./AdminPanel";

function initial(): SettingsEnvelope {
  const settings = createDefaultSettings();
  settings.telegram.managerUsername = "coffee_manager";
  settings.telegram.messageTemplate =
    "Здравствуйте! Мой код {code}. Рынок {market}, валюта {currency}.";
  return { revision: 7, updatedAt: 1794826800000, settings };
}

afterEach(() => vi.unstubAllGlobals());

describe("owner settings panel", () => {
  it("preserves changes across sections and currencies and saves one complete revision-checked draft", async () => {
    const fetch_ = vi.fn(async (_url: string, options: RequestInit) => {
      const payload = JSON.parse(String(options.body));
      return {
        ok: true,
        json: async () => ({
          revision: 8,
          updatedAt: 1794826900000,
          settings: payload.settings,
        }),
      };
    });
    vi.stubGlobal("fetch", fetch_);
    render(<AdminPanel initial={initial()} userDisplayName="Андрей" />);
    expect(
      screen.getByRole("button", { name: "Сохранить изменения" }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Username менеджера"), {
      target: { value: "@new_manager" },
    });
    fireEvent.click(screen.getByRole("tab", { name: /Начальные значения/ }));
    fireEvent.change(screen.getByLabelText("Цена напитка"), {
      target: { value: "210" },
    });
    fireEvent.change(screen.getByLabelText("Валюта исходных значений"), {
      target: { value: "USD" },
    });
    fireEvent.change(screen.getByLabelText("Цена напитка"), {
      target: { value: "6.25" },
    });
    fireEvent.change(screen.getByLabelText("Валюта исходных значений"), {
      target: { value: "KGS" },
    });
    expect(screen.getByLabelText("Цена напитка")).toHaveValue(210);
    fireEvent.click(screen.getByRole("tab", { name: /Тексты сайта/ }));
    fireEvent.change(screen.getByLabelText("Заголовок калькулятора"), {
      target: { value: "Экономика моей кофейни" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Сохранить изменения" }),
    );
    await screen.findByText("Настройки сохранены");
    expect(fetch_).toHaveBeenCalledTimes(1);
    const [url, options] = fetch_.mock.calls[0];
    expect(url).toBe("/api/admin/settings");
    expect(options).toMatchObject({
      method: "PUT",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-CoffeeMarket-Admin": "1",
      },
    });
    const payload = JSON.parse(String(options.body));
    expect(payload.revision).toBe(7);
    expect(payload.settings.telegram.managerUsername).toBe("new_manager");
    expect(payload.settings.defaults.KGS.salePrice).toBe(210);
    expect(payload.settings.defaults.USD.salePrice).toBe(6.25);
    expect(Object.keys(payload.settings.defaults)).toHaveLength(
      currencies.length,
    );
    expect(payload.settings.content.calculatorTitle).toBe(
      "Экономика моей кофейни",
    );
    expect(
      screen.getByRole("button", { name: "Сохранить изменения" }),
    ).toBeDisabled();
    expect(screen.getByText(/Версия 8/)).toBeInTheDocument();
  });

  it("keeps unsaved values and the original revision after a conflict", async () => {
    const fetch_ = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "<script>bad()</script>" }),
    });
    vi.stubGlobal("fetch", fetch_);
    const page = render(
      <AdminPanel initial={initial()} userDisplayName="Владелец" />,
    );
    fireEvent.change(screen.getByLabelText("Username менеджера"), {
      target: { value: "my_draft_manager" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Сохранить изменения" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Настройки изменились в другом окне",
    );
    expect(screen.getByLabelText("Username менеджера")).toHaveValue(
      "my_draft_manager",
    );
    expect(screen.getByText(/Версия 7/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Сохранить изменения" }),
    ).toBeEnabled();
    expect(page.container.querySelector("script")).toBeNull();
    expect(screen.queryByText("<script>bad()</script>")).toBeNull();
  });

  it("reveals an invalid field in another currency rather than silently losing it", async () => {
    const fetch_ = vi.fn();
    vi.stubGlobal("fetch", fetch_);
    render(<AdminPanel initial={initial()} userDisplayName="Владелец" />);
    fireEvent.click(screen.getByRole("tab", { name: /Начальные значения/ }));
    fireEvent.change(screen.getByLabelText("Валюта исходных значений"), {
      target: { value: "USD" },
    });
    fireEvent.change(screen.getByLabelText("Цена напитка"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("Валюта исходных значений"), {
      target: { value: "KGS" },
    });
    fireEvent.click(screen.getByRole("tab", { name: "Telegram" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Сохранить изменения" }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Валюта исходных значений")).toHaveValue(
        "USD",
      ),
    );
    expect(screen.getByLabelText("Цена напитка")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(fetch_).not.toHaveBeenCalled();
  });

  it("uses the shared safe Telegram preview and renders all text without HTML execution", () => {
    const settings = initial();
    settings.settings.telegram.messageTemplate =
      "<img src=x onerror=alert(1)> {code} {market} {currency}";
    settings.settings.content.calculatorTitle = "<script>example</script>";
    const page = render(
      <AdminPanel initial={settings} userDisplayName="<img src=x>" />,
    );
    const link = screen.getByRole("link", {
      name: "Открыть пример в Telegram",
    });
    const url = new URL(link.getAttribute("href")!);
    expect(url.origin).toBe("https://t.me");
    expect(url.pathname).toBe("/coffee_manager");
    expect(url.searchParams.get("text")).toBe(
      "<img src=x onerror=alert(1)> CM_пример Кыргызстан KGS",
    );
    expect(page.container.querySelector("img")).toBeNull();
    fireEvent.change(screen.getByLabelText("Username менеджера"), {
      target: { value: "https://evil.example" },
    });
    expect(
      screen.queryByRole("link", { name: "Открыть пример в Telegram" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /Тексты сайта/ }));
    expect(
      screen.getByRole("heading", { name: "<script>example</script>" }),
    ).toBeInTheDocument();
    expect(page.container.querySelector("script")).toBeNull();
  });

  it("explains missing delivery configuration and preserves a rejected enable attempt", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 422 }),
    );
    render(
      <AdminPanel
        initial={initial()}
        userDisplayName="Владелец"
        status={{
          deliveryReady: false,
          missing: ["Подключение бота", "Хранилище заявок"],
        }}
      />,
    );
    expect(screen.getByText("Подключение бота")).toBeInTheDocument();
    expect(
      screen.getByText(/Изменение username не подключает бота/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("switch", { name: /Принимать заявки на Excel/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Сохранить изменения" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "на сервере не завершена настройка доставки",
    );
    expect(
      screen.getByRole("switch", { name: /Принимать заявки на Excel/ }),
    ).toBeChecked();
    expect(
      screen.getByRole("button", { name: "Сохранить изменения" }),
    ).toBeEnabled();
  });

  it("supports arrow-key tab navigation and provides the platform sign-out link", () => {
    render(<AdminPanel initial={initial()} userDisplayName="Владелец" />);
    const telegram = screen.getByRole("tab", { name: "Telegram" });
    fireEvent.keyDown(telegram, { key: "ArrowRight" });
    const defaults = screen.getByRole("tab", { name: /Начальные значения/ });
    expect(defaults).toHaveAttribute("aria-selected", "true");
    expect(defaults).toHaveFocus();
    const signout = screen.getByRole("link", { name: "Выйти из аккаунта" });
    expect(signout).toHaveAttribute(
      "href",
      "/signout-with-chatgpt?return_to=%2Fadmin",
    );
    expect(signout).toHaveAttribute("target", "_top");
  });
});
