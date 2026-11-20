import { z } from "zod";
import { createDefaultSettings } from "../application/site-settings";
import {
  siteSettingsSchema,
  type SiteSettings,
  type SettingsEnvelope,
} from "../domain/site-settings";
export type { SettingsEnvelope } from "../domain/site-settings";
export type { SettingsRepository } from "./settings-contracts";
import {
  type SettingsRepository,
  settingsWriteSchema,
  changedSettingsSections,
} from "./settings-contracts";
import { subjectSchema, timestampSchema } from "./storage-values";
const storedSettingsSchema = z.object({
  payload: z.string(),
  revision: z.number().int().positive(),
  updated_at: timestampSchema,
});
const decodeSettings = (raw: unknown): SettingsEnvelope => {
  const row = storedSettingsSchema.parse(raw);
  return {
    revision: row.revision,
    updatedAt: row.updated_at,
    settings: siteSettingsSchema.parse(JSON.parse(row.payload)),
  };
};

/** Persists settings using singleton rows and transactional compare-and-set writes. */
export class D1SettingsRepository implements SettingsRepository {
  constructor(private readonly db: D1Database) {}

  /** Loads stored settings, failing closed if stored data is invalid.
   *
   * Returns:
   *   Persisted revision or revision zero defaults when no row exists.
   */
  async get(): Promise<SettingsEnvelope> {
    const row = await this.db
      .prepare(
        "SELECT payload,revision,updated_at FROM site_settings WHERE id=1",
      )
      .first();
    return row === null
      ? { revision: 0, updatedAt: null, settings: createDefaultSettings() }
      : decodeSettings(row);
  }

  /** Returns the immutable owner subject without accepting public identity hints. */
  async getOwner(): Promise<{ subject: string } | null> {
    const row = await this.db
      .prepare("SELECT subject FROM site_owner WHERE id=1")
      .first();
    return row === null
      ? null
      : z.object({ subject: subjectSchema }).parse(row);
  }

  /** Claims the singleton owner after the caller has verified bootstrap authority.
   *
   * Args:
   *   subject: Server-verified authentication subject.
   *   now: Server timestamp in Unix milliseconds.
   *
   * Returns:
   *   Whether this subject owns the singleton after the atomic claim.
   */
  async claimOwner(subject: string, now: number): Promise<boolean> {
    const owner = subjectSchema.parse(subject);
    const timestamp = timestampSchema.parse(now);
    const results = await this.db.batch([
      this.db
        .prepare(
          "INSERT OR IGNORE INTO site_owner (id,subject,created_at) VALUES (1,?,?)",
        )
        .bind(owner, timestamp),
      this.db.prepare("SELECT subject FROM site_owner WHERE id=1").bind(),
    ]);
    const row = z
      .object({ subject: subjectSchema })
      .parse(results[1].results[0]);
    return row.subject === owner;
  }

  /** Saves one revision and its audit metadata in the same transaction.
   *
   * Args:
   *   settings: Complete settings document, validated before any write.
   *   expectedRevision: Revision displayed to the editor; zero means first save.
   *   actor: Server-verified subject performing the change.
   *   now: Server timestamp in Unix milliseconds.
   *
   * Returns:
   *   Committed settings or null when another editor changed the revision.
   */
  async save(
    settings: SiteSettings,
    expectedRevision: number,
    actor: string,
    now: number,
  ): Promise<SettingsEnvelope | null> {
    const {
      settings: validated,
      expectedRevision: expected,
      actor: subject,
      now: timestamp,
    } = settingsWriteSchema.parse({ settings, expectedRevision, actor, now });
    const previous = await this.get();
    if (previous.revision !== expected) return null;
    const sections = changedSettingsSections(previous.settings, validated);
    const writeId = crypto.randomUUID();
    const payload = JSON.stringify(validated);
    const mutation =
      expected === 0
        ? this.db
            .prepare(
              "INSERT OR IGNORE INTO site_settings (id,payload,revision,updated_at,updated_by,write_id) VALUES (1,?,1,?,?,?)",
            )
            .bind(payload, timestamp, subject, writeId)
        : this.db
            .prepare(
              "UPDATE site_settings SET payload=?,revision=revision+1,updated_at=?,updated_by=?,write_id=? WHERE id=1 AND revision=?",
            )
            .bind(payload, timestamp, subject, writeId, expected);
    const results = await this.db.batch([
      mutation,
      this.db
        .prepare(
          `INSERT INTO site_settings_audit (id,revision,actor,created_at,changed_sections)
        SELECT ?,revision,?,?,? FROM site_settings WHERE id=1 AND write_id=?`,
        )
        .bind(writeId, subject, timestamp, JSON.stringify(sections), writeId),
      this.db
        .prepare(
          "SELECT payload,revision,updated_at FROM site_settings WHERE id=1 AND write_id=?",
        )
        .bind(writeId),
    ]);
    const row = results[2].results[0];
    return row ? decodeSettings(row) : null;
  }
}
