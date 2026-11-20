import { getAdminDependencies } from "./admin/dependencies";
import { getAdminAccess } from "../src/server/admin";
import {
  getAnalyticsRepository,
  getRuntimeEnvironment,
} from "../src/server/runtime";
import { siteOriginSchema } from "../src/server/origin";

/** Composes public collection independently of the chosen admin identity adapter. */
export async function getAnalyticsDependencies() {
  const repository = getAnalyticsRepository();
  const origin = siteOriginSchema.safeParse(
    getRuntimeEnvironment()?.SITE_ORIGIN,
  );
  if (!repository || !origin.success) return null;
  const access = await getAdminAccess(await getAdminDependencies());
  return {
    repository,
    origin: origin.data,
    excluded: access === "authorized" || access === "bootstrap",
  };
}
