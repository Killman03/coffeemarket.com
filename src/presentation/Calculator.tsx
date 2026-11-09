"use client";

import { useEffect, useRef, useState } from "react";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowRight,
  BookOpen,
  Calculator as CalculatorIcon,
  Check,
  ChevronDown,
  Coffee,
  Download,
  ExternalLink,
  Leaf,
  RotateCcw,
  Save,
  ShoppingBag,
  SlidersHorizontal,
  Upload,
  X,
} from "lucide-react";
import {
  calculatorSchema,
  calculate,
  type CalculatorInput,
} from "../domain/calculator";
import { pricePerKilogram, type Catalog } from "../domain/catalog";
import {
  createScenario,
  defaultInput,
  presets,
  scenarioSchema,
} from "../application/scenarios";
import { BrowserScenarioStore } from "../infrastructure/scenario-storage";
import { NumberField } from "./NumberField";
import { Results, Summary } from "./Results";
import { formatMoney } from "./format";

/** Composes presentation, validation and use cases without business formulas. */
export function Calculator({ catalog }: { catalog: Catalog }) {
  const initialProduct =
    catalog.products.find((product) => product.stock > 0) ??
    catalog.products[0];
  const initialInput = {
    ...defaultInput,
    coffeePrice: pricePerKilogram(initialProduct),
  };
  const form = useForm<CalculatorInput>({
    defaultValues: initialInput,
    resolver: zodResolver(calculatorSchema),
    mode: "onChange",
  });
  const watched = useWatch({ control: form.control });
  const validated = calculatorSchema.safeParse(watched);
  const input = validated.success ? validated.data : null;
  const result = input ? calculate(input) : null;
  const [drink, setDrink] = useState<keyof typeof presets | "custom">(
    "cappuccino",
  );
  const [productId, setProductId] = useState(String(initialProduct.id));
  const [notice, setNotice] = useState("");
  const [methodOpen, setMethodOpen] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  const selectedProduct = catalog.products.find(
    (p) => String(p.id) === productId,
  );
  const selectedPrice = selectedProduct
    ? pricePerKilogram(selectedProduct)
    : null;
  const editedPrice = selectedPrice !== watched.coffeePrice;

  useEffect(() => {
    try {
      const saved = new BrowserScenarioStore(window.localStorage).load();
      if (saved) {
        form.reset(saved.input);
        setDrink("custom");
        setProductId("custom");
        setNotice("Сохранённый расчёт восстановлен на этом устройстве.");
      }
    } catch {
      setNotice("Сохранённый расчёт недоступен. Загружены начальные значения.");
    }
  }, [form]);

  function selectDrink(key: keyof typeof presets) {
    setDrink(key);
    const preset = presets[key];
    (["dose", "milk", "syrup", "salePrice"] as const).forEach((name) =>
      form.setValue(name, preset[name], {
        shouldValidate: true,
        shouldDirty: true,
      }),
    );
    setNotice(
      `Выбран ${preset.name.toLowerCase()}. Рецептура и цена продажи — пример, их можно изменить.`,
    );
  }

  function save() {
    if (!input) {
      void form.trigger();
      setNotice("Исправьте ошибки перед сохранением.");
      return;
    }
    try {
      new BrowserScenarioStore(window.localStorage).save(input);
      setNotice("Расчёт сохранён в браузере на этом устройстве.");
    } catch {
      setNotice("Браузер не разрешил сохранение. Используйте экспорт JSON.");
    }
  }

  function download() {
    if (!input) {
      void form.trigger();
      setNotice("Исправьте ошибки перед экспортом.");
      return;
    }
    const blob = new Blob(
      [
        JSON.stringify(
          {
            ...createScenario(input),
            result,
            catalogFetchedAt: catalog.fetchedAt,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "coffee-market-calculation.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("Расчёт экспортирован в JSON. Его можно импортировать обратно.");
  }

  async function importScenario(file?: File) {
    if (!file) return;
    try {
      if (file.size > 100000) throw new Error("File too large");
      const scenario = scenarioSchema.parse(JSON.parse(await file.text()));
      form.reset(scenario.input);
      setProductId("custom");
      setDrink("custom");
      setNotice(
        "Расчёт импортирован. Чтобы оставить его на устройстве, нажмите «Сохранить».",
      );
    } catch {
      setNotice(
        "Не удалось импортировать файл. Выберите JSON, экспортированный этим калькулятором.",
      );
    }
    if (upload.current) upload.current.value = "";
  }

  return (
    <div className="app-shell">
      <a href="#calculator-form" className="skip-link">
        Перейти к расчёту
      </a>
      <aside className="sidebar">
        <a
          className="brand"
          href="https://coffeemarket.kg/"
          target="_blank"
          rel="noreferrer"
        >
          <span className="brand-icon">
            <Coffee size={25} />
          </span>
          <span>
            coffee<span className="brand-light">market</span>
            <small>КОФЕ ОБЪЕДИНЯЕТ</small>
          </span>
        </a>
        <div className="nav-label">ДЛЯ ВАШЕГО БИЗНЕСА</div>
        <nav aria-label="Основная навигация">
          <a href="#calculator-form" className="nav-link active">
            <CalculatorIcon size={18} />
            Калькулятор
          </a>
          <a
            href="https://coffeemarket.kg/catalog/"
            target="_blank"
            rel="noreferrer"
            className="nav-link"
          >
            <ShoppingBag size={18} />
            Каталог
            <ExternalLink size={13} className="nav-external" />
          </a>
          <button
            className="nav-link"
            onClick={() => {
              setMethodOpen(true);
              setTimeout(
                () =>
                  document
                    .getElementById("methodology")
                    ?.scrollIntoView({ behavior: "smooth" }),
                0,
              );
            }}
          >
            <BookOpen size={18} />
            Как считаем
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="small-bean">
            <Leaf size={26} />
          </div>
          <strong>
            Хороший кофе.
            <br />
            Понятный бизнес.
          </strong>
          <p>
            Инструменты для тех,
            <br />
            кто создаёт вкус.
          </p>
          <a
            href="https://coffeemarket.kg/contact/"
            target="_blank"
            rel="noreferrer"
          >
            Связаться с нами <ArrowRight size={15} />
          </a>
          <div className="sidebar-country">Бишкек, Кыргызстан · KGS</div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span>
            Инструменты <span className="breadcrumb-slash">/</span>{" "}
            <strong>Экономика кофейни</strong>
          </span>
          <a href="https://coffeemarket.kg/" target="_blank" rel="noreferrer">
            coffeemarket.kg <ExternalLink size={13} />
          </a>
        </header>
        <main>
          <section className="intro">
            <div>
              <div className="eyebrow">
                <span /> COFFEE MARKET · КАЛЬКУЛЯТОР
              </div>
              <h1>
                Считайте прибыль.
                <br />
                <span>Варите с удовольствием.</span>
              </h1>
              <p>
                Узнайте, сколько стоит ваша чашка кофе
                <br className="desktop-break" /> и сколько она может принести
                бизнесу.
              </p>
              <div className="intro-tags">
                <span>
                  <Check size={13} /> Все суммы в сомах
                </span>
                <span>
                  <Check size={13} /> Мгновенный расчёт
                </span>
              </div>
            </div>
            <div className="cup-art" aria-hidden="true">
              <span className="orbit orbit-one" />
              <span className="orbit orbit-two" />
              <div className="steam s1" />
              <div className="steam s2" />
              <div className="steam s3" />
              <div className="coffee-cup">
                <div className="coffee-surface">
                  <Leaf size={32} />
                </div>
                <span className="cup-handle" />
                <span className="cup-mark">cm.</span>
              </div>
              <div className="saucer" />
              <span className="art-label">Каждая чашка имеет значение.</span>
            </div>
          </section>
          <Summary result={result} />
          <div className="workspace-heading">
            <div>
              <h2>Ваш рецепт прибыльности</h2>
              <p>Меняйте параметры — результат пересчитывается сразу.</p>
            </div>
            <div className="toolbar">
              <button
                className="icon-button"
                onClick={() => {
                  form.reset(initialInput);
                  setProductId(String(initialProduct.id));
                  setDrink("cappuccino");
                  setNotice(
                    "Начальные значения восстановлены. Сохранённый расчёт изменится после нажатия «Сохранить».",
                  );
                }}
                title="Сбросить параметры"
                aria-label="Сбросить параметры"
              >
                <RotateCcw size={17} />
              </button>
              <button className="secondary-button" onClick={download}>
                <Download size={15} />
                <span>Экспорт</span>
              </button>
              <button className="primary-button" onClick={save}>
                <Save size={15} />
                <span>Сохранить</span>
              </button>
            </div>
          </div>
          {notice && (
            <div className="notice" role="status">
              <span>{notice}</span>
              <button
                onClick={() => setNotice("")}
                aria-label="Закрыть уведомление"
              >
                <X size={15} />
              </button>
            </div>
          )}
          <div className="calculator-layout">
            <FormProvider {...form}>
              <form
                id="calculator-form"
                noValidate
                onSubmit={form.handleSubmit(save)}
                className="form-column"
              >
                <section className="panel">
                  <div className="step-heading">
                    <span className="step-number">01</span>
                    <div>
                      <h2>Выберите напиток</h2>
                      <p>Начните с рецепта и настройте под себя</p>
                    </div>
                    <Coffee size={20} />
                  </div>
                  <div
                    className="drink-tabs"
                    role="group"
                    aria-label="Рецепты напитков"
                  >
                    {Object.entries(presets).map(([key, p]) => (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={drink === key}
                        className={drink === key ? "selected" : ""}
                        onClick={() => selectDrink(key as keyof typeof presets)}
                      >
                        <Coffee size={20} />
                        <strong>{p.name}</strong>
                        <span>{p.volume}</span>
                      </button>
                    ))}
                  </div>
                  <div className="demo-note">
                    Рецепты и цены продажи — примеры. Все параметры можно
                    изменить.
                  </div>
                </section>
                <section className="panel">
                  <div className="step-heading">
                    <span className="step-number">02</span>
                    <div>
                      <h2>Состав и себестоимость</h2>
                      <p>Сырьё, упаковка и расход на одну порцию</p>
                    </div>
                    <Leaf size={20} />
                  </div>
                  <div className="catalog-field">
                    <label htmlFor="coffee-product">
                      Кофе из каталога Coffee Market
                    </label>
                    <div className="select-wrap">
                      <select
                        id="coffee-product"
                        value={productId}
                        onChange={(event) => {
                          const id = event.target.value;
                          setProductId(id);
                          const p = catalog.products.find(
                            (p) => String(p.id) === id,
                          );
                          if (p)
                            form.setValue("coffeePrice", pricePerKilogram(p), {
                              shouldValidate: true,
                              shouldDirty: true,
                            });
                        }}
                      >
                        <option value="custom">Свой кофе / ручная цена</option>
                        {catalog.products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} · {formatMoney(p.price)} сом
                            {p.stock === 0 ? " · нет в наличии" : ""}
                          </option>
                        ))}
                      </select>
                      <ChevronDown size={16} />
                    </div>
                    <div className="catalog-meta">
                      <span className="source-badge">
                        <span /> Данные CoffeeMarket MCP
                      </span>
                      <span>
                        Получены{" "}
                        {new Intl.DateTimeFormat("ru-RU", {
                          dateStyle: "short",
                          timeZone: "Asia/Bishkek",
                        }).format(new Date(catalog.fetchedAt))}
                      </span>
                    </div>
                    {selectedProduct && (
                      <div className="product-note">
                        {editedPrice
                          ? "Цена за кг изменена вручную. "
                          : `${selectedProduct.packageGrams} г · ${formatMoney(selectedProduct.price)} сом за упаковку. `}
                        {selectedProduct.stock === 0 &&
                          "Нет в наличии на дату получения. "}
                        <a
                          href={selectedProduct.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Карточка товара ↗
                        </a>
                      </div>
                    )}
                  </div>
                  <div className="field-grid">
                    <NumberField
                      name="coffeePrice"
                      label="Цена кофе"
                      unit="сом / кг"
                    />
                    <NumberField name="dose" label="Кофе на порцию" unit="г" />
                    <NumberField
                      name="milkPrice"
                      label="Цена молока"
                      unit="сом / л"
                    />
                    <NumberField
                      name="milk"
                      label="Молоко на порцию"
                      unit="мл"
                    />
                    <NumberField
                      name="syrupPrice"
                      label="Цена сиропа"
                      unit="сом / л"
                    />
                    <NumberField
                      name="syrup"
                      label="Сироп на порцию"
                      unit="мл"
                    />
                    <NumberField
                      name="packaging"
                      label="Стакан, крышка и прочее"
                      unit="сом"
                    />
                    <NumberField
                      name="otherPerCup"
                      label="Прочие расходы на чашку"
                      unit="сом"
                      hint="Вода, сахар, салфетка и т. п."
                    />
                    <NumberField
                      name="lossPercent"
                      label="Потери сырья"
                      unit="%"
                      hint="Доля закупленного сырья, которая теряется"
                    />
                  </div>
                </section>
                <section className="panel">
                  <div className="step-heading">
                    <span className="step-number">03</span>
                    <div>
                      <h2>Продажи и расходы</h2>
                      <p>Параметры вашего бизнеса</p>
                    </div>
                    <SlidersHorizontal size={20} />
                  </div>
                  <div className="field-grid">
                    <NumberField
                      name="salePrice"
                      label="Цена продажи чашки"
                      unit="сом"
                    />
                    <NumberField
                      name="cupsPerDay"
                      label="Чашек в день"
                      unit="шт."
                      integer
                    />
                    <NumberField
                      name="daysPerMonth"
                      label="Рабочих дней в месяц"
                      unit="дней"
                      integer
                    />
                    <NumberField
                      name="feePercent"
                      label="Комиссия с выручки"
                      unit="%"
                      hint="Средняя комиссия эквайринга и площадок"
                    />
                    <NumberField
                      name="turnoverTaxPercent"
                      label="Налог с выручки"
                      unit="%"
                      hint="Задайте ставку для вашей модели расчёта"
                    />
                  </div>
                  <div className="section-divider">
                    <span>ПОСТОЯННЫЕ РАСХОДЫ В МЕСЯЦ</span>
                  </div>
                  <div className="field-grid">
                    <NumberField name="rent" label="Аренда" unit="сом" />
                    <NumberField name="salaries" label="Зарплаты" unit="сом" />
                    <NumberField
                      name="utilities"
                      label="Коммунальные расходы"
                      unit="сом"
                    />
                    <NumberField
                      name="otherFixed"
                      label="Прочие постоянные"
                      unit="сом"
                      hint="Аренда техники, сервис, реклама и т. п."
                    />
                  </div>
                  <div className="assumption-note">
                    Начальные расходы и объёмы — демонстрационные. Укажите свои
                    значения, включая все применимые расходы.
                  </div>
                </section>
              </form>
            </FormProvider>
            {input && result ? (
              <Results input={input} result={result} />
            ) : (
              <aside className="panel invalid-state" role="status">
                <CalculatorIcon size={32} />
                <h2>Проверим параметры</h2>
                <p>
                  Исправьте выделенные поля, чтобы увидеть актуальный расчёт.
                </p>
              </aside>
            )}
          </div>
          <section className="methodology panel" id="methodology">
            <button
              className="method-toggle"
              aria-expanded={methodOpen}
              aria-controls="method-content"
              onClick={() => setMethodOpen(!methodOpen)}
            >
              <span>
                <BookOpen size={18} /> Прозрачный расчёт: формулы и допущения
              </span>
              <ChevronDown size={18} className={methodOpen ? "rotated" : ""} />
            </button>
            {methodOpen && (
              <div id="method-content" className="method-content">
                <div>
                  <h3>Себестоимость чашки</h3>
                  <p>
                    Стоимость кофе = цена за кг × граммы / 1 000. Молоко и сироп
                    считаются аналогично в миллилитрах. Сырьё с потерями = сумма
                    ингредиентов / (1 − доля потерь). Затем прибавляются
                    упаковка и прочие расходы на чашку.
                  </p>
                </div>
                <div>
                  <h3>Потенциальная прибыль</h3>
                  <p>
                    Объём = чашек в день × рабочих дней. Выручка = цена × объём.
                    Прибыль = выручка − все переменные расходы − постоянные
                    расходы. Комиссия и заданный налог считаются от выручки.
                    Неучтённые расходы не вычитаются автоматически.
                  </p>
                </div>
                <div>
                  <h3>Точка безубыточности</h3>
                  <p>
                    Чашек в месяц = постоянные расходы / маржинальная прибыль с
                    чашки, с округлением вверх. Чашек в день = месячный объём /
                    рабочие дни, также вверх. Если маржинальная прибыль ≤ 0,
                    точка недостижима. Расчёт предполагает продажу одного
                    выбранного напитка.
                  </p>
                </div>
                <div>
                  <h3>Источники и ограничения</h3>
                  <p>
                    Цены кофе — снимок публичного каталога CoffeeMarket через
                    MCP от{" "}
                    {new Intl.DateTimeFormat("ru-RU", {
                      dateStyle: "long",
                      timeZone: "Asia/Bishkek",
                    }).format(new Date(catalog.fetchedAt))}
                    . Они не обновляются автоматически. Фасовки сверены по
                    названиям товаров. Остальные значения — редактируемые
                    примеры. Расчёты выполняются без промежуточного округления;
                    суммы на экране округлены до 0,01 сом, поэтому строки могут
                    расходиться на 0,01 сом.
                  </p>
                </div>
              </div>
            )}
          </section>
          <div className="import-row">
            <input
              ref={upload}
              type="file"
              accept="application/json,.json"
              className="visually-hidden"
              aria-label="Файл расчёта JSON"
              onChange={(event) => void importScenario(event.target.files?.[0])}
            />
            <button onClick={() => upload.current?.click()}>
              <Upload size={14} /> Импортировать расчёт JSON
            </button>
            <span>Сохранения хранятся только в вашем браузере</span>
          </div>
          <footer>
            <span>
              © {new Date(catalog.fetchedAt).getUTCFullYear()} Coffee Market
            </span>
            <span>
              Создано для вашего следующего шага <Leaf size={13} />
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
