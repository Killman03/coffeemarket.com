"use client";
import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  ChartNoAxesCombined,
  CheckCheck,
  ChevronRight,
  Clock3,
  FileSpreadsheet,
  Filter,
  Globe2,
  MousePointer2,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  UsersRound,
} from "lucide-react";
import {
  analyticsFilterSchema,
  analyticsInterval,
  analyticsReportSchema,
  defaultAnalyticsFilter,
  type AnalyticsFilter,
  type AnalyticsReport,
} from "../../domain/analytics";
import { markets, currencies } from "../../domain/markets";
import { AdminHeader } from "./AdminHeader";
import styles from "./AnalyticsDashboard.module.css";

const TrafficChart = lazy(() => import("./TrafficChart"));
class ReportFailure extends Error {}
const number = (value: number) => new Intl.NumberFormat("ru-RU").format(value);
const rate = (value: number, total: number) =>
  total
    ? new Intl.NumberFormat("ru-RU", {
        style: "percent",
        maximumFractionDigits: 1,
      }).format(value / total)
    : "—";
type FilterDraft = Record<
  "from" | "to" | "market" | "currency" | "source" | "campaign",
  string
>;
const draft = (filter: AnalyticsFilter): FilterDraft => ({
  market: "",
  currency: "",
  source: "",
  campaign: "",
  ...filter,
});
function parseDraft(value: FilterDraft): AnalyticsFilter {
  return analyticsFilterSchema.parse(
    Object.fromEntries(
      Object.entries(value)
        .map(([key, text]) => [
          key,
          key === "source" ? text.trim().toLowerCase() : text.trim(),
        ])
        .filter(([, text]) => text !== ""),
    ),
  );
}

/** Provides owner-only first-party reports without exposing individual records.
 *
 * Args:
 *   initial: Server-generated report or null when its read failed.
 *   initialFilter: Valid default UTC interval selected by the server.
 *   userDisplayName: Authenticated owner's display name.
 *   deliveryReady: Whether configured Telegram delivery is enabled.
 *
 * Returns:
 *   Filterable usage cohorts, acquisition breakdown and operational counters.
 */
