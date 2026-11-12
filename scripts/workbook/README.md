# Three-month P&L workbook

The production app loads `public/templates/coffee-market-pnl-3-months.xlsx` and
personalizes it with `createPnlWorkbook`. It uses ExcelJS in both the browser and
the server. There is no Python, Artifact Tool, spreadsheet server or macro in the
production path. Load this module lazily for a browser download.

## Model

Four sheets have distinct roles:

- **P&L**: one forecast for three chronological months and the period total.
- **Сценарии**: one authoritative selector and editable monthly volume, price,
  production-cost and fixed-expense factors. Factors start at 1; the user supplies
  assumptions for each case. The model does not invent growth rates.
- **План-факт**: monthly actuals and variances. A result remains blank until all
  ten actual rows are entered; explicit zero is valid.
- **Данные**: market, currency, prices, ingredient recipes, six menu slots and
  monthly expenses. Only the source calculator drink is initially populated.

Production cost uses the same ingredients/loss/packaging formula as the shared
domain calculator, without intermediate rounding. Commissions and entered
turnover tax are separate expenses. Depreciation and interest are explicit zero
inputs. Corporate income tax and VAT are not separately modeled. Capex and debt
principal do not enter the P&L. The result is not a cash balance.

No foreign-exchange conversion occurs. Monetary formatting uses standard Intl
currency precision, including JPY (0) and KWD (3). Excel formulas retain their
underlying precision.

## Stable input mapping

On **Данные**: `C5` market name, `C6` currency, `C7` first forecast month;
`C11:C13` ingredient prices; `C14:C16` fractional loss, fee and turnover-tax rates;
`C21:I21` sale price, cups/day, coffee g, milk ml, syrup ml, packaging and other
per-cup cost; `C31:C34` rent, salaries, utilities and other fixed expenses.
`C35:C36` depreciation and loan interest remain editable zero inputs.

On **Сценарии**: `C5` case selector; `C9:E9` monthly working days; active factors
in rows 12, 18, 24 and 30 select the case input rows immediately below them.

On **P&L**: `C29:E29` final monthly results; `F29` three-month total. Ratios are
calculated from matching aggregate amounts instead of summing percentages.

On **План-факт**: actuals `D10:D19`, `G10:G19`, `J10:J19` and calculated results
in row 21. Each month has Plan / Actual / Actual-minus-plan columns.

The checked-in template is trusted application code, not an upload surface.
Rebuilding a template requires updating and re-running its reconciliation checks.

## Authoring and verification

The complete template is authored with the bundled `@oai/artifact-tool`. The
builder recalculates, reconciles with an independent calculation, tests case
changes and missing-versus-zero inputs, scans errors and renders all four tabs.

ExcelJS 4.4 cannot read namespace-prefixed SpreadsheetML elements emitted by
Artifact Tool. Its export is therefore normalized once with a standard openpyxl
read/save during authoring. There is no XML patching or runtime normalization.
This step also removes the template's cached results. The production writer
removes stale formula results and requests Excel's `fullCalcOnLoad`; Excel or
LibreOffice recalculates on opening. A viewer without a calculation engine may
not display formula results until the file is opened in a spreadsheet app.

Use the runtime paths returned by `load_workspace_dependencies`. In this builder
directory, make `node_modules` a junction to the bundled Node packages; this is
authoring tool setup, not an application module-path override.

```powershell
& $bundledNode scripts/workbook/build-template.mjs --python $bundledPython
& $bundledNode scripts/workbook/verify-runtime.mjs --output <output.xlsx>
npm test -- src/infrastructure/pnl-workbook.test.ts
```

The runtime verifier uses the project's standard Vite compiler, generates the
same file as the browser/server, then imports that actual file into Artifact Tool
to recalculate and reconcile all three months with the shared domain calculator.
It also changes a third-month scenario factor and tests blank versus zero actuals.
Native Excel/LibreOffice interactive verification is not automated here.
