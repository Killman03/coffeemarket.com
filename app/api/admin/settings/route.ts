import { getAdminDependencies } from "../../../admin/dependencies";
import { handleAdminSettings } from "../../../../src/server/admin";
import { json } from "../../../../src/server/http";

async function handle(request: Request) {
  try {
    return await handleAdminSettings(request, await getAdminDependencies());
  } catch {
    return json({ error: "Панель временно недоступна." }, 503);
  }
}
export const GET = handle;
export const PUT = handle;
