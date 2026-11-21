import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Better Auth's documented core schema. Database names are mapped explicitly in
// its Drizzle adapter; date values remain Date objects and absolute instants.
const instant = (name: string) => timestamp(name, { withTimezone: true });
export const authUser = pgTable("auth_user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: instant("created_at").notNull().defaultNow(),
  updatedAt: instant("updated_at").notNull().defaultNow(),
});
export const authSession = pgTable(
  "auth_session",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    expiresAt: instant("expires_at").notNull(),
    createdAt: instant("created_at").notNull().defaultNow(),
    updatedAt: instant("updated_at").notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
  },
  (t) => [
    index("auth_session_user").on(t.userId),
    index("auth_session_expires").on(t.expiresAt),
  ],
);
export const authAccount = pgTable(
  "auth_account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: instant("access_token_expires_at"),
    refreshTokenExpiresAt: instant("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: instant("created_at").notNull().defaultNow(),
    updatedAt: instant("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("auth_account_user").on(t.userId),
    uniqueIndex("auth_account_provider_account").on(t.providerId, t.accountId),
  ],
);
export const authVerification = pgTable(
  "auth_verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: instant("expires_at").notNull(),
    createdAt: instant("created_at").notNull().defaultNow(),
    updatedAt: instant("updated_at").notNull().defaultNow(),
  },
  (t) => [index("auth_verification_identifier").on(t.identifier)],
);
export const authRateLimit = pgTable("auth_rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});
export const authAudit = pgTable("auth_audit", {
  id: uuid("id").primaryKey(),
  subject: text("subject").notNull(),
  action: text("action")
    .$type<"owner_created" | "password_reset" | "sessions_revoked">()
    .notNull(),
  createdAt: instant("created_at").notNull().defaultNow(),
});

export const betterAuthSchema = {
  user: authUser,
  session: authSession,
  account: authAccount,
  verification: authVerification,
  rateLimit: authRateLimit,
};
