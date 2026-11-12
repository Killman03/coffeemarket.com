import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { Workbook, SpreadsheetFile } from "@oai/artifact-tool";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const previewDir = path.join(root, "work/workbook-previews");
const output = path.join(
  root,
  "public/templates/coffee-market-pnl-3-months.xlsx",
);
const { values: arguments_ } = parseArgs({
  options: { python: { type: "string" } },
});
if (!arguments_.python)
  throw new Error(
    "Pass --python with the bundled Python executable for standards-compliant XLSX normalization.",
  );
const wb = Workbook.create();
const names = ["P&L", "Сценарии", "План-факт", "Данные"];
const [pnl, cases, actuals, data] = names.map((name) =>
  wb.worksheets.add(name),
);
const colors = {
  brown: "#33211D",
  tan: "#DA9F5B",
  pale: "#FFF6E9",
  ink: "#272320",
  blue: "#165ABA",
  green: "#18734D",
  line: "#D9CBBE",
  muted: "#70645D",
};
const money = '#,##0.00;(#,##0.00);"—"';
const value = (s, cell, value) => {
  s.getRange(cell).values = [[value]];
};
const formula = (s, cell, expression) => {
  s.getRange(cell).formulas = [[expression]];
};
function styleSheet(s, lastCol, lastRow) {
  s.showGridLines = false;
  const used = s.getRange(`B2:${lastCol}${lastRow}`);
  used.format.font = { name: "Arial", size: 10, color: colors.ink };
  used.format.rowHeight = 23;
  used.format.verticalAlignment = "center";
  s.getRange(`A1:A${lastRow}`).format.columnWidth = 3;
  s.getRange(`B2:B${lastRow}`).format.columnWidth = 43;
  s.getRange(`C2:${lastCol}${lastRow}`).format.columnWidth = 20;
  s.getRange(`B2:${lastCol}2`).format.rowHeight = 31;
  s.getRange("B2").format.font = {
    name: "Arial",
    size: 15,
    bold: true,
    color: colors.brown,
  };
  s.getRange(`B3:${lastCol}3`).format.borders = {
    bottom: { style: "thin", color: colors.tan },
  };
}
function heading(s, range) {
  s.getRange(range).format.fill = colors.brown;
  s.getRange(range).format.font = {
    name: "Arial",
    size: 10,
    bold: true,
    color: "#FFFFFF",
  };
  s.getRange(range).format.horizontalAlignment = "center";
  s.getRange(range).format.rowHeight = 29;
}
function input(s, range, format = money) {
  const target = s.getRange(range);
  target.format.fill = colors.pale;
  target.format.font = { name: "Arial", size: 10, color: colors.blue };
  target.setNumberFormat(format);
}
function numericValidation(
  s,
  range,
  minimum = 0,
  maximum = 1e9,
  type = "decimal",
) {
  s.getRange(range).dataValidation = {
    rule: { type, operator: "between", formula1: minimum, formula2: maximum },
  };
}
function link(s, cell, expression, format = money) {
  formula(s, cell, expression);
  s.getRange(cell).format.font = {
    name: "Arial",
    size: 10,
    color: colors.green,
  };
  s.getRange(cell).setNumberFormat(format);
}
function total(s, row, lastCol = "F") {
  const range = s.getRange(`B${row}:${lastCol}${row}`);
  range.format.fill = colors.pale;
  range.format.font = {
    name: "Arial",
    size: 10,
    bold: true,
    color: colors.brown,
  };
  range.format.borders = { top: { style: "thin", color: colors.line } };
}
styleSheet(pnl, "F", 37);
styleSheet(cases, "E", 37);
styleSheet(actuals, "K", 27);
styleSheet(data, "J", 43);
pnl.tabColor = colors.brown;
cases.tabColor = colors.tan;

