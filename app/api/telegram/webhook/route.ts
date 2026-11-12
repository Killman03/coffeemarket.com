import { getDeliveryRuntime } from "../../../../src/server/runtime";
import { handleTelegramWebhook } from "../../../../src/server/delivery";

export function POST(request: Request) {
  return handleTelegramWebhook(request, getDeliveryRuntime());
}
