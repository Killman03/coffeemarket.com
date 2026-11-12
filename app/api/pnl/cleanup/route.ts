import { getDeliveryRuntime } from "../../../../src/server/runtime";
import { cleanupDeliveryData } from "../../../../src/server/delivery";

export function POST(request: Request) {
  return cleanupDeliveryData(request, getDeliveryRuntime());
}
