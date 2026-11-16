import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

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

export const siteSettings = sqliteTable(
  "site_settings",
  {
    id: integer("id").primaryKey(),
    payload: text("payload").notNull(),
    revision: integer("revision").notNull(),
    updatedAt: integer("updated_at").notNull(),
    updatedBy: text("updated_by").notNull(),
    writeId: text("write_id").notNull(),
  },
  (table) => [
    check("site_settings_singleton", sql`${table.id}=1`),
    check("site_settings_revision_positive", sql`${table.revision}>0`),
    uniqueIndex("site_settings_write_id").on(table.writeId),
  ],
);

export const siteSettingsAudit = sqliteTable(
  "site_settings_audit",
  {
    id: text("id").primaryKey(),
    revision: integer("revision").notNull(),
    actor: text("actor").notNull(),
    createdAt: integer("created_at").notNull(),
    changedSections: text("changed_sections").notNull(),
  },
  (table) => [
    uniqueIndex("site_settings_audit_revision").on(table.revision),
    index("site_settings_audit_created").on(table.createdAt),
  ],
);

export const siteOwner = sqliteTable(
  "site_owner",
  {
    id: integer("id").primaryKey(),
    subject: text("subject").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [check("site_owner_singleton", sql`${table.id}=1`)],
);
