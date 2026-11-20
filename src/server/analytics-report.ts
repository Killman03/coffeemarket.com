import {
  analyticsReportSchema,
  DAY_MS,
  type AnalyticsFilter,
  type AnalyticsReport,
} from "../domain/analytics";

/** Validates aggregate rows and fills absent UTC days identically for every store.
 *
 * Args:
 *   filter: Validated inclusive report filters.
 *   now: Trusted generation timestamp.
 *   rows: Aggregate results produced by one consistent database snapshot.
 *
 * Returns:
 *   Validated, provider-independent report with a continuous daily series.
 */
export function assembleAnalyticsReport(
  filter: AnalyticsFilter,
  now: number,
  rows: {
    metrics: unknown;
    daily: unknown[];
    sources: unknown[];
    markets: unknown[];
    requests: unknown;
  },
): AnalyticsReport {
  const start = Date.parse(filter.from),
    end = Date.parse(filter.to) + DAY_MS;
  const daily = new Map(
    rows.daily.map((raw) => {
      const row = analyticsReportSchema.shape.daily.element.parse(raw);
      return [row.date, row] as const;
    }),
  );
  return analyticsReportSchema.parse({
    window: {
      from: filter.from,
      to: filter.to,
      timeZone: "UTC",
      generatedAt: now,
    },
    metrics: rows.metrics,
    daily: Array.from({ length: (end - start) / DAY_MS }, (_, index) => {
      const date = new Date(start + index * DAY_MS).toISOString().slice(0, 10);
      return daily.get(date) ?? { date, sessions: 0, engaged: 0, completed: 0 };
    }),
    sources: rows.sources,
    markets: rows.markets,
    requests: rows.requests,
  });
}
