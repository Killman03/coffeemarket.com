import {
  analyticsEventSchema,
  analyticsInterval,
  DAY_MS,
  ANALYTICS_WINDOW_DAYS,
  type AnalyticsEvent,
  type AnalyticsFilter,
  type AnalyticsReport,
} from "../domain/analytics";
import type { AnalyticsRepository } from "./analytics-contracts";
import { assembleAnalyticsReport } from "./analytics-report";

/** Stores bounded first-party events and aggregates reports inside the database. */
export class D1AnalyticsRepository implements AnalyticsRepository {
  constructor(private readonly db: D1Database) {}

  /** Atomically records an event once without extending activity on retries.
   *
   * Args:
   *   event: Allowlisted, versioned browser event without arbitrary metadata.
   *   now: Trusted receive time; browser clocks never determine reporting dates.
   *
   * Returns:
   *   Accepted, duplicate, or limited by storage protection quotas.
   */
  async ingest(
    event: AnalyticsEvent,
    now: number,
  ): Promise<"accepted" | "duplicate" | "limited"> {
    const value = analyticsEventSchema.parse(event),
      writeId = crypto.randomUUID();
    const results = await this.db.batch([
      this.db
        .prepare(
          `INSERT OR IGNORE INTO analytics_sessions (id,started_at,last_seen_at,source,medium,campaign,market,currency)
        SELECT ?,?,?,?,?,?,?,? WHERE ?='page_view' AND
        (SELECT COUNT(*) FROM analytics_sessions WHERE started_at>?)<100 AND
        (SELECT COUNT(*) FROM analytics_events WHERE created_at>?)<600 AND
        NOT EXISTS (SELECT 1 FROM analytics_events WHERE id=?)`,
        )
        .bind(
          value.sessionId,
          now,
          now,
          value.attribution.source,
          value.attribution.medium,
          value.attribution.campaign,
          value.context.market,
          value.context.currency,
          value.name,
          now - 60_000,
          now - 60_000,
          value.eventId,
        ),
      this.db
        .prepare(
          `INSERT OR IGNORE INTO analytics_events (id,session_id,name,sequence,market,currency,created_at,write_id)
        SELECT ?,?,?,?,?,?,?,? FROM analytics_sessions WHERE id=? AND
        (SELECT COUNT(*) FROM analytics_events WHERE session_id=?)<120 AND
        (SELECT COUNT(*) FROM analytics_events WHERE created_at>?)<600`,
        )
        .bind(
          value.eventId,
          value.sessionId,
          value.name,
          value.sequence,
          value.context.market,
          value.context.currency,
          now,
          writeId,
          value.sessionId,
          value.sessionId,
          now - 60_000,
        ),
      this.db
        .prepare(
          `UPDATE analytics_sessions SET last_seen_at=? WHERE id=? AND EXISTS
        (SELECT 1 FROM analytics_events WHERE id=? AND write_id=?)`,
        )
        .bind(now, value.sessionId, value.eventId, writeId),
    ]);
    if (results[1].meta.changes === 1) return "accepted";
    return (await this.db
      .prepare("SELECT id FROM analytics_events WHERE id=?")
      .bind(value.eventId)
      .first())
      ? "duplicate"
      : "limited";
  }

  /** Removes a bounded batch of expired sessions and their cascading events.
   *
   * Args:
   *   now: Trusted clock; cleanup is independent of Telegram configuration.
   */
  async cleanup(now: number): Promise<void> {
    const today = Date.parse(new Date(now).toISOString().slice(0, 10));
    await this.db
      .prepare(
        "DELETE FROM analytics_sessions WHERE id IN (SELECT id FROM analytics_sessions WHERE started_at<? ORDER BY started_at LIMIT 25)",
      )
      .bind(today - (ANALYTICS_WINDOW_DAYS - 1) * DAY_MS)
      .run();
  }

