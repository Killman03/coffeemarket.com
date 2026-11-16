import { getCleanupRuntime } from "../../../../src/server/runtime";
import {
  cleanupDeliveryData,
  unavailable,
} from "../../../../src/server/delivery";

export async function POST(request: Request) {
  try {
    return await cleanupDeliveryData(request, getCleanupRuntime());
  } catch {
    return unavailable();
  }
}
