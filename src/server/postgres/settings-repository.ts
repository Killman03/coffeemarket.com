import { eq, and } from "drizzle-orm";
import {
  siteOwner,
  siteSettings,
  siteSettingsAudit,
} from "../../../db/postgres/schema";
import { createDefaultSettings } from "../../application/site-settings";
import {
  siteSettingsSchema,
  type SettingsEnvelope,
  type SiteSettings,
} from "../../domain/site-settings";
import {
  changedSettingsSections,
  settingsWriteSchema,
  type SettingsRepository,
} from "../settings-contracts";
import { subjectSchema, timestampSchema } from "../storage-values";
import type { PostgresDatabase } from "./database";

const decode = (row: typeof siteSettings.$inferSelect): SettingsEnvelope => ({
  settings: siteSettingsSchema.parse(row.payload),
  revision: row.revision,
  updatedAt: row.updatedAt,
});

/** Persists owner, settings and atomic revision audits in PostgreSQL. */
export class PostgresSettingsRepository implements SettingsRepository {
  constructor(private readonly db: PostgresDatabase) {}

  /** Returns validated persisted settings or non-persisted initial defaults. */
  async get(): Promise<SettingsEnvelope> {
    const [row] = await this.db
      .select()
      .from(siteSettings)
      .where(eq(siteSettings.id, 1));
    return row
      ? decode(row)
      : { settings: createDefaultSettings(), revision: 0, updatedAt: null };
  }

  /** Reads the pinned authentication subject without accepting identity hints. */
  async getOwner(): Promise<{ subject: string } | null> {
    const [row] = await this.db
      .select({ subject: siteOwner.subject })
      .from(siteOwner)
      .where(eq(siteOwner.id, 1));
    return row ? { subject: subjectSchema.parse(row.subject) } : null;
  }

  /** Claims one immutable owner; concurrent different claimants cannot replace it.
   *
   * Args:
   *   subject: Subject already verified by the identity provider.
   *   now: Trusted Unix milliseconds.
   *
   * Returns:
   *   Whether the supplied subject owns the singleton after this claim.
   */
  async claimOwner(subject: string, now: number): Promise<boolean> {
    const value = subjectSchema.parse(subject);
    const createdAt = timestampSchema.parse(now);
    return this.db.transaction(async (tx) => {
      await tx
        .insert(siteOwner)
        .values({ id: 1, subject: value, createdAt })
        .onConflictDoNothing();
      const [owner] = await tx
        .select()
        .from(siteOwner)
        .where(eq(siteOwner.id, 1));
      return owner?.subject === value;
    });
  }

  /** Commits a settings revision and its audit together, rejecting stale editors.
   *
   * Args:
   *   settings: Complete settings document.
   *   expectedRevision: Revision read by the editor; zero for initial creation.
   *   actor: Server-verified authentication subject.
   *   now: Trusted Unix milliseconds.
   *
   * Returns:
   *   New envelope, or null if another editor won the compare-and-set.
   */
  async save(
    settings: SiteSettings,
    expectedRevision: number,
    actor: string,
    now: number,
  ): Promise<SettingsEnvelope | null> {
    const value = settingsWriteSchema.parse({
      settings,
      expectedRevision,
      actor,
      now,
    });
    return this.db.transaction(async (tx) => {
      const [previous] = await tx
        .select()
        .from(siteSettings)
        .where(eq(siteSettings.id, 1))
        .for("update");
      if ((previous?.revision ?? 0) !== value.expectedRevision) return null;
      const before = previous
        ? decode(previous).settings
        : createDefaultSettings();
      const next = {
        id: 1,
        payload: value.settings,
        revision: value.expectedRevision + 1,
        updatedAt: value.now,
        updatedBy: value.actor,
        writeId: crypto.randomUUID(),
      };
      const [saved] = previous
        ? await tx
            .update(siteSettings)
            .set(next)
            .where(
              and(
                eq(siteSettings.id, 1),
                eq(siteSettings.revision, value.expectedRevision),
              ),
            )
            .returning()
        : await tx
            .insert(siteSettings)
            .values(next)
            .onConflictDoNothing()
            .returning();
      if (!saved) return null;
      await tx
        .insert(siteSettingsAudit)
        .values({
          id: next.writeId,
          revision: next.revision,
          actor: value.actor,
          createdAt: value.now,
          changedSections: changedSettingsSections(before, value.settings),
        });
      return decode(saved);
    });
  }
}
