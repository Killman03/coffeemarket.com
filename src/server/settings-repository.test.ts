// @vitest-environment node
import { createSQLiteD1 } from "../test-support/d1";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createDefaultSettings } from "../application/site-settings";
import { type SiteSettings } from "../domain/site-settings";
import { D1SettingsRepository } from "./settings-repository";

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

/** Adapts real SQLite to D1's statement surface with genuine batch transactions.
 *
 * Returns:
 *   Repository and database for asserting persisted rows and rollback behavior.
 */
function setup() {
  const { db, sql } = createSQLiteD1();
  databases.push(sql);
  return { repository: new D1SettingsRepository(db), sql };
}

const now = 1_800_000_000_000;
const count = (
  sql: DatabaseSync,
  table: "site_settings" | "site_settings_audit" | "site_owner",
) => sql.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()!.count;

describe("transactional settings storage", () => {
  it("returns revision-zero defaults without persisting rows for a visit", async () => {
    const { repository, sql } = setup();
    expect(await repository.get()).toEqual({
      revision: 0,
      updatedAt: null,
      settings: createDefaultSettings(),
    });
    expect(count(sql, "site_settings")).toBe(0);
    expect(count(sql, "site_settings_audit")).toBe(0);
    expect(await repository.getOwner()).toBeNull();
  });

  it("atomically claims a single immutable owner and accepts idempotent claims", async () => {
    const { repository, sql } = setup();
    expect(
      await Promise.all([
        repository.claimOwner("owner-a", now),
        repository.claimOwner("owner-b", now),
      ]),
    ).toEqual([true, false]);
    expect(await repository.claimOwner("owner-a", now + 1)).toBe(true);
    expect(await repository.getOwner()).toEqual({ subject: "owner-a" });
    expect(count(sql, "site_owner")).toBe(1);
    expect(() =>
      sql
        .prepare(
          "INSERT INTO site_owner (id,subject,created_at) VALUES (2,'other',?)",
        )
        .run(now),
    ).toThrow();
  });

  it("saves a validated first revision and only audit metadata", async () => {
    const { repository, sql } = setup();
    const settings = createDefaultSettings();
    settings.content.calculatorTitle = "Новое название";
    expect(await repository.save(settings, 0, "owner", now)).toEqual({
      revision: 1,
      updatedAt: now,
      settings,
    });
    const audit = sql.prepare("SELECT * FROM site_settings_audit").get()!;
    expect(audit).toMatchObject({
      revision: 1,
      actor: "owner",
      created_at: now,
      changed_sections: '["content"]',
    });
    expect(Object.keys(audit).sort()).toEqual([
      "actor",
      "changed_sections",
      "created_at",
      "id",
      "revision",
    ]);
    expect(audit.id).toBe(
      sql.prepare("SELECT write_id FROM site_settings").get()!.write_id,
    );
    expect(await repository.get()).toEqual({
      revision: 1,
      updatedAt: now,
      settings,
    });
  });

  it("allows only one racing first creation and does not audit the loser", async () => {
    const { repository, sql } = setup();
    const first = createDefaultSettings();
    const second = createDefaultSettings();
    first.content.calculatorTitle = "Первый";
    second.content.calculatorTitle = "Второй";
    const writes = await Promise.all([
      repository.save(first, 0, "owner", now),
      repository.save(second, 0, "owner", now),
    ]);
    expect(writes.filter(Boolean)).toHaveLength(1);
    expect(writes.filter((value) => value === null)).toHaveLength(1);
    expect(count(sql, "site_settings_audit")).toBe(1);
    expect((await repository.get()).revision).toBe(1);
  });

  it("compares revisions atomically when two editors update the same document", async () => {
    const { repository, sql } = setup();
    await repository.save(createDefaultSettings(), 0, "owner", now);
    const first = createDefaultSettings();
    const second = createDefaultSettings();
    first.content.pnlTitle = "Редактор один";
    second.content.pnlTitle = "Редактор два";
    const writes = await Promise.all([
      repository.save(first, 1, "owner", now + 1),
      repository.save(second, 1, "owner", now + 2),
    ]);
    expect(writes.filter(Boolean)).toHaveLength(1);
    expect((await repository.get()).revision).toBe(2);
    expect(count(sql, "site_settings_audit")).toBe(2);
    expect(await repository.save(second, 1, "owner", now + 3)).toBeNull();
    expect(count(sql, "site_settings_audit")).toBe(2);
  });

  it("rolls back the settings write when its audit insert fails", async () => {
    const { repository, sql } = setup();
    sql.exec("DROP TABLE site_settings_audit");
    await expect(
      repository.save(createDefaultSettings(), 0, "owner", now),
    ).rejects.toThrow();
    expect(count(sql, "site_settings")).toBe(0);
  });

  it("validates untrusted input before performing writes", async () => {
    const { repository, sql } = setup();
    await expect(
      repository.save(
        { ...createDefaultSettings(), botToken: "forbidden" } as SiteSettings,
        0,
        "owner",
        now,
      ),
    ).rejects.toThrow();
    await expect(
      repository.save(createDefaultSettings(), -1, "owner", now),
    ).rejects.toThrow();
    await expect(repository.claimOwner("", now)).rejects.toThrow();
    expect(count(sql, "site_settings")).toBe(0);
    expect(count(sql, "site_settings_audit")).toBe(0);
    expect(count(sql, "site_owner")).toBe(0);
  });

  it("fails closed on corrupt stored JSON instead of exposing fallback settings", async () => {
    const { repository, sql } = setup();
    await repository.save(createDefaultSettings(), 0, "owner", now);
    sql
      .prepare("UPDATE site_settings SET payload=? WHERE id=1")
      .run("{invalid");
    await expect(repository.get()).rejects.toThrow();
    await expect(
      repository.save(createDefaultSettings(), 1, "owner", now + 1),
    ).rejects.toThrow();
    expect(count(sql, "site_settings_audit")).toBe(1);
  });
});
