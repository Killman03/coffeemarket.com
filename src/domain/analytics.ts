import { z } from "zod";
import { contextSchema, marketSchema, currencySchema } from "./markets";

export const analyticsEventNames = [
  "page_view",
  "calculation_started",
  "calculation_completed",
  "market_changed",
  "scenario_saved",
  "scenario_exported",
  "sample_clicked",
  "pnl_opened",
  "telegram_clicked",
] as const;
export const analyticsEventNameSchema = z.enum(analyticsEventNames);
const label = z
  .string()
  .trim()
  .max(80)
  .regex(/^[\p{L}\p{N}_. -]*$/u);
export const attributionSchema = z
  .object({ source: label.min(1), medium: label, campaign: label })
  .strict();
export const analyticsEventSchema = z
  .object({
    version: z.literal(1),
    eventId: z.uuid(),
    sessionId: z.uuid(),
    name: analyticsEventNameSchema,
    sequence: z.number().int().min(1).max(1_000_000),
    context: contextSchema.strict(),
    attribution: attributionSchema,
  })
  .strict();
export type AnalyticsEvent = z.infer<typeof analyticsEventSchema>;
export type AnalyticsEventName = z.infer<typeof analyticsEventNameSchema>;
export type Attribution = z.infer<typeof attributionSchema>;
export const analyticsFilterSchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    market: marketSchema.optional(),
    currency: currencySchema.optional(),
    source: label.min(1).optional(),
    campaign: label.min(1).optional(),
  })
  .strict();
export type AnalyticsFilter = z.infer<typeof analyticsFilterSchema>;
const count = z.number().int().nonnegative();
const metricsSchema = z.object({
  sessions: count,
  views: count,
  engaged: count,
  completed: count,
  sampleClicks: count,
  pnlOpened: count,
  telegramClicks: count,
});
export const analyticsReportSchema = z.object({
  window: z.object({
    from: z.iso.date(),
    to: z.iso.date(),
    timeZone: z.literal("UTC"),
    generatedAt: count,
  }),
  metrics: metricsSchema,
  daily: z.array(
    z.object({
      date: z.iso.date(),
      sessions: count,
      engaged: count,
      completed: count,
    }),
  ),
  sources: z.array(
    z.object({
      source: z.string(),
      medium: z.string(),
      campaign: z.string(),
      sessions: count,
      engaged: count,
      completed: count,
      sampleClicks: count,
    }),
  ),
  markets: z.array(
    z.object({
      market: marketSchema,
      currency: currencySchema,
      sessions: count,
    }),
  ),
  requests: z.object({
    accepted: count,
    chatReceived: count,
    delivered: count,
    unattributed: count,
  }),
});
export type AnalyticsReport = z.infer<typeof analyticsReportSchema>;
export const ANALYTICS_WINDOW_DAYS = 90;
export const DAY_MS = 86_400_000;

/** Builds an inclusive UTC report period ending today.
 *
 * Args:
 *   now: Server time in Unix milliseconds.
 *   days: Number of calendar days to include, at most ninety.
 *
 * Returns:
 *   Validated report filters with ISO calendar dates.
 */
export function defaultAnalyticsFilter(now: number, days = 7): AnalyticsFilter {
  const size = z.number().int().min(1).max(ANALYTICS_WINDOW_DAYS).parse(days);
  const today = Date.parse(new Date(now).toISOString().slice(0, 10));
  return {
    from: new Date(today - (size - 1) * DAY_MS).toISOString().slice(0, 10),
    to: new Date(today).toISOString().slice(0, 10),
  };
}

/** Validates a bounded UTC window and derives a half-open SQL interval.
 *
 * Args:
 *   filter: Inclusive dates and optional initial-session attribution filters.
 *   now: Trusted server clock.
 *
 * Returns:
 *   Millisecond boundaries, or null for reversed, future or expired dates.
 */
export function analyticsInterval(
  filter: AnalyticsFilter,
  now: number,
): { start: number; end: number } | null {
  const start = Date.parse(filter.from),
    end = Date.parse(filter.to) + DAY_MS;
  const today = Date.parse(new Date(now).toISOString().slice(0, 10));
  return end > start &&
    end <= today + DAY_MS &&
    start >= today - (ANALYTICS_WINDOW_DAYS - 1) * DAY_MS
    ? { start, end }
    : null;
}
