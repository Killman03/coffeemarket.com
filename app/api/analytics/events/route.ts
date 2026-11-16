import { getAdminDependencies } from "../../../admin/dependencies";
import { getAdminAccess } from "../../../../src/server/admin";
import { getAnalyticsRepository } from "../../../../src/server/runtime";
import { collectAnalytics } from "../../../../src/server/analytics";
import { json } from "../../../../src/server/http";

export async function POST(request: Request) {
  try {
    const admin = await getAdminDependencies(),
      repository = getAnalyticsRepository();
    if (!admin || !repository) return collectAnalytics(request, null);
    const access = await getAdminAccess(admin);
    return collectAnalytics(request, {
      repository,
      origin: admin.origin,
      excluded: access === "authorized" || access === "bootstrap",
    });
  } catch {
    return json({ error: "Statistics unavailable" }, 503);
  }
}
