import { getDeliveryRuntime } from "../../../../src/server/runtime";
import { createDeliveryRequest } from "../../../../src/server/delivery";

export function POST(request: Request) {
  return createDeliveryRequest(request, getDeliveryRuntime());
}
