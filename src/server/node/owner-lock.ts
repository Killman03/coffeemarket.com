import { sql } from "drizzle-orm";

// Same lock for credentials verified during login and operator password changes.
// This prevents a concurrent login with an old password surviving a reset.
export const ownerManagementLock = sql`select pg_advisory_xact_lock(21081, 3)`;
