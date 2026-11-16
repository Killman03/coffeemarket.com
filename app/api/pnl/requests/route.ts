import { getDeliveryRuntime } from "../../../../src/server/runtime";
import {
  createDeliveryRequest,
  unavailable,
} from "../../../../src/server/delivery";

export async function POST(request: Request) {
  try {
    return await createDeliveryRequest(request, await getDeliveryRuntime());
  } catch {
    return unavailable();
  }
}
