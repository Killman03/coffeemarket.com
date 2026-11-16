import { getDeliveryRuntime } from "../../../../src/server/runtime";
import { json } from "../../../../src/server/http";
export async function GET() {
  try {
    return json({ ready: (await getDeliveryRuntime()) !== null });
  } catch {
    return json({ ready: false }, 503);
  }
}
