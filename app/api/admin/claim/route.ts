import { getAdminDependencies } from "../../../admin/dependencies";
import { claimAdmin } from "../../../../src/server/admin";
import { json } from "../../../../src/server/http";

export async function POST(request: Request) {
  try {
    return await claimAdmin(request, await getAdminDependencies());
  } catch {
    return json({ error: "Панель временно недоступна." }, 503);
  }
}
