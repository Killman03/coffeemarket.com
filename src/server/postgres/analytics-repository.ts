import { and, count, eq, gt, gte, inArray, lt, sql } from "drizzle-orm";
import {
  analyticsEvents,
  analyticsSessions,
  pnlRequests,
} from "../../../db/postgres/schema";
import {
  ANALYTICS_WINDOW_DAYS,
  DAY_MS,
  analyticsEventSchema,
  analyticsFilterSchema,
  analyticsInterval,
  type AnalyticsEvent,
  type AnalyticsFilter,
  type AnalyticsReport,
} from "../../domain/analytics";
import type { AnalyticsRepository } from "../analytics-contracts";
import { assembleAnalyticsReport } from "../analytics-report";
import { timestampSchema } from "../storage-values";
import type { PostgresDatabase } from "./database";

const attributionConditions = (filter: AnalyticsFilter) =>
  (["market", "currency", "source", "campaign"] as const).flatMap((field) =>
    filter[field] ? [eq(analyticsSessions[field], filter[field]!)] : [],
  );

/** Stores deduplicated observations and reads consistent PostgreSQL reports. */
export class PostgresAnalyticsRepository implements AnalyticsRepository {
  constructor(private readonly db: PostgresDatabase) {}

  /** Inserts an observation once and enforces quotas across application replicas.
   *
   * Args:
   *   event: Allowlisted observation with opaque session and event IDs.
   *   now: Trusted receive time in Unix milliseconds.
   *
   * Returns:
   *   Accepted, duplicate, or limited; retries never extend session activity.
   */
  async ingest(
    event: AnalyticsEvent,
    now: number,
  ): Promise<"accepted" | "duplicate" | "limited"> {
    const value = analyticsEventSchema.parse(event),
      time = timestampSchema.parse(now);
    return this.db.transaction(async (tx) => {
      // Acquire before quota reads: the next READ COMMITTED statement sees the
      // previous lock holder's commit, including when multiple replicas write.
      await tx.execute(sql`select pg_advisory_xact_lock(21081, 1)`);
      const [duplicate] = await tx
        .select({ id: analyticsEvents.id })
        .from(analyticsEvents)
        .where(eq(analyticsEvents.id, value.eventId));
      if (duplicate) return "duplicate";
      const [recent] = await tx
        .select({ total: count() })
        .from(analyticsEvents)
        .where(gt(analyticsEvents.createdAt, time - 60_000));
      if (recent.total >= 600) return "limited";
      const [session] = await tx
        .select()
        .from(analyticsSessions)
        .where(eq(analyticsSessions.id, value.sessionId));
      if (!session) {
        if (value.name !== "page_view") return "limited";
        const [sessions] = await tx
          .select({ total: count() })
          .from(analyticsSessions)
          .where(gt(analyticsSessions.startedAt, time - 60_000));
        if (sessions.total >= 100) return "limited";
        await tx.insert(analyticsSessions).values({
          id: value.sessionId,
          startedAt: time,
          lastSeenAt: time,
          ...value.attribution,
          ...value.context,
        });
      }
      const [sessionEvents] = await tx
        .select({ total: count() })
        .from(analyticsEvents)
        .where(eq(analyticsEvents.sessionId, value.sessionId));
      if (sessionEvents.total >= 120) return "limited";
      await tx.insert(analyticsEvents).values({
        id: value.eventId,
        sessionId: value.sessionId,
        name: value.name,
        sequence: value.sequence,
        ...value.context,
        createdAt: time,
        writeId: crypto.randomUUID(),
      });
      await tx
        .update(analyticsSessions)
        .set({
          lastSeenAt: sql`greatest(${analyticsSessions.lastSeenAt}, ${time})`,
        })
        .where(eq(analyticsSessions.id, value.sessionId));
      return "accepted";
    });
  }

  /** Removes at most twenty-five expired cohorts and their cascading events. */
  async cleanup(now: number): Promise<void> {
    const time = timestampSchema.parse(now);
    const today = Date.parse(new Date(time).toISOString().slice(0, 10));
    const expired = this.db
      .select({ id: analyticsSessions.id })
      .from(analyticsSessions)
      .where(
        lt(
          analyticsSessions.startedAt,
          today - (ANALYTICS_WINDOW_DAYS - 1) * DAY_MS,
        ),
      )
      .orderBy(analyticsSessions.startedAt)
      .limit(25);
    await this.db
      .delete(analyticsSessions)
      .where(inArray(analyticsSessions.id, expired));
  }

