import { z } from "zod";
import {
  siteSettingsSchema,
  type SettingsEnvelope,
  type SettingsSection,
  type SiteSettings,
} from "../domain/site-settings";
import { subjectSchema, timestampSchema } from "./storage-values";

export interface SettingsRepository {
  get(): Promise<SettingsEnvelope>;
  getOwner(): Promise<{ subject: string } | null>;
  claimOwner(subject: string, now: number): Promise<boolean>;
  save(
    settings: SiteSettings,
    expectedRevision: number,
    actor: string,
    now: number,
  ): Promise<SettingsEnvelope | null>;
}

export const settingsWriteSchema = z.object({
  settings: siteSettingsSchema,
  expectedRevision: z.number().int().nonnegative(),
  actor: subjectSchema,
  now: timestampSchema,
});

/** Identifies changed sections without copying sensitive settings into the audit.
 *
 * Args:
 *   previous: Previously validated settings.
 *   next: New validated settings.
 *
 * Returns:
 *   Stable names of modified sections.
 */
export function changedSettingsSections(
  previous: SiteSettings,
  next: SiteSettings,
): SettingsSection[] {
  return (["telegram", "defaults", "content"] as const).filter(
    (section) =>
      JSON.stringify(previous[section]) !== JSON.stringify(next[section]),
  );
}
