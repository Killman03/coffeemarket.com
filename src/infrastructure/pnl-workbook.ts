import ExcelJS from "exceljs";
import { calculatorSchema, type CalculatorInput } from "../domain/calculator";
import { contextSchema, currencyDigits, markets } from "../domain/markets";

export const PNL_TEMPLATE_URL = "/templates/coffee-market-pnl-3-months.xlsx";
export const PNL_FILENAME = "coffee-market-pnl-3-months.xlsx";

const SHEETS = ["P&L", "Сценарии", "План-факт", "Данные"] as const;
const MONEY_INPUT_CELLS = [
  "C11",
  "C12",
  "C13",
  "C31",
  "C32",
  "C33",
  "C34",
  "C35",
  "C36",
];

/** Personalizes the audited three-month financial-plan template.
 *
 * Args:
 *   input: Scenario values validated by the shared calculator schema.
 *   context: Supported market and currency; no foreign-exchange conversion occurs.
 *   template: Trusted XLSX template shipped with this application.
 *   now: Clock used to establish the first forecast month, injectable for tests.
 *
 * Returns:
 *   Macro-free XLSX bytes with editable inputs and recalculating Excel formulas.
 *   Cached template results are removed to prevent displaying stale forecasts.
 *
 * Raises:
 *   Error: The clock or trusted template has an unexpected structure.
 *   ZodError: Scenario values or market settings are invalid.
 */
export async function createPnlWorkbook(
  input: CalculatorInput,
  context: { market: string; currency: string },
  template: ArrayBuffer,
  now = new Date(),
): Promise<Uint8Array> {
  const values = calculatorSchema.parse(input);
  const settings = contextSchema.parse(context);
  if (!Number.isFinite(now.getTime()))
    throw new Error("Некорректная дата начала плана");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(template);
  const sheets = SHEETS.map((name) => workbook.getWorksheet(name));
  if (
    sheets.some((sheet) => !sheet) ||
    workbook.worksheets.length !== SHEETS.length
  ) {
    throw new Error("Шаблон P&L имеет неподдерживаемую структуру");
  }
  const pnl = workbook.getWorksheet("P&L")!;
  const assumptions = workbook.getWorksheet("Сценарии")!;
  const data = workbook.getWorksheet("Данные")!;
  if (!pnl.getCell("C29").formula || !data.getCell("J21").formula) {
    throw new Error("В шаблоне P&L отсутствуют расчётные формулы");
  }

  data.getCell("C5").value = markets.find(
    (market) => market.code === settings.market,
  )!.name;
  data.getCell("C6").value = settings.currency;
  data.getCell("C7").value = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  data.getCell("C7").numFmt = "[$-419]mmm yyyy";
  const inputCells: Record<string, number> = {
    C11: values.coffeePrice,
    C12: values.milkPrice,
    C13: values.syrupPrice,
    C14: values.lossPercent / 100,
    C15: values.feePercent / 100,
    C16: values.turnoverTaxPercent / 100,
    C21: values.salePrice,
    D21: values.cupsPerDay,
    E21: values.dose,
    F21: values.milk,
    G21: values.syrup,
    H21: values.packaging,
    I21: values.otherPerCup,
    C31: values.rent,
    C32: values.salaries,
    C33: values.utilities,
    C34: values.otherFixed,
  };
  for (const [address, value] of Object.entries(inputCells))
    data.getCell(address).value = value;
  for (const column of ["C", "D", "E"])
    assumptions.getCell(`${column}9`).value = values.daysPerMonth;

  const digits = currencyDigits(settings.currency);
  const numeric = `#,##0${digits ? `.${"0".repeat(digits)}` : ""}`;
  const moneyFormat = `${numeric};(${numeric});"—"`;
  for (const address of MONEY_INPUT_CELLS)
    data.getCell(address).numFmt = moneyFormat;
  for (let row = 21; row <= 26; row++) {
    for (const column of ["C", "H", "I", "J"])
      data.getCell(`${column}${row}`).numFmt = moneyFormat;
  }

  for (const sheet of workbook.worksheets) {
    sheet.eachRow((row) =>
      row.eachCell((cell) => {
        if (cell.type === ExcelJS.ValueType.Formula) {
          // ExcelJS writes formulas; the spreadsheet application performs calculation.
          // Resolve any shared formula before removing the obsolete template cache.
          cell.value = { formula: cell.formula };
        }
        const rowNumber = Number(cell.row);
        const columnNumber = Number(cell.col);
        if (
          sheet.name === "P&L" &&
          rowNumber >= 9 &&
          rowNumber <= 30 &&
          columnNumber >= 3 &&
          ![9, 14, 30].includes(rowNumber)
        ) {
          cell.numFmt = moneyFormat;
        }
        if (
          sheet.name === "План-факт" &&
          rowNumber >= 10 &&
          rowNumber <= 21 &&
          columnNumber >= 3
        ) {
          cell.numFmt = moneyFormat;
        }
        if (cell.numFmt === "mmm yyyy") cell.numFmt = "[$-419]mmm yyyy";
      }),
    );
    sheet.pageSetup = {
      ...sheet.pageSetup,
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printArea:
        sheet.name === "P&L"
          ? "B2:F37"
          : sheet.name === "Сценарии"
            ? "B2:E37"
            : sheet.name === "План-факт"
              ? "B2:K27"
              : "B2:J43",
    };
  }
  workbook.creator = "Coffee Market";
  workbook.title = "P&L кофейной точки на 3 месяца";
  workbook.subject = `Плановые доходы и расходы в ${settings.currency}`;
  workbook.calcProperties.fullCalcOnLoad = true;
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
