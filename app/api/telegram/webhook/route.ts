import { getDeliveryRuntime } from "../../../../src/server/runtime";
import {
  handleTelegramWebhook,
  unavailable,
} from "../../../../src/server/delivery";

export async function POST(request: Request) {
  try {
    return await handleTelegramWebhook(request, await getDeliveryRuntime());
  } catch {
    return unavailable();
  }
}