  /** Reads a consistent, UTC cohort report with confirmed operational counters.
   *
   * Args:
   *   filter: Inclusive UTC dates and initial-session filters.
   *   now: Trusted report generation time.
   *
   * Returns:
   *   Aggregated statistics only; individual sessions and contacts stay private.
   */
  async report(filter: AnalyticsFilter, now: number): Promise<AnalyticsReport> {
    const interval = analyticsInterval(filter, now);
    if (!interval) throw new Error("Invalid report interval");
    const conditions: string[] = [],
      values: (string | number)[] = [];
    for (const field of ["market", "currency", "source", "campaign"] as const)
      if (filter[field]) {
        conditions.push(`s.${field}=?`);
        values.push(filter[field]!);
      }
    const extra = conditions.length ? ` AND ${conditions.join(" AND ")}` : "";
    const cohort = `WITH cohort AS (SELECT s.* FROM analytics_sessions s WHERE s.started_at>=? AND s.started_at<?${extra}
      AND EXISTS (SELECT 1 FROM analytics_events e WHERE e.session_id=s.id AND e.name='page_view' AND e.created_at<?)),
      steps AS (SELECT s.*,SUM(CASE WHEN e.name='page_view' THEN 1 ELSE 0 END) views,
        MIN(CASE WHEN e.name='page_view' THEN e.sequence END) view_seq,
        MIN(CASE WHEN e.name='calculation_started' THEN e.sequence END) start_seq,
        MIN(CASE WHEN e.name='calculation_completed' THEN e.sequence END) complete_seq,
        MAX(CASE WHEN e.name='sample_clicked' THEN 1 ELSE 0 END) sample,
        MAX(CASE WHEN e.name='pnl_opened' THEN 1 ELSE 0 END) pnl,
        MAX(CASE WHEN e.name='telegram_clicked' THEN 1 ELSE 0 END) telegram
        FROM cohort s LEFT JOIN analytics_events e ON e.session_id=s.id AND e.created_at<? GROUP BY s.id),
      milestones AS (SELECT *,CASE WHEN start_seq>view_seq THEN 1 ELSE 0 END engaged,
        CASE WHEN complete_seq>start_seq AND start_seq>view_seq THEN 1 ELSE 0 END completed FROM steps)`;
    const bindings = [
      interval.start,
      interval.end,
      ...values,
      interval.end,
      interval.end,
    ];
    const requests = `SELECT COUNT(*) accepted,COALESCE(SUM(p.chat_id IS NOT NULL),0) chatReceived,
      COALESCE(SUM(p.state='delivered'),0) delivered,COALESCE(SUM(s.id IS NULL),0) unattributed
      FROM pnl_requests p LEFT JOIN analytics_sessions s ON s.id=p.analytics_session_id WHERE p.created_at>=? AND p.created_at<?${extra}`;
    const results = await this.db.batch([
      this.db
        .prepare(
          `${cohort} SELECT COUNT(*) sessions,COALESCE(SUM(views),0) views,COALESCE(SUM(engaged),0) engaged,COALESCE(SUM(completed),0) completed,
        COALESCE(SUM(sample),0) sampleClicks,COALESCE(SUM(pnl),0) pnlOpened,COALESCE(SUM(telegram),0) telegramClicks FROM milestones`,
        )
        .bind(...bindings),
      this.db
        .prepare(
          `${cohort} SELECT strftime('%Y-%m-%d',started_at/1000,'unixepoch') date,COUNT(*) sessions,SUM(engaged) engaged,SUM(completed) completed FROM milestones GROUP BY date ORDER BY date`,
        )
        .bind(...bindings),
      this.db
        .prepare(
          `${cohort} SELECT source,medium,campaign,COUNT(*) sessions,SUM(engaged) engaged,SUM(completed) completed,SUM(sample) sampleClicks FROM milestones GROUP BY source,medium,campaign ORDER BY sessions DESC,source,medium,campaign LIMIT 20`,
        )
        .bind(...bindings),
      this.db
        .prepare(
          `${cohort} SELECT market,currency,COUNT(*) sessions FROM milestones GROUP BY market,currency ORDER BY sessions DESC,market,currency`,
        )
        .bind(...bindings),
      this.db.prepare(requests).bind(interval.start, interval.end, ...values),
    ]);
    return assembleAnalyticsReport(filter, now, {
      metrics: results[0].results[0],
      daily: results[1].results,
      sources: results[2].results,
      markets: results[3].results,
      requests: results[4].results[0],
    });
  }
}