// Sources, user assumptions and the menu own all editable business inputs.
value(data, "B2", "Данные кофейной точки");
value(
  data,
  "B4",
  "Синие значения на светлом фоне можно менять. Зелёные — связи между листами.",
);
data.getRange("B4:J4").merge();
for (const [row, label, val] of [
  [5, "Рынок", "KG"],
  [6, "Валюта", "KGS"],
  [7, "Первый месяц плана", new Date(Date.UTC(2026, 10, 1))],
]) {
  value(data, `B${row}`, label);
  value(data, `C${row}`, val);
  input(data, `C${row}`, row === 7 ? "mmm yyyy" : "@");
}
value(data, "B9", "Цены и потери");
heading(data, "B9:C9");
for (const [row, label, val] of [
  [11, "Зерно, цена за кг", 1899],
  [12, "Молоко, цена за л", 100],
  [13, "Сироп, цена за л", 600],
  [14, "Потери ингредиентов", 0.05],
  [15, "Комиссии с выручки", 0.02],
  [16, "Заданный налог с оборота", 0],
]) {
  value(data, `B${row}`, label);
  value(data, `C${row}`, val);
  input(data, `C${row}`, row >= 14 ? "0.0%" : money);
  numericValidation(data, `C${row}`, 0, row === 14 ? 0.9 : row >= 15 ? 1 : 1e9);
}
value(data, "E11", "Источник: собственные данные пользователя.");
value(data, "E12", "Одна валюта во всём файле; обменные курсы не применяются.");
value(data, "E14", "Комиссии и налог — доли выручки.");
value(data, "E15", "Налоговый режим автоматически не определяется.");
value(data, "B18", "Меню: первая строка перенесена из калькулятора");
data.getRange("B18:J18").merge();
data.getRange("B20:J20").values = [
  [
    "Напиток",
    "Цена",
    "Чашек / день",
    "Зерно, г",
    "Молоко, мл",
    "Сироп, мл",
    "Упаковка",
    "Прочее / чашку",
    "Себестоимость",
  ],
];
heading(data, "B20:J20");
data.getRange("B20:J20").format.wrapText = true;
data.getRange("B20:J20").format.rowHeight = 40;
data.getRange("B21:I26").values = Array.from({ length: 6 }, (_, i) =>
  i === 0
    ? ["Мой напиток", 180, 50, 18, 160, 0, 8, 2]
    : ["", 0, 0, 0, 0, 0, 0, 0],
);
input(data, "B21:B26", "@");
input(data, "C21:I26");
data.getRange("D21:G26").setNumberFormat("#,##0.0");
numericValidation(data, "C21:I26");
numericValidation(data, "D21:D26", 0, 10000, "whole");
numericValidation(data, "E21:E26", 0, 100);
numericValidation(data, "F21:F26", 0, 1000);
numericValidation(data, "G21:G26", 0, 200);
for (let row = 21; row <= 26; row++) {
  formula(
    data,
    `J${row}`,
    `=(($C$11*E${row}+$C$12*F${row}+$C$13*G${row})/1000)/(1-$C$14)+H${row}+I${row}`,
  );
  data.getRange(`J${row}`).setNumberFormat(money);
}
value(
  data,
  "B28",
  "Чтобы добавить напиток, заполните пустую строку и задайте продажи в день.",
);
data.getRange("B28:J28").merge();
value(data, "B30", "Ежемесячные расходы");
heading(data, "B30:C30");
for (const [row, label, val] of [
  [31, "Аренда", 20000],
  [32, "Персонал", 25000],
  [33, "Коммунальные услуги", 3000],
  [34, "Прочие постоянные", 2000],
  [35, "Амортизация", 0],
  [36, "Проценты по займам", 0],
]) {
  value(data, `B${row}`, label);
  value(data, `C${row}`, val);
  input(data, `C${row}`);
  numericValidation(data, `C${row}`);
}
value(data, "E31", "Коэффициент постоянных расходов влияет на строки 31–34.");
value(
  data,
  "E32",
  "Амортизация и проценты задаются отдельно и не масштабируются.",
);
value(
  data,
  "B39",
  "Покупка оборудования и погашение тела кредита не относятся к расходам P&L.",
);
value(
  data,
  "B40",
  "Амортизацию, проценты и все применимые расходы укажите самостоятельно.",
);
value(
  data,
  "B41",
  "Суммы — плановые; налоги на прибыль и НДС отдельно не моделируются.",
);
for (const row of [39, 40, 41]) data.getRange(`B${row}:J${row}`).merge();
data.freezePanes.freezeRows(20);
data.getRange("B21:B26").format.columnWidth = 25;
data.getRange("C20:J26").format.columnWidth = 15;
data.getRange("B2:B43").format.columnWidth = 43;

// Exactly one scenario selector and one live forecast build.
value(cases, "B2", "Сценарии на 3 месяца");
value(cases, "B5", "Выбранный сценарий");
value(cases, "C5", "Базовый");
input(cases, "C5", "@");
cases.getRange("C5").dataValidation = {
  rule: { type: "list", values: ["Базовый", "Осторожный", "Оптимистичный"] },
};
for (const [index, col] of ["C", "D", "E"].entries())
  link(
    cases,
    `${col}7`,
    index === 0 ? "='Данные'!$C$7" : `=EDATE(C7,${index})`,
    "mmm yyyy",
  );
