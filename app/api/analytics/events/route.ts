import { getAnalyticsDependencies } from "../../../analytics-dependencies";
import { collectAnalytics } from "../../../../src/server/analytics";
import { json } from "../../../../src/server/http";

export async function POST(request: Request) {
  try {
    return collectAnalytics(request, await getAnalyticsDependencies());
  } catch {
    return json({ error: "Statistics unavailable" }, 503);
  }
}
