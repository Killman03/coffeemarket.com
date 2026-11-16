import {
  requestSchema,
  CONSENT_VERSION,
  CONSENT_TEXT,
  type DeliveryRecord,
  type DeliveryRepository,
  type DeliveryState,
} from "./contracts";

type StoredRecord = {
  id: string;
  payload: string;
  expires_at: number;
  chat_id: number | null;
  user_id: number | null;
  state: DeliveryState;
  phone: string;
};
const decode = (row: StoredRecord | null): DeliveryRecord | null =>
  row
    ? {
        id: row.id,
        payload: requestSchema
          .pick({ input: true, context: true })
          .parse(JSON.parse(row.payload)),
        expiresAt: row.expires_at,
        chatId: row.chat_id,
        userId: row.user_id,
        state: row.state,
        phone: row.phone,
      }
    : null;

/** Adapts the repository port to D1 prepared statements and atomic SQL changes. */
export class D1DeliveryRepository implements DeliveryRepository {
  constructor(private readonly db: D1Database) {}

  async create(record: DeliveryRecord, rateKey: string, now: number) {
    const result = await this.db
      .prepare(
        `INSERT INTO pnl_requests (id,payload,expires_at,created_at,rate_key,state,phone,consent_text,consent_version,consented_at,analytics_session_id)
      SELECT ?,?,?,?,?, 'pending',?,?,?,?,(SELECT id FROM analytics_sessions WHERE id=?) WHERE
      (SELECT COUNT(*) FROM pnl_requests WHERE rate_key=? AND created_at>?)<5 AND
      (SELECT COUNT(*) FROM pnl_requests WHERE created_at>?)<100`,
      )
      .bind(
        record.id,
        JSON.stringify(record.payload),
        record.expiresAt,
        now,
        rateKey,
        record.phone,
        CONSENT_TEXT,
        CONSENT_VERSION,
        now,
        record.analyticsSessionId ?? null,
        rateKey,
        now - 600_000,
        now - 60_000,
      )
      .run();
    return result.meta.changes === 1;
  }

  async bind(id: string, chatId: number, userId: number, now: number) {
    // RETURNING makes checking expiry and claiming a ticket one atomic operation.
    const row = await this.db
      .prepare(
        `UPDATE pnl_requests SET chat_id=?,user_id=?
      WHERE id=? AND expires_at>? AND state='pending' AND
      (user_id IS NULL OR (user_id=? AND chat_id=?)) RETURNING *`,
      )
      .bind(chatId, userId, id, now, userId, chatId)
      .first<StoredRecord>();
    return decode(row);
  }

  async pending(chatId: number, userId: number, now: number) {
    return decode(
      await this.db
        .prepare(
          `SELECT * FROM pnl_requests WHERE chat_id=? AND user_id=?
      AND expires_at>? AND state='pending' ORDER BY created_at DESC LIMIT 1`,
        )
        .bind(chatId, userId, now)
        .first<StoredRecord>(),
    );
  }

  async claimDelivery(id: string, now: number) {
    const result = await this.db
      .prepare(
        `UPDATE pnl_requests SET state='sending'
      WHERE id=? AND state='pending' AND expires_at>?`,
      )
      .bind(id, now)
      .run();
    return result.meta.changes === 1;
  }

  async setState(id: string, state: DeliveryState) {
    await this.db
      .prepare("UPDATE pnl_requests SET state=? WHERE id=?")
      .bind(state, id)
      .run();
  }

  async claimUpdate(
    updateId: number,
    now: number,
  ): Promise<"claimed" | "busy" | "done"> {
    const inserted = await this.db
      .prepare(
        "INSERT OR IGNORE INTO pnl_updates (id,status,created_at) VALUES (?,'pending',?)",
      )
      .bind(updateId, now)
      .run();
    if (inserted.meta.changes !== 1) {
      const existing = await this.db
        .prepare("SELECT status FROM pnl_updates WHERE id=?")
        .bind(updateId)
        .first<{ status: string }>();
      if (existing?.status === "done") return "done";
    }
    const result = await this.db
      .prepare(
        "UPDATE pnl_updates SET status='processing' WHERE id=? AND status='pending'",
      )
      .bind(updateId)
      .run();
    return result.meta.changes === 1 ? "claimed" : "busy";
  }

  async finishUpdate(updateId: number, success: boolean) {
    await this.db
      .prepare("UPDATE pnl_updates SET status=? WHERE id=?")
      .bind(success ? "done" : "pending", updateId)
      .run();
  }

  async cleanup(now: number) {
    await this.db.batch([
      this.db
        .prepare("DELETE FROM pnl_requests WHERE created_at<?")
        .bind(now - 30 * 86_400_000),
      this.db
        .prepare("DELETE FROM pnl_updates WHERE created_at<?")
        .bind(now - 7 * 86_400_000),
    ]);
  }
}
