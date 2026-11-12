import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { File as NodeFile } from "node:buffer";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Calculator } from "./Calculator";
import { catalogRepository } from "../infrastructure/catalog-repository";
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

describe("calculator interactions", () => {
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
      expect(screen.getByLabelText("Цена продажи чашки")).toHaveValue(0),
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