export function AnalyticsDashboard({
  initial,
  initialFilter,
  userDisplayName,
  deliveryReady,
  authMode = "sites",
}: {
  initial: AnalyticsReport | null;
  initialFilter: AnalyticsFilter;
  userDisplayName: string;
  deliveryReady: boolean;
  authMode?: "sites" | "password";
}) {
  const [report, setReport] = useState(initial),
    [filters, setFilters] = useState<FilterDraft>(draft(initialFilter));
  const [loading, setLoading] = useState(false),
    [error, setError] = useState(
      initial ? "" : "Не удалось загрузить отчёт. Попробуйте обновить данные.",
    );
  const controller = useRef<AbortController | null>(null),
    version = useRef(0),
    applied = useRef(initialFilter);
  useEffect(
    () => () => {
      version.current += 1;
      controller.current?.abort();
    },
    [],
  );
  const serverNow = report?.window.generatedAt ?? Date.now();
  const today = defaultAnalyticsFilter(serverNow, 1).to;
  const earliest = defaultAnalyticsFilter(serverNow, 90).from;

  async function load(next: AnalyticsFilter) {
    if (!analyticsInterval(next, Date.now())) {
      setError(
        "Выберите период в пределах последних 90 дней, включая сегодня.",
      );
      return;
    }
    const current = ++version.current;
    controller.current?.abort();
    controller.current = new AbortController();
    setLoading(true);
    setError("");
    try {
      const parameters = new URLSearchParams(Object.entries(next));
      const response = await fetch(`/api/admin/analytics?${parameters}`, {
        signal: AbortSignal.any([
          controller.current.signal,
          AbortSignal.timeout(15000),
        ]),
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok)
        throw new ReportFailure(
          response.status === 401 || response.status === 403
            ? "Сессия владельца завершилась. Войдите в панель снова."
            : response.status === 400
              ? "Проверьте период и фильтры отчёта."
              : "Не удалось обновить отчёт. Последние загруженные данные остаются на экране.",
        );
      const nextReport = analyticsReportSchema.parse(await response.json());
      if (current !== version.current) return;
      applied.current = next;
      setReport(nextReport);
    } catch (cause) {
      if (current === version.current && !controller.current?.signal.aborted)
        setError(
          cause instanceof ReportFailure
            ? cause.message
            : "Не удалось загрузить отчёт. Попробуйте ещё раз.",
        );
    } finally {
      if (current === version.current) setLoading(false);
    }
  }
  function applyDraft(next: FilterDraft) {
    setFilters(next);
    try {
      void load(parseDraft(next));
    } catch {
      setError(
        "Проверьте даты и названия источника и кампании. Допустимы буквы, цифры, пробел, точка, дефис и подчёркивание.",
      );
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    applyDraft(filters);
  }
  function quick(days: number) {
    applyDraft({ ...filters, ...defaultAnalyticsFilter(Date.now(), days) });
  }
  const metrics = report?.metrics;
  const cards = metrics
    ? [
        {
          title: "Сессии",
          value: metrics.sessions,
          icon: UsersRound,
          note: "Браузерные сессии, не уникальные люди",
        },
        {
          title: "Начали работу",
          value: metrics.engaged,
          icon: SlidersHorizontal,
          note: `${rate(metrics.engaged, metrics.sessions)} от сессий`,
        },
        {
          title: "Получили результат",
          value: metrics.completed,
          icon: CheckCheck,
          note: `${rate(metrics.completed, metrics.sessions)} от сессий`,
        },
        {
          title: "Нажали на пример Excel",
          value: metrics.sampleClicks,
          icon: FileSpreadsheet,
          note: "Сессии с нажатием, не факт скачивания",
        },
      ]
    : [];
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <AdminHeader
          userDisplayName={userDisplayName}
          active="analytics"
          authMode={authMode}
        />
        <div className={styles.heading}>
          <div>
            <a href="/" className={styles.back}>
              <ArrowLeft size={14} />К калькулятору
            </a>
            <p className={styles.eyebrow}>СОБСТВЕННАЯ АНАЛИТИКА</p>
            <h1>От первого расчёта к обращению</h1>
            <p>
              Источники переходов и использование калькулятора — в одном месте.
            </p>
          </div>
          <span className={styles.private}>
            <ShieldCheck size={15} />
            Только владелец
          </span>
        </div>
        {report && metrics && (
          <div
            aria-busy={loading}
            className={loading ? styles.loading : undefined}
          >
            <div className={styles.reportBar}>
              <span>
                {new Intl.DateTimeFormat("ru-RU", {
                  timeZone: "UTC",
                  day: "numeric",
                  month: "short",
                }).format(new Date(report.window.from))}{" "}
                —{" "}
                {new Intl.DateTimeFormat("ru-RU", {
                  timeZone: "UTC",
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                }).format(new Date(report.window.to))}
              </span>
              <button
                type="button"
                disabled={loading}
                onClick={() => void load(applied.current)}
              >
                <RefreshCw size={14} />
                Обновить данные
              </button>
            </div>
            <section
              className={styles.metrics}
              aria-label="Ключевые показатели"
            >
              {cards.map(({ title, value, icon: Icon, note }) => (
                <article key={title}>
                  <div>
                    <span>{title}</span>
                    <Icon size={19} />
                  </div>
                  <strong>{number(value)}</strong>
                  <p>{note}</p>
                </article>
              ))}
            </section>
          </div>
        )}
        <form
          className={styles.filters}
          onSubmit={submit}
          aria-label="Фильтры аналитики"
        >
          <div className={styles.filterTop}>
            <span>
              <Filter size={16} />
              Период и аудитория
            </span>
            <div className={styles.quick}>
              {[7, 30, 90].map((days) => (
                <button
                  key={days}
                  type="button"
                  disabled={loading}
                  onClick={() => quick(days)}
                >
                  {days} дней
                </button>
              ))}
            </div>
          </div>
          <div className={styles.filterGrid}>
            <label>
              С даты
              <input
                name="from"
                type="date"
                value={filters.from}
                min={earliest}
                max={today}
                required
                onChange={(event) =>
                  setFilters({ ...filters, from: event.target.value })
                }
              />
            </label>
            <label>
              По дату
              <input
                name="to"
                type="date"
                value={filters.to}
                min={filters.from || earliest}
                max={today}
                required
                onChange={(event) =>
                  setFilters({ ...filters, to: event.target.value })
                }
              />
            </label>
            <label>
              Рынок при входе
              <select
                name="market"
                value={filters.market}
                onChange={(event) =>
                  setFilters({ ...filters, market: event.target.value })
                }
              >
                <option value="">Все рынки</option>
                {markets.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Валюта при входе
              <select
                name="currency"
                value={filters.currency}
                onChange={(event) =>
                  setFilters({ ...filters, currency: event.target.value })
                }
              >
                <option value="">Все валюты</option>
                {currencies.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.code}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Источник
              <input
                name="source"
                maxLength={80}
                value={filters.source}
                placeholder="Все источники"
                onChange={(event) =>
                  setFilters({ ...filters, source: event.target.value })
                }
              />
            </label>
            <label>
              Кампания
              <input
                name="campaign"
                maxLength={80}
                value={filters.campaign}
                placeholder="Все кампании"
                onChange={(event) =>
                  setFilters({ ...filters, campaign: event.target.value })
                }
              />
            </label>
          </div>
          <div className={styles.filterBottom}>
            <span>
              <Clock3 size={13} />
              Даты в UTC. Сегодняшний день ещё не завершён.
            </span>
            <button className={styles.primary} disabled={loading} type="submit">
              {loading ? "Загружаем…" : "Применить фильтры"}
              <ChevronRight size={15} />
            </button>
          </div>
        </form>
        {error && (
          <div className={styles.error} role="alert">
            {error}
            <button
              type="button"
              onClick={() => void load(applied.current)}
              disabled={loading}
            >
              Повторить
            </button>
          </div>
        )}
        {report && metrics && (
          <div
            aria-busy={loading}
            className={loading ? styles.loading : undefined}
          >
            {metrics.sessions === 0 && (
              <div className={styles.empty}>
                <ChartNoAxesCombined size={27} />
                <div>
                  <h2>Пока нет сессий за этот период</h2>
                  <p>
                    Первые данные появятся после посещений калькулятора. Ваши
                    действия в аккаунте владельца не учитываются. Также можно
                    изменить фильтры.
                  </p>
                </div>
              </div>
            )}
            <div className={styles.mainGrid}>
              <section className={styles.card}>
                <div className={styles.cardHeading}>
                  <div>
                    <h2>Использование по дням</h2>
                    <p>Сессии, начавшиеся в выбранном периоде</p>
                  </div>
                  <Globe2 size={19} />
                </div>
                <div className={styles.legend}>
                  <span>Сессии</span>
                  <span>Начали работу</span>
                  <span>Получили результат</span>
                </div>
                <Suspense
                  fallback={
                    <div className={styles.chartSkeleton}>
                      Загружаем график…
                    </div>
                  }
                >
                  <TrafficChart daily={report.daily} />
                </Suspense>
              </section>
              <section className={styles.card}>
                <div className={styles.cardHeading}>
                  <div>
                    <h2>Воронка использования</h2>
                    <p>Последовательные действия одной сессии</p>
                  </div>
                  <MousePointer2 size={19} />
                </div>
                <ol className={styles.funnel}>
                  {[
                    ["Открыли калькулятор", metrics.sessions],
                    ["Начали работу", metrics.engaged],
                    ["Получили результат", metrics.completed],
                  ].map(([name, value], index) => (
                    <li key={String(name)}>
                      <div>
                        <span>
                          <i>{index + 1}</i>
                          {name}
                        </span>
                        <strong>{number(Number(value))}</strong>
                      </div>
                      <progress
                        aria-label={String(name)}
                        value={Number(value)}
                        max={Math.max(1, metrics.sessions)}
                      />
                      <small>
                        {rate(Number(value), metrics.sessions)} от сессий
                      </small>
                    </li>
                  ))}
                </ol>
                <p className={styles.note}>
                  Начальные значения и восстановление сохранённого расчёта не
                  считаются началом работы.
                </p>
              </section>
            </div>
            <section className={styles.card}>
              <div className={styles.cardHeading}>
                <div>
                  <h2>Откуда приходят посетители</h2>
                  <p>
                    Первые источник и кампания сессии · до 20 строк по числу
                    сессий
                  </p>
                </div>
                <ArrowUpRight size={19} />
              </div>
              <div className={styles.tableScroll}>
                <table>
                  <caption className={styles.srOnly}>
                    Источники и кампании сессий
                  </caption>
                  <thead>
                    <tr>
                      <th>Источник / канал</th>
                      <th>Кампания</th>
                      <th>Сессии</th>
                      <th>Результат</th>
                      <th>Конверсия в результат</th>
                      <th>Пример Excel</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.sources.length ? (
                      report.sources.map((row) => (
                        <tr
                          key={JSON.stringify([
                            row.source,
                            row.medium,
                            row.campaign,
                          ])}
                        >
                          <td>
                            <button
                              type="button"
                              className={styles.sourceButton}
                              disabled={loading}
                              onClick={() =>
                                applyDraft({
                                  ...draft(applied.current),
                                  source: row.source,
                                })
                              }
                            >
                              {row.source === "direct"
                                ? "Прямой переход"
                                : row.source}
                            </button>
                            <small>{row.medium || "Канал не указан"}</small>
                          </td>
                          <td>{row.campaign || "Без кампании"}</td>
                          <td>{number(row.sessions)}</td>
                          <td>{number(row.completed)}</td>
                          <td>{rate(row.completed, row.sessions)}</td>
                          <td>{number(row.sampleClicks)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6} className={styles.noRows}>
                          Источники появятся вместе с первыми сессиями
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
            <div className={styles.secondaryGrid}>
              <section className={styles.card}>
                <div className={styles.cardHeading}>
                  <div>
                    <h2>Рынки и валюты</h2>
                    <p>Контекст при первом открытии сессии</p>
                  </div>
                  <Globe2 size={19} />
                </div>
                <div className={styles.marketRows}>
                  {report.markets.length ? (
                    report.markets.map((row) => (
                      <div key={`${row.market}:${row.currency}`}>
                        <span>
                          {
                            markets.find((item) => item.code === row.market)
                              ?.name
                          }
                          <small>{row.currency}</small>
                        </span>
                        <strong>{number(row.sessions)}</strong>
                      </div>
                    ))
                  ) : (
                    <p className={styles.note}>Данных пока нет</p>
                  )}
                </div>
              </section>
              <section className={styles.card}>
                <div className={styles.cardHeading}>
                  <div>
                    <h2>Действия с Excel</h2>
                    <p>Число сессий с каждым действием</p>
                  </div>
                  <FileSpreadsheet size={19} />
                </div>
                <div className={styles.actionRows}>
                  <div>
                    <span>Нажали на пример</span>
                    <strong>{number(metrics.sampleClicks)}</strong>
                  </div>
                  <div>
                    <span>Открыли форму заявки</span>
                    <strong>{number(metrics.pnlOpened)}</strong>
                  </div>
                  <div>
                    <span>Нажали переход в Telegram</span>
                    <strong>{number(metrics.telegramClicks)}</strong>
                  </div>
                </div>
                <p className={styles.note}>
                  Эти действия независимы. Нажатие на ссылку не подтверждает
                  скачивание файла или отправку сообщения.
                </p>
              </section>
            </div>
            <section className={styles.operations}>
              <div>
                <p className={styles.eyebrow}>ПОДТВЕРЖДЕНО СЕРВЕРОМ</p>
                <h2>Заявки и выдача файлов</h2>
                <p>
                  {deliveryReady
                    ? "Состояния заявок, созданных в выбранном периоде. Статус отправки может обновиться позже."
                    : "Telegram пока не подключён. Эти показатели начнут расти после включения реальной выдачи."}
                </p>
              </div>
              <div className={styles.operationMetrics}>
                <div>
                  <strong>{number(report.requests.accepted)}</strong>
                  <span>Заявки приняты</span>
                </div>
                <div>
                  <strong>{number(report.requests.chatReceived)}</strong>
                  <span>Сообщения получены</span>
                </div>
                <div>
                  <strong>{number(report.requests.delivered)}</strong>
                  <span>Файлы отправлены</span>
                </div>
              </div>
              <p className={styles.operationNote}>
                Заявок без связанной сессии:{" "}
                {number(report.requests.unattributed)}. При фильтрации по
                источнику, рынку или валюте они не входят в результат. Файл
                «отправлен» после подтверждения Telegram; прочтение не
                отслеживается.
              </p>
            </section>
            <details className={styles.method}>
              <summary>Как читать эти данные</summary>
              <p>
                Сессия хранится во вкладке браузера и обновляется после 30 минут
                бездействия. Это не число уникальных людей. Фильтры рынка и
                валюты относятся к первому открытию сессии; смена контекста не
                переписывает источник. Воронка учитывает последовательность
                событий и действия, полученные сервером до конца периода.
                Блокировки браузера, отказ от статистики и сетевые ошибки могут
                уменьшать счётчики. События браузера не являются подтверждением
                финансовых операций.
              </p>
              <p>
                История отчётов — до 90 дней, время UTC. Прямой переход включает
                визиты без доступного внешнего источника. UTM-метки должны
                содержать названия кампаний, а не персональные данные. Рекламные
                расходы, CAC и выручка здесь не рассчитываются.
              </p>
            </details>
            <p className={styles.footer}>
              Обновлено{" "}
              {new Intl.DateTimeFormat("ru-RU", {
                timeZone: "UTC",
                dateStyle: "short",
                timeStyle: "short",
              }).format(new Date(report.window.generatedAt))}{" "}
              UTC · Данные хранятся на этом сайте · Django не подключён
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
