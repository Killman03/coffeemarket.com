import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import assert from "node:assert/strict";
import { build } from "vite";
import ExcelJS from "exceljs";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const { values: args } = parseArgs({ options: { output: { type: "string" } } });
const output = path.resolve(
  args.output ?? path.join(root, "work/workbook-previews/personalized.xlsx"),
);
const compilerDirectory = path.join(root, "work/workbook-runtime");
await fs.mkdir(compilerDirectory, { recursive: true });
const entry = path.join(compilerDirectory, "entry.ts");
await fs.writeFile(
  entry,
  [
    'export {createPnlWorkbook} from "../../src/infrastructure/pnl-workbook.ts";',
    'export {defaultInput} from "../../src/application/scenarios.ts";',
    'export {calculate} from "../../src/domain/calculator.ts";',
  ].join("\n"),
);
await build({
  configFile: false,
  logLevel: "error",
  build: {
    outDir: compilerDirectory,
    emptyOutDir: false,
    lib: { entry, formats: ["es"], fileName: () => "runtime.mjs" },
    rollupOptions: { external: ["exceljs", "zod", "decimal.js"] },
  },
});
const runtime = await import(
  pathToFileURL(path.join(compilerDirectory, "runtime.mjs")).href
);
const template = Uint8Array.from(
  await fs.readFile(
    path.join(root, "public/templates/coffee-market-pnl-3-months.xlsx"),
  ),
).buffer;
const input = {
  ...runtime.defaultInput,
  coffeePrice: 2200,
  cupsPerDay: 60,
  rent: 25000,
};
const bytes = await runtime.createPnlWorkbook(
  input,
  { market: "KG", currency: "KGS" },
  template,
  new Date(),
);
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, bytes);

// Use the spreadsheet engine to calculate the actual shipped, personalized file.
const book = await SpreadsheetFile.importXlsx(await FileBlob.load(output));
book.recalculate();
const pnl = book.worksheets.getItem("P&L");
const result = runtime.calculate(input);
for (const column of ["C", "D", "E"])
  assert.ok(
    Math.abs(pnl.getRange(`${column}29`).values[0][0] - result.profit) < 0.005,
  );
assert.ok(
  Math.abs(pnl.getRange("F29").values[0][0] - result.profit * 3) < 0.02,
);
const actuals = book.worksheets.getItem("План-факт");
assert.equal(actuals.getRange("D21").values[0][0], "");
actuals.getRange("D10:D19").values = Array.from({ length: 10 }, () => [0]);
assert.equal(actuals.getRange("D21").values[0][0], 0);
actuals.getRange("D10:D19").clear({ applyTo: "contents" });
const scenario = book.worksheets.getItem("Сценарии");
scenario.getRange("C5").values = [["Оптимистичный"]];
scenario.getRange("E15").values = [[1.5]];
assert.ok(
  Math.abs(pnl.getRange("E10").values[0][0] - result.revenue * 1.5) < 0.005,
);
scenario.getRange("C5").values = [["Базовый"]];
scenario.getRange("E15").values = [[1]];
book.recalculate();
const errors = await book.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!",
  options: { useRegex: true, maxResults: 20 },
});
console.log(errors.ndjson);
// Preserve the production writer's file; verification must not replace it with
// an authoring-engine export. The file requests full recalculation on opening.
const roundtrip = new ExcelJS.Workbook();
await roundtrip.xlsx.load(Uint8Array.from(bytes).buffer);
assert.equal(roundtrip.getWorksheet("Данные").getCell("C11").value, 2200);
console.log(
  JSON.stringify({
    output,
    expectedMonthlyProfit: result.profit,
    expectedRevenue: result.revenue,
    checked:
      "runtime output recalculation, shared-domain reconciliation, scenario edits, actual zero versus blank",
  }),
);