heading(cases, "B7:E7");
value(cases, "B9", "Рабочих дней");
cases.getRange("C9:E9").values = [[26, 26, 26]];
input(cases, "C9:E9", "0");
numericValidation(cases, "C9:E9", 1, 31, "whole");
const groups = [
  { active: 12, first: 13, label: "Объём продаж" },
  { active: 18, first: 19, label: "Цены напитков" },
  { active: 24, first: 25, label: "Себестоимость ингредиентов и упаковки" },
  { active: 30, first: 31, label: "Постоянные расходы" },
];
for (const g of groups) {
  value(cases, `B${g.active}`, `${g.label}: активный коэффициент`);
  cases.getRange(`B${g.active}:E${g.active}`).format.fill = colors.pale;
  cases.getRange(`B${g.active}:E${g.active}`).format.font = {
    name: "Arial",
    size: 10,
    bold: true,
    color: colors.ink,
  };
  ["Базовый", "Осторожный", "Оптимистичный"].forEach((label, i) =>
    value(cases, `B${g.first + i}`, label),
  );
  cases.getRange(`C${g.first}:E${g.first + 2}`).values = [
    [1, 1, 1],
    [1, 1, 1],
    [1, 1, 1],
  ];
  input(cases, `C${g.first}:E${g.first + 2}`, '0.00" ×"');
  numericValidation(cases, `C${g.first}:E${g.first + 2}`, 0, 100);
  for (const col of ["C", "D", "E"]) {
    const lookup = `INDEX(${col}${g.first}:${col}${g.first + 2},MATCH($C$5,$B$${g.first}:$B$${g.first + 2},0))`;
    formula(
      cases,
      `${col}${g.active}`,
      `=IF(ISNUMBER(${lookup}),${lookup},NA())`,
    );
    cases.getRange(`${col}${g.active}`).setNumberFormat('0.00" ×"');
  }
}
value(
  cases,
  "B35",
  "Все коэффициенты изначально равны 1. Задайте собственные предположения.",
);
value(cases, "B36", "1 = без изменений; 0,8 = на 20% ниже; 1,2 = на 20% выше.");
for (const row of [35, 36]) cases.getRange(`B${row}:E${row}`).merge();
cases.getRange("B12:B33").format.wrapText = true;
cases.getRange("B12:B12").format.rowHeight = 38;
cases.getRange("B24:B24").format.rowHeight = 38;
cases.getRange("B30:B30").format.rowHeight = 38;
cases.freezePanes.freezeRows(7);

// One auditable P&L build; ratios aggregate from corresponding totals.
value(pnl, "B2", "P&L кофейной точки");
value(pnl, "B4", "Валюта");
link(pnl, "C4", "='Данные'!C6", "@");
value(pnl, "D4", "Сценарий");
link(pnl, "E4", "='Сценарии'!C5", "@");
value(
  pnl,
  "B5",
  "План на 3 месяца. Доходы и расходы указаны положительными суммами.",
);
pnl.getRange("B5:F5").merge();
value(pnl, "B7", "Показатель");
value(pnl, "F7", "Итого за 3 месяца");
for (const col of ["C", "D", "E"])
  formula(pnl, `${col}7`, `='Сценарии'!${col}7`);
