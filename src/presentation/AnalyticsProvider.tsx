"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  BrowserAnalytics,
  captureAnalyticsAttribution,
  ANALYTICS_PREFERENCE_KEY,
} from "../infrastructure/browser-analytics";
import type { AnalyticsEventName } from "../domain/analytics";
import type { MarketContext } from "../domain/markets";
import styles from "./AnalyticsPrivacy.module.css";

const empty = {
  ready: false,
  track: (_name: AnalyticsEventName, _context: MarketContext) => {},
  sessionId: (): string | undefined => undefined,
};
const AnalyticsContext = createContext(empty);
/** Returns optional tracking; embedded widgets remain untracked by default. */
export function useAnalytics() {
  return useContext(AnalyticsContext);
}

/** Supplies first-party statistics and an explicit browser-local opt-out.
 *
 * Args:
 *   enabled: Server decision excluding owners and unconfigured runtimes.
 *   children: Public site content; admin pages are never wrapped.
 *
 * Returns:
 *   A scoped tracker and plain-language data collection controls.
 */
export function AnalyticsProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  const tracker = useRef<BrowserAnalytics | null>(null);
  const [preference, setPreference] = useState<boolean | null>(null);
  const [browserOptOut, setBrowserOptOut] = useState(false);
  const [initialized, setInitialized] = useState(false);
  useEffect(() => {
    const blocked =
      navigator.doNotTrack === "1" ||
      (navigator as Navigator & { globalPrivacyControl?: boolean })
        .globalPrivacyControl === true;
    setBrowserOptOut(blocked);
    try {
      setPreference(localStorage.getItem(ANALYTICS_PREFERENCE_KEY) !== "off");
    } catch {
      setPreference(true);
    }
  }, []);
  const ready = enabled && preference === true && !browserOptOut;
  useEffect(() => {
    if (!ready) {
      setInitialized(false);
      return;
    }
    let storage: Storage | null = null;
    try {
      storage = sessionStorage;
    } catch {
      /* Ephemeral fallback. */
    }
    const controller = new AbortController();
    const current = new BrowserAnalytics(
      storage,
      captureAnalyticsAttribution(location.href, document.referrer),
      async (event) => {
        const response = await fetch("/api/analytics/events", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CoffeeMarket-Analytics": "1",
          },
          body: JSON.stringify(event),
          credentials: "same-origin",
          keepalive: true,
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(8000),
          ]),
        });
        return response.ok
          ? "accepted"
          : response.status === 429 || response.status >= 500
            ? "retry"
            : "discard";
      },
    );
    tracker.current = current;
    setInitialized(true);
    const flush = () => void current.flush();
    window.addEventListener("online", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      current.stop();
      controller.abort();
      tracker.current = null;
      window.removeEventListener("online", flush);
      window.removeEventListener("pagehide", flush);
    };
  }, [ready]);
  const track = useCallback(
    (name: AnalyticsEventName, context: MarketContext) =>
      tracker.current?.track(name, context),
    [],
  );
  const sessionId = useCallback(() => tracker.current?.sessionId(), []);
  function toggle() {
    const next = !preference;
    if (!next) tracker.current?.stop(true);
    try {
      localStorage.setItem(ANALYTICS_PREFERENCE_KEY, next ? "on" : "off");
    } catch {
      /* The current-page choice still applies. */
    }
    setPreference(next);
  }
  return (
    <AnalyticsContext.Provider
      value={{ ready: ready && initialized, track, sessionId }}
    >
      {children}
      <aside className={styles.notice} aria-label="Статистика использования">
        <details>
          <summary>Как работает статистика</summary>
          <p>
            Считаем сессии, источники переходов и действия в калькуляторе. В
            события не передаются телефон, финансовые значения, полный адрес
            страницы и рекламные click ID. Постоянный идентификатор посетителя
            не создаётся. Сессия обновляется после 30 минут бездействия. Данные
            хранятся на сервере этого сайта; внешние системы аналитики не
            подключены.
          </p>
          <p>
            Отчёты доступны за последние 90 дней. Старые записи удаляются
            порциями при новых событиях и открытии отчётов. Хостинг может вести
            собственные технические журналы.
          </p>
        </details>
        <div>
          {!enabled ? (
            <span>Посещения владельца не учитываются</span>
          ) : browserOptOut ? (
            <span>Статистика отключена настройкой браузера</span>
          ) : preference === null ? (
            <span>Проверяем настройки статистики…</span>
          ) : (
            <>
              <span>Статистика {preference ? "включена" : "отключена"}</span>
              <button type="button" onClick={toggle}>
                {preference ? "Отключить" : "Включить"}
              </button>
            </>
          )}
        </div>
      </aside>
    </AnalyticsContext.Provider>
  );
}
