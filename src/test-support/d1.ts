import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

/** Adapts real SQLite, migrations and transactional batches to D1's test surface.
 *
 * Returns:
 *   An isolated database and adapter; the caller closes the database after use.
 */
export function createSQLiteD1() {
  const sql = new DatabaseSync(":memory:");
  sql.exec("PRAGMA foreign_keys=ON");
  const folder = new URL("../../drizzle/", import.meta.url);
  for (const file of readdirSync(folder)
    .filter((file) => file.endsWith(".sql"))
    .sort())
    sql.exec(readFileSync(new URL(file, folder), "utf8"));
  class Statement {
    private values: (string | number | null)[] = [];
    constructor(private readonly query: string) {}
    bind(...values: (string | number | null)[]) {
      this.values = values;
      return this;
    }
    async first() {
      return sql.prepare(this.query).get(...this.values) ?? null;
    }
    execute() {
      const prepared = sql.prepare(this.query);
      if (prepared.columns().length)
        return {
          results: prepared.all(...this.values),
          success: true,
          meta: { changes: 0 },
        };
      const result = prepared.run(...this.values);
      return {
        results: [],
        success: true,
        meta: { changes: Number(result.changes) },
      };
    }
    async run() {
      return this.execute();
    }
  }
  const db = {
    prepare: (query: string) => new Statement(query),
    async batch(statements: Statement[]) {
      sql.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((statement) => statement.execute());
        sql.exec("COMMIT");
        return results;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;
  return { sql, db };
}