pnl.getRange("C7:E7").setNumberFormat("mmm yyyy");
heading(pnl, "B7:F7");
const labels = {
  9: "Продано чашек",
  10: "Выручка",
  12: "Себестоимость продаж",
  13: "Валовая прибыль",
  14: "Валовая рентабельность",
  16: "Комиссии с выручки",
  17: "Заданный налог с оборота",
  18: "Маржинальный доход после удержаний",
  20: "Аренда",
  21: "Персонал",
  22: "Коммунальные услуги",
  23: "Прочие постоянные расходы",
  24: "Результат до амортизации и процентов",
  25: "Амортизация",
  26: "Операционная прибыль",
  27: "Проценты по займам",
  29: "Результат после указанных расходов",
  30: "Рентабельность результата",
};
for (const [row, label] of Object.entries(labels)) value(pnl, `B${row}`, label);
for (const col of ["C", "D", "E"]) {
  const calc = {
    9: `SUM('Данные'!$D$21:$D$26)*'Сценарии'!${col}9*'Сценарии'!${col}12`,
    10: `SUMPRODUCT('Данные'!$C$21:$C$26,'Данные'!$D$21:$D$26)*'Сценарии'!${col}9*'Сценарии'!${col}12*'Сценарии'!${col}18`,
    12: `SUMPRODUCT('Данные'!$J$21:$J$26,'Данные'!$D$21:$D$26)*'Сценарии'!${col}9*'Сценарии'!${col}12*'Сценарии'!${col}24`,
    13: `${col}10-${col}12`,
    14: `IF(${col}10=0,"",${col}13/${col}10)`,
    16: `${col}10*'Данные'!$C$15`,
    17: `${col}10*'Данные'!$C$16`,
    18: `${col}13-SUM(${col}16:${col}17)`,
    20: `'Данные'!$C$31*'Сценарии'!${col}30`,
    21: `'Данные'!$C$32*'Сценарии'!${col}30`,
    22: `'Данные'!$C$33*'Сценарии'!${col}30`,
    23: `'Данные'!$C$34*'Сценарии'!${col}30`,
    24: `${col}18-SUM(${col}20:${col}23)`,
    25: "'Данные'!$C$35",
    26: `${col}24-${col}25`,
    27: "'Данные'!$C$36",
    29: `${col}26-${col}27`,
    30: `IF(${col}10=0,"",${col}29/${col}10)`,
  };
  for (const [row, expr] of Object.entries(calc))
    formula(pnl, `${col}${row}`, `=${expr}`);
}
for (const row of Object.keys(labels).map(Number))
  formula(
    pnl,
    `F${row}`,
    row === 14
      ? '=IF(F10=0,"",F13/F10)'
      : row === 30
        ? '=IF(F10=0,"",F29/F10)'
        : `=SUM(C${row}:E${row})`,
  );
pnl.getRange("C9:F30").setNumberFormat(money);
pnl.getRange("C9:F9").setNumberFormat("#,##0.0");
for (const row of [14, 30]) {
  pnl.getRange(`C${row}:F${row}`).setNumberFormat("0.0%");
  pnl.getRange(`B${row}:F${row}`).format.font = {
    name: "Arial",
    size: 10,
    italic: true,
    color: colors.muted,
  };
}
for (const row of [10, 13, 18, 24, 26, 29]) total(pnl, row);
pnl
  .getRange("C29:F29")
  .conditionalFormats.add("cellIs", {
    operator: "lessThan",
    formula: 0,
    format: { font: { color: "#B42318" }, fill: "#FEF3F2" },
  });
value(
  pnl,
  "B33",
  "Налог с оборота учитывается по введённой ставке. Налог на прибыль и НДС отдельно не рассчитаны.",
);
value(
  pnl,
  "B34",
  "Результат не является денежным остатком: вложения, тело кредита и оборотный капитал здесь не отражены.",
);
value(
  pnl,
  "B36",
  "Начните с листа «Данные», затем настройте месяцы и коэффициенты на листе «Сценарии».",
);
for (const row of [33, 34, 36]) {
  pnl.getRange(`B${row}:F${row}`).merge();
  pnl.getRange(`B${row}:F${row}`).format.wrapText = true;
  pnl.getRange(`B${row}:F${row}`).format.rowHeight = 34;
}

// Actual input remains blank until supplied; zero is a valid actual.
value(actuals, "B2", "План и факт за 3 месяца");
value(actuals, "B4", "Сценарий плана");
link(actuals, "C4", "='Сценарии'!C5", "@");
value(
  actuals,
  "B5",
  "Введите все 10 строк факта за месяц, включая явные нули. Отклонение = факт − план.",
);
actuals.getRange("B5:K5").merge();
value(actuals, "B7", "Показатель");
const actualRows = {
  10: ["Выручка", 10],
  11: ["Себестоимость продаж", 12],
  12: ["Комиссии с выручки", 16],
  13: ["Налог с оборота", 17],
  14: ["Аренда", 20],
  15: ["Персонал", 21],
  16: ["Коммунальные услуги", 22],
  17: ["Прочие постоянные", 23],
  18: ["Амортизация", 25],
  19: ["Проценты по займам", 27],
  21: ["Результат", 29],
};
for (const [row, [label]] of Object.entries(actualRows))
  value(actuals, `B${row}`, label);
