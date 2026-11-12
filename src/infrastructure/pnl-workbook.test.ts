// @vitest-environment node
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { defaultInput } from "../application/scenarios";
import { createPnlWorkbook } from "./pnl-workbook";

const templateUrl = new URL(
  "../../public/templates/coffee-market-pnl-3-months.xlsx",
  import.meta.url,
);
async function template(): Promise<ArrayBuffer> {
  const bytes = await readFile(templateUrl);
  return Uint8Array.from(bytes).buffer;
}
async function personalized(currency = "USD") {
  const bytes = await createPnlWorkbook(
    {
      ...defaultInput,
      coffeePrice: 25,
      salePrice: 4,
      cupsPerDay: 80,
      daysPerMonth: 24,
      rent: 650,
      feePercent: 3,
      turnoverTaxPercent: 2,
    },
    { market: "OTHER", currency },
    await template(),
    new Date("2026-12-15T12:00:00Z"),
  );
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(bytes).buffer);
  return workbook;
}

describe("three-month P&L workbook", () => {
  it("personalizes the existing formula template without retaining stale results", async () => {
    const workbook = await personalized();
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "P&L",
      "Сценарии",
      "План-факт",
      "Данные",
    ]);
    const data = workbook.getWorksheet("Данные")!;
    expect(data.getCell("C5").value).toBe("Другая страна");
    expect(data.getCell("C6").value).toBe("USD");
    expect(data.getCell("C7").value).toEqual(new Date("2026-12-01T00:00:00Z"));
    expect(data.getCell("C11").value).toBe(25);
    expect(data.getCell("C21").value).toBe(4);
    expect(data.getCell("D21").value).toBe(80);
    expect(data.getCell("C31").value).toBe(650);
    expect(data.getCell("C15").value).toBe(0.03);
    expect(data.getCell("C16").value).toBe(0.02);
    expect(data.getCell("J21").formula).toContain("/(1-$C$14)");
    expect(data.getCell("C22").value).toBe(0);
    const assumptions = workbook.getWorksheet("Сценарии")!;
    expect(
      ["C9", "D9", "E9"].map((cell) => assumptions.getCell(cell).value),
    ).toEqual([24, 24, 24]);
    expect(assumptions.getCell("C5").value).toBe("Базовый");
    expect(workbook.getWorksheet("P&L")!.getCell("E29").formula).toBe(
      "E26-E27",
    );
    expect(workbook.getWorksheet("P&L")!.getCell("F29").formula).toBe(
      "SUM(C29:E29)",
    );
    expect(workbook.getWorksheet("P&L")!.getCell("C29").result).toBeUndefined();
    // ExcelJS writes fullCalcOnLoad but does not read that property back.
    // The exported setting is checked by the workbook verification script.
  });

  it.each([
    ["JPY", '#,##0;(#,##0);"—"'],
    ["KWD", '#,##0.000;(#,##0.000);"—"'],
  ])("uses the actual minor units of %s", async (currency, format) => {
    const workbook = await personalized(currency);
    expect(workbook.getWorksheet("Данные")!.getCell("C11").numFmt).toBe(format);
    expect(workbook.getWorksheet("P&L")!.getCell("C29").numFmt).toBe(format);
    expect(workbook.getWorksheet("P&L")!.getCell("C30").numFmt).toBe("0.0%");
  });

  it("keeps actuals empty and distinguishes missing actuals from recorded zero", async () => {
    const workbook = await personalized();
    const actuals = workbook.getWorksheet("План-факт")!;
    expect(actuals.getCell("D10").value).toBeNull();
    expect(actuals.getCell("D21").formula).toBe(
      'IF(COUNT(D10:D19)=10,D10-SUM(D11:D19),"")',
    );
    expect(actuals.getCell("E10").formula).toBe('IF(ISNUMBER(D10),D10-C10,"")');
    expect(actuals.getCell("D10").dataValidation).toMatchObject({
      type: "decimal",
      operator: "between",
    });
  });

  it("rejects invalid inputs and unsupported market settings at the shared boundary", async () => {
    await expect(
      createPnlWorkbook(
        { ...defaultInput, lossPercent: 100 },
        { market: "KG", currency: "KGS" },
        await template(),
      ),
    ).rejects.toThrow();
    await expect(
      createPnlWorkbook(
        defaultInput,
        { market: "OTHER", currency: "FAKE" },
        await template(),
      ),
    ).rejects.toThrow();
  });

  it("rejects an incompatible XLSX instead of generating a partial financial model", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Unexpected");
    const bytes = await workbook.xlsx.writeBuffer();
    await expect(
      createPnlWorkbook(
        defaultInput,
        { market: "KG", currency: "KGS" },
        Uint8Array.from(new Uint8Array(bytes)).buffer,
      ),
    ).rejects.toThrow("структуру");
  });
});
