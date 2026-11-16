import { getAdminDependencies } from "../../../admin/dependencies";
import { getAnalyticsRepository } from "../../../../src/server/runtime";
import { readAnalyticsReport } from "../../../../src/server/analytics";
import { json } from "../../../../src/server/http";

export async function GET(request: Request) {
  try {
    return readAnalyticsReport(
      request,
      await getAdminDependencies(),
      getAnalyticsRepository(),
    );
  } catch {
    return json({ error: "Аналитика временно недоступна." }, 503);
  }
}
