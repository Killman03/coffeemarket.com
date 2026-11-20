import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import * as schema from "../../../db/postgres/schema";

export type PostgresDatabase = NodePgDatabase<typeof schema>;

/** Creates one bounded pool owned by the Node.js application lifecycle.
 *
 * Args:
 *   config: Validated connection settings; credentials never enter client code.
 *
 * Returns:
 *   Typed Drizzle database and its pool for readiness and graceful shutdown.
 */
export function createPostgresDatabase(config: PoolConfig) {
  const pool = new Pool({
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 10_000,
    lock_timeout: 5_000,
    application_name: "coffee-market-calculator",
    ...config,
  });
  pool.on("error", () => console.error("PostgreSQL idle connection failed"));
  return { pool, db: drizzle({ client: pool, schema }) };
}
