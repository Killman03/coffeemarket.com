import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const pnlRequests = sqliteTable(
  "pnl_requests",
  {
    id: text("id").primaryKey(),
    payload: text("payload").notNull(),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
    rateKey: text("rate_key").notNull(),
    chatId: integer("chat_id"),
    userId: integer("user_id"),
    state: text("state", {
      enum: ["pending", "sending", "delivered", "unknown"],
    }).notNull(),
    phone: text("phone").notNull(),
    consentText: text("consent_text").notNull(),
    consentVersion: text("consent_version").notNull(),
    consentedAt: integer("consented_at").notNull(),
  },
  (table) => [
    index("pnl_requests_rate").on(table.rateKey, table.createdAt),
    index("pnl_requests_created").on(table.createdAt),
    index("pnl_requests_user").on(table.chatId, table.userId, table.createdAt),
  ],
);

export const pnlUpdates = sqliteTable(
  "pnl_updates",
  {
    id: integer("id").primaryKey(),
    status: text("status", {
      enum: ["pending", "processing", "done"],
    }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("pnl_updates_created").on(table.createdAt)],
);
