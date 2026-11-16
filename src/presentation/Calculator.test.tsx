import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { File as NodeFile } from "node:buffer";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Calculator } from "./Calculator";
import { catalogRepository } from "../infrastructure/catalog-repository";
import { BrowserScenarioStore } from "../infrastructure/scenario-storage";
import { publicSettingsSchema } from "../domain/site-settings";
import { currencies } from "../domain/markets";
import {
  createScenario,
  defaultInput,
  scenarioSchema,
} from "../application/scenarios";

vi.mock("./ProfitChart", () => ({ ProfitChart: () => <div>График</div> }));
beforeEach(() => window.localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const renderCalculator = () =>
  render(<Calculator catalog={catalogRepository.getCatalog()} />);

function configuredSettings() {
  return publicSettingsSchema.parse({
    defaults: Object.fromEntries(
      currencies.map(({ code }) => [
        code,
        {
          ...defaultInput,
          coffeePrice: code === "USD" ? 23 : 555,
          salePrice: code === "USD" ? 8 : 999,
          rent: code === "USD" ? 400 : 45000,
        },
      ]),
    ),
    content: {
      calculatorTitle: "<img src=x onerror=alert(1)>",
      calculatorDescription: "Описание расчёта <strong>без HTML</strong>",
      pnlTitle: "<script>alert(1)</script>",
      pnlDescription: "Ваш план на три месяца",
      pnlButtonLabel: "Забрать мой план",
    },
  });
}

describe("calculator interactions", () => {
  it("uses configured Kyrgyz defaults without catalog or recipe price replacement", async () => {
    render(
      <Calculator
        catalog={catalogRepository.getCatalog()}
        settings={configuredSettings()}
      />,
    );
    expect(screen.getByLabelText("Цена кофе")).toHaveValue(555);
    expect(screen.getByLabelText("Кофе из каталога Coffee Market")).toHaveValue(
      "custom",
    );
    fireEvent.click(screen.getByRole("button", { name: /Американо/ }));
    expect(screen.getByLabelText("Цена продажи чашки")).toHaveValue(999);
    fireEvent.change(screen.getByLabelText("Цена кофе"), {
      target: { value: "700" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сбросить параметры" }));
    expect(screen.getByLabelText("Цена кофе")).toHaveValue(555);
    expect(screen.getByLabelText("Цена продажи чашки")).toHaveValue(999);
    fireEvent.change(screen.getByLabelText("Кофе из каталога Coffee Market"), {
      target: { value: "60" },
    });
    expect(screen.getByLabelText("Цена кофе")).toHaveValue(1899);
  });

  it("uses defaults for the selected currency when entering a new market scenario", async () => {
    render(
      <Calculator
        catalog={catalogRepository.getCatalog()}
        settings={configuredSettings()}
        initialContext={{ market: "OTHER", currency: "USD" }}
      />,
    );
    expect(screen.getByLabelText("Цена кофе")).toHaveValue(23);
    expect(screen.getByLabelText("Цена продажи чашки")).toHaveValue(8);
    expect(
      screen.queryByLabelText("Кофе из каталога Coffee Market"),
    ).toBeNull();
    fireEvent.change(screen.getByLabelText("Рынок", { exact: true }), {
      target: { value: "KZ" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Перейти$/ }));
    await waitFor(() =>
      expect(screen.getByLabelText("Валюта расчёта")).toHaveValue("KZT"),
    );
    expect(screen.getByLabelText("Цена кофе")).toHaveValue(555);
    expect(screen.getByLabelText("Цена продажи чашки")).toHaveValue(999);
  });

  it("preserves saved zero values and unsaved edits across parent settings rerenders", async () => {
    const store = new BrowserScenarioStore(window.localStorage);
    store.save({ ...defaultInput, coffeePrice: 0, salePrice: 0, rent: 0 });
    const page = render(
      <Calculator
        catalog={catalogRepository.getCatalog()}
        settings={configuredSettings()}
      />,
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Цена кофе")).toHaveValue(0),
    );
    expect(screen.getByLabelText("Цена продажи чашки")).toHaveValue(0);
    fireEvent.change(screen.getByLabelText("Цена кофе"), {
      target: { value: "123" },
    });
    const updatedSettings = configuredSettings();
    updatedSettings.defaults.KGS.coffeePrice = 9999;
    page.rerender(
      <Calculator
        catalog={catalogRepository.getCatalog()}
        settings={updatedSettings}
      />,
    );
    expect(screen.getByLabelText("Цена кофе")).toHaveValue(123);
    expect(screen.getByLabelText("Цена продажи чашки")).toHaveValue(0);
  });

  it("renders configured public content as escaped text", () => {
    const settings = configuredSettings();
    const page = render(
      <Calculator
        catalog={catalogRepository.getCatalog()}
        settings={settings}
      />,
    );
    expect(
      screen.getByRole("heading", { name: settings.content.calculatorTitle }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(settings.content.calculatorDescription),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: settings.content.pnlTitle }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(settings.content.pnlDescription),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: settings.content.pnlButtonLabel }),
    ).toBeInTheDocument();
    expect(page.container.querySelector("script, img")).toBeNull();
  });
  it("opens and resets a populated manual example while preserving explicit saved zero values", async () => {
    const context = { market: "OTHER", currency: "USD" } as const;
    const store = new BrowserScenarioStore(window.localStorage);
    store.save({ ...defaultInput, coffeePrice: 0, salePrice: 0 }, context);
    store.saveLastContext(context);
    renderCalculator();
    await waitFor(() =>
      expect(screen.getByLabelText("Валюта расчёта")).toHaveValue("USD"),
    );
    expect(screen.getByLabelText("Цена кофе")).toHaveValue(0);
    expect(screen.getByLabelText("Цена продажи чашки")).toHaveValue(0);
    fireEvent.click(screen.getByRole("button", { name: "Сбросить параметры" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Цена кофе")).toHaveValue(20),
    );
    expect(screen.getByLabelText("Цена продажи чашки")).toHaveValue(3);
    expect(screen.getByLabelText("Чашек в день")).toHaveValue(20);
    expect(screen.getByTestId("monthly-profit")).not.toHaveTextContent(
      /^0 USD$/,
    );
    expect(store.load(context)?.input.salePrice).toBe(0);
  });

  it("imports a valid file using the standard File API", async () => {
    renderCalculator();
    const file = new NodeFile(
      [JSON.stringify(createScenario({ ...defaultInput, cupsPerDay: 81 }))],
      "scenario.json",
      { type: "application/json" },
    );
    fireEvent.change(screen.getByLabelText("Файл расчёта JSON"), {
      target: { files: [file] },
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Чашек в день")).toHaveValue(81),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Расчёт импортирован");
  });

  it("rejects malformed imports without changing the calculation", async () => {
    renderCalculator();
    const file = new NodeFile(["{}"], "invalid.json", {
      type: "application/json",
    });
    fireEvent.change(screen.getByLabelText("Файл расчёта JSON"), {
      target: { files: [file] },
    });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Не удалось импортировать",
      ),
    );
    expect(screen.getByLabelText("Чашек в день")).toHaveValue(50);
  });

  it("exports a valid, reimportable JSON blob and invokes a download", async () => {
    let exported: Blob | null = null;
    const OriginalURL = URL;
    vi.stubGlobal(
      "URL",
      class extends OriginalURL {
        static createObjectURL(blob: Blob) {
          exported = blob;
          return "blob:test-export";
        }
        static revokeObjectURL() {}
      },
    );
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    renderCalculator();
    fireEvent.click(screen.getByRole("button", { name: "Экспорт" }));
    expect(click).toHaveBeenCalledOnce();
    const json = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsText(exported!);
    });
    expect(scenarioSchema.parse(JSON.parse(json)).input).toEqual(defaultInput);
  });
  it("recalculates immediately when sales volume changes", async () => {
    renderCalculator();
    expect(screen.getByTestId("monthly-profit")).toHaveTextContent(
      /97\s649,89/,
    );
    fireEvent.change(screen.getByLabelText("Чашек в день"), {
      target: { value: "0" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("monthly-profit")).toHaveTextContent(
        /−?-?50\s000/,
      ),
    );
    expect(screen.getByText("Прогноз убытка / месяц")).toBeInTheDocument();
  });

  it("does not show stale results for invalid inputs", async () => {
    renderCalculator();
    fireEvent.change(screen.getByLabelText("Рабочих дней в месяц"), {
      target: { value: "32" },
    });
    await waitFor(() =>
      expect(screen.getByText("Не больше 31 дня")).toBeInTheDocument(),
    );
    expect(screen.getByText("Проверим параметры")).toBeInTheDocument();
    expect(screen.getByTestId("monthly-profit")).toHaveTextContent("—");
  });

  it("converts package prices to per-kilogram prices and marks unavailable stock", async () => {
    renderCalculator();
    fireEvent.change(screen.getByLabelText("Кофе из каталога Coffee Market"), {
      target: { value: "42" },
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Цена кофе")).toHaveValue(3396),
    );
    expect(
      screen.getByText(/Нет в наличии на дату получения/),
    ).toBeInTheDocument();
  });

  it("changes recipes and validates the retained business inputs", async () => {
    renderCalculator();
    fireEvent.click(screen.getByRole("button", { name: /Американо/ }));
    await waitFor(() =>
      expect(screen.getByLabelText("Молоко на порцию")).toHaveValue(0),
    );
    expect(screen.getByLabelText("Цена продажи чашки")).toHaveValue(130);
    expect(screen.getByLabelText("Чашек в день")).toHaveValue(50);
  });

  it("saves and restores a valid calculation on remount", async () => {
    const page = renderCalculator();
    fireEvent.change(screen.getByLabelText("Чашек в день"), {
      target: { value: "73" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(screen.getByRole("status")).toHaveTextContent("Расчёт сохранён");
    page.unmount();
    renderCalculator();
    await waitFor(() =>
      expect(screen.getByLabelText("Чашек в день")).toHaveValue(73),
    );
  });

  it("keeps market scenarios separate without relabeling their prices", async () => {
    renderCalculator();
    fireEvent.change(screen.getByLabelText("Цена продажи чашки"), {
      target: { value: "250" },
    });
    fireEvent.change(screen.getByLabelText("Рынок", { exact: true }), {
      target: { value: "KZ" },
    });
    expect(screen.getByLabelText("Цена продажи чашки")).toHaveValue(250);
    fireEvent.click(screen.getByRole("button", { name: /^Перейти$/ }));
    await waitFor(() =>
      expect(screen.getByLabelText("Цена продажи чашки")).toHaveValue(1000),
    );
    expect(
      screen.queryByLabelText("Кофе из каталога Coffee Market"),
    ).toBeNull();
    fireEvent.change(screen.getByLabelText("Цена продажи чашки"), {
      target: { value: "1200" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Американо/ }));
    expect(screen.getByLabelText("Цена продажи чашки")).toHaveValue(1200);
    fireEvent.change(screen.getByLabelText("Рынок", { exact: true }), {
      target: { value: "KG" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Перейти$/ }));
    await waitFor(() =>
      expect(screen.getByLabelText("Цена продажи чашки")).toHaveValue(250),
    );
    expect(
      screen.getByLabelText("Кофе из каталога Coffee Market"),
    ).toBeInTheDocument();
  });

  it("can cancel currency switching and retains invalid edits", async () => {
    renderCalculator();
    fireEvent.change(screen.getByLabelText("Валюта расчёта"), {
      target: { value: "USD" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(screen.getByLabelText("Валюта расчёта")).toHaveValue("KGS");
    fireEvent.change(screen.getByLabelText("Рабочих дней в месяц"), {
      target: { value: "32" },
    });
    fireEvent.change(screen.getByLabelText("Валюта расчёта"), {
      target: { value: "USD" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Перейти$/ }));
    await waitFor(() =>
      expect(
        screen.getByText(/Исправьте ошибки, чтобы сохранить/),
      ).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Валюта расчёта")).toHaveValue("KGS");
    expect(screen.getByLabelText("Рабочих дней в месяц")).toHaveValue(32);
  });

  it("migrates legacy imports explicitly to the original currency", async () => {
    renderCalculator();
    const legacy = {
      version: 1,
      savedAt: new Date().toISOString(),
      input: { ...defaultInput, salePrice: 301 },
    };
    const file = new NodeFile([JSON.stringify(legacy)], "legacy.json", {
      type: "application/json",
    });
    fireEvent.change(screen.getByLabelText("Файл расчёта JSON"), {
      target: { files: [file] },
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Цена продажи чашки")).toHaveValue(301),
    );
    expect(screen.getByLabelText("Валюта расчёта")).toHaveValue("KGS");
  });
});