  /** Aggregates UTC cohorts and confirmed delivery counters in one snapshot.
   *
   * Args:
   *   filter: Inclusive dates and immutable acquisition/context filters.
   *   now: Trusted generation time.
   *
   * Returns:
   *   The same public report contract as the Sites storage adapter.
   */
  async report(filter: AnalyticsFilter, now: number): Promise<AnalyticsReport> {
    const value = analyticsFilterSchema.parse(filter);
    const time = timestampSchema.parse(now),
      interval = analyticsInterval(value, time);
    if (!interval) throw new Error("Invalid report interval");
    const scope = and(
      gte(analyticsSessions.startedAt, interval.start),
      lt(analyticsSessions.startedAt, interval.end),
      ...attributionConditions(value),
    );
    const cohort = sql`WITH cohort AS (
      SELECT * FROM ${analyticsSessions} WHERE ${scope} AND EXISTS (
        SELECT 1 FROM ${analyticsEvents} WHERE ${analyticsEvents.sessionId}=${analyticsSessions.id}
        AND ${analyticsEvents.name}='page_view' AND ${analyticsEvents.createdAt}<${interval.end}
      )
    ), steps AS (
      SELECT s.*, a.* FROM cohort s CROSS JOIN LATERAL (
        SELECT (count(*) FILTER (WHERE e.name='page_view'))::integer views,
          min(e.sequence) FILTER (WHERE e.name='page_view') view_seq,
          min(e.sequence) FILTER (WHERE e.name='calculation_started') start_seq,
          min(e.sequence) FILTER (WHERE e.name='calculation_completed') complete_seq,
          coalesce(max(CASE WHEN e.name='sample_clicked' THEN 1 ELSE 0 END),0) sample,
          coalesce(max(CASE WHEN e.name='pnl_opened' THEN 1 ELSE 0 END),0) pnl,
          coalesce(max(CASE WHEN e.name='telegram_clicked' THEN 1 ELSE 0 END),0) telegram
        FROM ${analyticsEvents} e WHERE e.session_id=s.id AND e.created_at<${interval.end}
      ) a
    ), milestones AS (
      SELECT *, CASE WHEN start_seq>view_seq THEN 1 ELSE 0 END engaged,
        CASE WHEN complete_seq>start_seq AND start_seq>view_seq THEN 1 ELSE 0 END completed FROM steps
    )`;
    return this.db.transaction(
      async (tx) => {
        const metrics =
          await tx.execute(sql`${cohort} SELECT count(*)::integer sessions,
        coalesce(sum(views),0)::integer views, coalesce(sum(engaged),0)::integer engaged,
        coalesce(sum(completed),0)::integer completed, coalesce(sum(sample),0)::integer "sampleClicks",
        coalesce(sum(pnl),0)::integer "pnlOpened", coalesce(sum(telegram),0)::integer "telegramClicks" FROM milestones`);
        const daily =
          await tx.execute(sql`${cohort} SELECT to_char(to_timestamp(started_at/1000.0) AT TIME ZONE 'UTC','YYYY-MM-DD') date,
        count(*)::integer sessions, sum(engaged)::integer engaged, sum(completed)::integer completed FROM milestones GROUP BY date ORDER BY date`);
        const sources =
          await tx.execute(sql`${cohort} SELECT source,medium,campaign,count(*)::integer sessions,
        sum(engaged)::integer engaged,sum(completed)::integer completed,sum(sample)::integer "sampleClicks"
        FROM milestones GROUP BY source,medium,campaign ORDER BY sessions DESC,source,medium,campaign LIMIT 20`);
        const markets = await tx.execute(
          sql`${cohort} SELECT market,currency,count(*)::integer sessions FROM milestones GROUP BY market,currency ORDER BY sessions DESC,market,currency`,
        );
        const requests = await tx.execute(sql`SELECT count(*)::integer accepted,
        (count(*) FILTER (WHERE ${pnlRequests.chatId} IS NOT NULL))::integer "chatReceived",
        (count(*) FILTER (WHERE ${pnlRequests.state}='delivered'))::integer delivered,
        (count(*) FILTER (WHERE ${analyticsSessions.id} IS NULL))::integer unattributed
        FROM ${pnlRequests} LEFT JOIN ${analyticsSessions} ON ${analyticsSessions.id}=${pnlRequests.analyticsSessionId}
        WHERE ${and(gte(pnlRequests.createdAt, interval.start), lt(pnlRequests.createdAt, interval.end), ...attributionConditions(value))}`);
        return assembleAnalyticsReport(value, time, {
          metrics: metrics.rows[0],
          daily: daily.rows,
          sources: sources.rows,
          markets: markets.rows,
          requests: requests.rows[0],
        });
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  }
}
