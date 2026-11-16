import { z } from "zod";
import { calculatorSchema } from "../domain/calculator";
import { contextSchema } from "../domain/markets";
import { phoneSchema } from "../domain/contact";
export { CONSENT_TEXT, CONSENT_VERSION } from "../domain/contact";

export const requestSchema = z
  .object({
    input: calculatorSchema,
    context: contextSchema,
    phone: phoneSchema,
    consent: z.literal(true),
    analyticsSessionId: z.uuid().optional(),
  })
  .strict();
export type PnlRequest = Pick<
  z.infer<typeof requestSchema>,
  "input" | "context"
>;
export type DeliveryState = "pending" | "sending" | "delivered" | "unknown";
export type DeliveryRecord = {
  id: string;
  payload: PnlRequest;
  expiresAt: number;
  chatId: number | null;
  userId: number | null;
  state: DeliveryState;
  phone: string;
  analyticsSessionId?: string;
};

/** Defines persistent, atomic operations independently of the hosting provider. */
export interface DeliveryRepository {
  create(
    record: DeliveryRecord,
    rateKey: string,
    now: number,
  ): Promise<boolean>;
  bind(
    id: string,
    chatId: number,
    userId: number,
    now: number,
  ): Promise<DeliveryRecord | null>;
  pending(
    chatId: number,
    userId: number,
    now: number,
  ): Promise<DeliveryRecord | null>;
  claimDelivery(id: string, now: number): Promise<boolean>;
  setState(id: string, state: DeliveryState): Promise<void>;
  claimUpdate(
    updateId: number,
    now: number,
  ): Promise<"claimed" | "busy" | "done">;
  finishUpdate(updateId: number, success: boolean): Promise<void>;
  cleanup(now: number): Promise<void>;
}

export const telegramUpdateSchema = z.object({
  update_id: z.number().int().nonnegative(),
  business_message: z
    .object({
      business_connection_id: z.string(),
      chat: z.object({ id: z.number().int(), type: z.string() }),
      from: z
        .object({
          id: z.number().int().positive(),
          is_bot: z.boolean().optional(),
        })
        .optional(),
      text: z.string().max(4096).optional(),
    })
    .optional(),
});
export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;