for (const [index, [plan, actual, variance]] of [
  ["C", "D", "E"],
  ["F", "G", "H"],
  ["I", "J", "K"],
].entries()) {
  const month = ["C", "D", "E"][index];
  formula(actuals, `${plan}7`, `='P&L'!${month}7`);
  actuals.getRange(`${plan}7`).setNumberFormat("mmm yyyy");
  value(actuals, `${plan}8`, "План");
  value(actuals, `${actual}8`, "Факт");
  value(actuals, `${variance}8`, "Отклонение");
  for (const [row, [, sourceRow]] of Object.entries(actualRows)) {
    link(actuals, `${plan}${row}`, `='P&L'!${month}${sourceRow}`);
    formula(
      actuals,
      `${variance}${row}`,
      `=IF(ISNUMBER(${actual}${row}),${actual}${row}-${plan}${row},"")`,
    );
  }
  input(actuals, `${actual}10:${actual}19`);
  numericValidation(actuals, `${actual}10:${actual}19`);
  formula(
    actuals,
    `${actual}21`,
    `=IF(COUNT(${actual}10:${actual}19)=10,${actual}10-SUM(${actual}11:${actual}19),"")`,
  );
  formula(
    actuals,
    `${actual}23`,
    `=IF(COUNT(${actual}10:${actual}19)=10,"Факт заполнен","Не заполнено строк: "&(10-COUNT(${actual}10:${actual}19)))`,
  );
}
heading(actuals, "B7:K8");
actuals.getRange("C10:K21").setNumberFormat(money);
total(actuals, 21, "K");
value(
  actuals,
  "B25",
  "Положительное отклонение расходов означает перерасход; выручки и результата — превышение плана.",
);
actuals.getRange("B25:K25").merge();
actuals.getRange("C7:K25").format.columnWidth = 16;
actuals.freezePanes.freezeRows(8);

// Verify financial reconciliation and edit-driven dependencies before export.
wb.recalculate();
const get = (s, cell) => s.getRange(cell).values[0][0];
const expectedProduction =
  ((1899 * 18) / 1000 + (100 * 160) / 1000) / (1 - 0.05) + 8 + 2;
const expectedProfit =
  (180 - expectedProduction - 180 * 0.02) * 50 * 26 - 50000;
assert.ok(Math.abs(get(pnl, "C29") - expectedProfit) < 1e-7);
assert.ok(Math.abs(get(pnl, "F29") - expectedProfit * 3) < 1e-7);
assert.equal(get(actuals, "D21"), "");
actuals.getRange("D10:D19").values = Array.from({ length: 10 }, () => [0]);
assert.equal(get(actuals, "D21"), 0);
actuals.getRange("D10:D19").clear({ applyTo: "contents" });
value(cases, "C5", "Оптимистичный");
value(cases, "E15", 1.5);
assert.ok(Math.abs(get(pnl, "E10") - 180 * 50 * 26 * 1.5) < 1e-7);
assert.equal(get(pnl, "C10"), 180 * 50 * 26);
value(cases, "C5", "Базовый");
value(cases, "E15", 1);
// Missing unselected assumptions must not block the selected valid case.
cases.getRange("C14").clear({ applyTo: "contents" });
assert.equal(get(pnl, "C10"), 180 * 50 * 26);
value(cases, "C5", "Осторожный");
assert.equal(get(cases, "C12"), "#N/A");
value(cases, "C14", 1);
value(cases, "C5", "Базовый");
wb.recalculate();
const errors = await wb.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!",
  options: { useRegex: true, maxResults: 30 },
  summary: "final formula scan",
});
console.log(errors.ndjson);
console.log(
  (
    await wb.inspect({
      kind: "region",
      sheetId: "P&L",
      range: "B24:F30",
      maxChars: 2500,
      tableMaxRows: 7,
      tableMaxCols: 5,
    })
  ).ndjson,
);
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.mkdir(previewDir, { recursive: true });
for (const [sheetName, range] of [
  ["P&L", "B2:F37"],
  ["Сценарии", "B2:E37"],
  ["План-факт", "B2:K27"],
  ["Данные", "B2:J43"],
]) {
  const image = await wb.render({
    sheetName,
    range,
    scale: 1.5,
    format: "png",
  });
  await fs.writeFile(
    path.join(previewDir, `${sheetName.replace("&", "and")}.png`),
    new Uint8Array(await image.arrayBuffer()),
  );
}
await (await SpreadsheetFile.exportXlsx(wb)).save(output);
// ExcelJS cannot read prefixed SpreadsheetML tags emitted by Artifact Tool.
// A normal read/save by a namespace-aware spreadsheet engine resolves this
// interoperability issue at authoring time; production has no Python dependency.
execFileSync(
  arguments_.python,
  [path.join(root, "scripts/workbook/normalize-template.py"), output],
  { stdio: "inherit" },
);
await fs.rm(`${output}.inspect.ndjson`, { force: true });
console.log(
  JSON.stringify({
    output,
    expectedProfit,
    verified: [
      "three months",
      "single selected build",
      "later-month factor",
      "blank and zero actuals",
      "missing selected assumption",
      "base reconciliation",
    ],
    previews: previewDir,
  }),
);
