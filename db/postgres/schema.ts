import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { PnlRequest, DeliveryState } from "../../src/server/contracts";
import type {
  SettingsSection,
  SiteSettings,
} from "../../src/domain/site-settings";

const milliseconds = (name: string) => bigint(name, { mode: "number" });

export const siteOwner = pgTable(
  "site_owner",
  {
    id: integer("id").primaryKey(),
    subject: text("subject").notNull(),
    createdAt: milliseconds("created_at").notNull(),
  },
  (t) => [check("site_owner_singleton", sql`${t.id} = 1`)],
);

export const siteSettings = pgTable(
  "site_settings",
  {
    id: integer("id").primaryKey(),
    payload: jsonb("payload").$type<SiteSettings>().notNull(),
    revision: integer("revision").notNull(),
    updatedAt: milliseconds("updated_at").notNull(),
    updatedBy: text("updated_by").notNull(),
    writeId: uuid("write_id").notNull(),
  },
  (t) => [
    check("site_settings_singleton", sql`${t.id} = 1`),
    check("site_settings_revision_positive", sql`${t.revision} > 0`),
    uniqueIndex("site_settings_write_id").on(t.writeId),
  ],
);

export const siteSettingsAudit = pgTable(
  "site_settings_audit",
  {
    id: uuid("id").primaryKey(),
    revision: integer("revision").notNull(),
    actor: text("actor").notNull(),
    createdAt: milliseconds("created_at").notNull(),
    changedSections: jsonb("changed_sections")
      .$type<SettingsSection[]>()
      .notNull(),
  },
  (t) => [
    uniqueIndex("site_settings_audit_revision").on(t.revision),
    index("site_settings_audit_created").on(t.createdAt),
  ],
);

export const analyticsSessions = pgTable(
  "analytics_sessions",
  {
    id: uuid("id").primaryKey(),
    startedAt: milliseconds("started_at").notNull(),
    lastSeenAt: milliseconds("last_seen_at").notNull(),
    source: text("source").notNull(),
    medium: text("medium").notNull(),
    campaign: text("campaign").notNull(),
    market: text("market").notNull(),
    currency: text("currency").notNull(),
  },
  (t) => [
    index("analytics_sessions_started").on(t.startedAt),
    index("analytics_sessions_source").on(t.source, t.startedAt),
  ],
);

export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: uuid("id").primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => analyticsSessions.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sequence: integer("sequence").notNull(),
    market: text("market").notNull(),
    currency: text("currency").notNull(),
    createdAt: milliseconds("created_at").notNull(),
    writeId: uuid("write_id").notNull(),
  },
  (t) => [
    index("analytics_events_created").on(t.createdAt),
    index("analytics_events_session").on(t.sessionId, t.createdAt),
    check("analytics_events_sequence_positive", sql`${t.sequence} > 0`),
  ],
);

export const pnlRequests = pgTable(
  "pnl_requests",
  {
    id: text("id").primaryKey(),
    payload: jsonb("payload").$type<PnlRequest>().notNull(),
    expiresAt: milliseconds("expires_at").notNull(),
    createdAt: milliseconds("created_at").notNull(),
    rateKey: text("rate_key").notNull(),
    chatId: bigint("chat_id", { mode: "number" }),
    userId: bigint("user_id", { mode: "number" }),
    state: text("state").$type<DeliveryState>().notNull(),
    phone: text("phone").notNull(),
    consentText: text("consent_text").notNull(),
    consentVersion: text("consent_version").notNull(),
    consentedAt: milliseconds("consented_at").notNull(),
    analyticsSessionId: uuid("analytics_session_id").references(
      () => analyticsSessions.id,
      { onDelete: "set null" },
    ),
  },
  (t) => [
    index("pnl_requests_rate").on(t.rateKey, t.createdAt),
    index("pnl_requests_created").on(t.createdAt),
    index("pnl_requests_user").on(t.chatId, t.userId, t.createdAt),
    index("pnl_requests_analytics").on(t.analyticsSessionId, t.createdAt),
    check(
      "pnl_requests_state_valid",
      sql`${t.state} IN ('pending', 'sending', 'delivered', 'unknown')`,
    ),
  ],
);

export const pnlUpdates = pgTable(
  "pnl_updates",
  {
    id: bigint("id", { mode: "number" }).primaryKey(),
    status: text("status").$type<"pending" | "processing" | "done">().notNull(),
    createdAt: milliseconds("created_at").notNull(),
  },
  (t) => [
    index("pnl_updates_created").on(t.createdAt),
    check(
      "pnl_updates_status_valid",
      sql`${t.status} IN ('pending', 'processing', 'done')`,
    ),
  ],
);
