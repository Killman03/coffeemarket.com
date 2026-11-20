import { and, count, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import {
  analyticsSessions,
  pnlRequests,
  pnlUpdates,
} from "../../../db/postgres/schema";
import {
  CONSENT_TEXT,
  CONSENT_VERSION,
  requestSchema,
  type DeliveryRecord,
  type DeliveryRepository,
  type DeliveryState,
} from "../contracts";
import { timestampSchema } from "../storage-values";
import type { PostgresDatabase } from "./database";

const decode = (
  row: typeof pnlRequests.$inferSelect | undefined,
): DeliveryRecord | null =>
  row
    ? {
        id: row.id,
        payload: requestSchema
          .pick({ input: true, context: true })
          .parse(row.payload),
        expiresAt: row.expiresAt,
        chatId: row.chatId,
        userId: row.userId,
        state: row.state,
        phone: row.phone,
        ...(row.analyticsSessionId
          ? { analyticsSessionId: row.analyticsSessionId }
          : {}),
      }
    : null;

/** Implements durable delivery claims and quotas using PostgreSQL transactions. */
export class PostgresDeliveryRepository implements DeliveryRepository {
  constructor(private readonly db: PostgresDatabase) {}

  /** Creates a consented ticket if both global and per-key quotas permit it.
   *
   * Args:
   *   record: Validated request with a hashed one-use ticket ID.
   *   rateKey: Server-derived quota key, never stored in analytics.
   *   now: Trusted Unix milliseconds.
   *
   * Returns:
   *   Whether the ticket was persisted; concurrent replicas share the quotas.
   */
  async create(
    record: DeliveryRecord,
    rateKey: string,
    now: number,
  ): Promise<boolean> {
    const time = timestampSchema.parse(now);
    const payload = requestSchema
      .pick({ input: true, context: true })
      .parse(record.payload);
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(21081, 2)`);
      const [perKey] = await tx
        .select({ total: count() })
        .from(pnlRequests)
        .where(
          and(
            eq(pnlRequests.rateKey, rateKey),
            gt(pnlRequests.createdAt, time - 600_000),
          ),
        );
      const [global] = await tx
        .select({ total: count() })
        .from(pnlRequests)
        .where(gt(pnlRequests.createdAt, time - 60_000));
      if (perKey.total >= 5 || global.total >= 100) return false;
      await tx.insert(pnlRequests).values({
        id: record.id,
        payload,
        expiresAt: record.expiresAt,
        createdAt: time,
        rateKey,
        state: "pending",
        phone: record.phone,
        consentText: CONSENT_TEXT,
        consentVersion: CONSENT_VERSION,
        consentedAt: time,
        analyticsSessionId: record.analyticsSessionId
          ? sql`(select ${analyticsSessions.id} from ${analyticsSessions} where ${analyticsSessions.id}=${record.analyticsSessionId})`
          : null,
      });
      return true;
    });
  }

  /** Atomically binds an unexpired ticket to only one private Telegram sender. */
  async bind(
    id: string,
    chatId: number,
    userId: number,
    now: number,
  ): Promise<DeliveryRecord | null> {
    const [row] = await this.db
      .update(pnlRequests)
      .set({ chatId, userId })
      .where(
        and(
          eq(pnlRequests.id, id),
          gt(pnlRequests.expiresAt, now),
          eq(pnlRequests.state, "pending"),
          or(
            isNull(pnlRequests.userId),
            and(eq(pnlRequests.userId, userId), eq(pnlRequests.chatId, chatId)),
          ),
        ),
      )
      .returning();
    return decode(row);
  }

  /** Reads the most recent unexpired pending ticket for the bound sender. */
  async pending(
    chatId: number,
    userId: number,
    now: number,
  ): Promise<DeliveryRecord | null> {
    const [row] = await this.db
      .select()
      .from(pnlRequests)
      .where(
        and(
          eq(pnlRequests.chatId, chatId),
          eq(pnlRequests.userId, userId),
          gt(pnlRequests.expiresAt, now),
          eq(pnlRequests.state, "pending"),
        ),
      )
      .orderBy(desc(pnlRequests.createdAt))
      .limit(1);
    return decode(row);
  }

  /** Claims one sender attempt without allowing another worker to send twice. */
  async claimDelivery(id: string, now: number): Promise<boolean> {
    const rows = await this.db
      .update(pnlRequests)
      .set({ state: "sending" })
      .where(
        and(
          eq(pnlRequests.id, id),
          eq(pnlRequests.state, "pending"),
          gt(pnlRequests.expiresAt, now),
        ),
      )
      .returning({ id: pnlRequests.id });
    return rows.length === 1;
  }

  /** Persists the delivery workflow's explicit result, including uncertainty. */
  async setState(id: string, state: DeliveryState): Promise<void> {
    await this.db
      .update(pnlRequests)
      .set({ state })
      .where(eq(pnlRequests.id, id));
  }

  /** Claims a Telegram update once while allowing explicitly failed retries. */
  async claimUpdate(
    updateId: number,
    now: number,
  ): Promise<"claimed" | "busy" | "done"> {
    const rows = await this.db
      .insert(pnlUpdates)
      .values({ id: updateId, status: "processing", createdAt: now })
      .onConflictDoUpdate({
        target: pnlUpdates.id,
        set: { status: "processing" },
        setWhere: eq(pnlUpdates.status, "pending"),
      })
      .returning({ id: pnlUpdates.id });
    if (rows.length) return "claimed";
    const [row] = await this.db
      .select({ status: pnlUpdates.status })
      .from(pnlUpdates)
      .where(eq(pnlUpdates.id, updateId));
    return row?.status === "done" ? "done" : "busy";
  }

  /** Finishes an owned attempt; completed updates cannot be reopened by retries. */
  async finishUpdate(updateId: number, success: boolean): Promise<void> {
    await this.db
      .update(pnlUpdates)
      .set({ status: success ? "done" : "pending" })
      .where(
        and(eq(pnlUpdates.id, updateId), eq(pnlUpdates.status, "processing")),
      );
  }

  /** Deletes contacts after thirty days and update IDs after seven atomically. */
  async cleanup(now: number): Promise<void> {
    const time = timestampSchema.parse(now);
    await this.db.transaction(async (tx) => {
      await tx
        .delete(pnlRequests)
        .where(lt(pnlRequests.createdAt, time - 30 * 86_400_000));
      await tx
        .delete(pnlUpdates)
        .where(lt(pnlUpdates.createdAt, time - 7 * 86_400_000));
    });
  }
}
