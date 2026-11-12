import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import { D1DeliveryRepository } from "./d1-repository";
import { TelegramGateway } from "./telegram";
import type { DeliveryDependencies } from "./delivery";
import { createPnlWorkbook } from "../infrastructure/pnl-workbook";
import { phoneSchema } from "../domain/contact";

export type DeliveryEnvironment = {
  PNL_DB?: D1Database;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_MANAGER_USERNAME?: string;
  TELEGRAM_MANAGER_PHONE?: string;
  TELEGRAM_MANAGER_USER_ID?: string;
  TELEGRAM_BUSINESS_CONNECTION_ID?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  PNL_PUBLIC_ORIGIN?: string;
};
const environments = new AsyncLocalStorage<DeliveryEnvironment>();
const configSchema = z
  .object({
    TELEGRAM_BOT_TOKEN: z.string().regex(/^[0-9]+:[A-Za-z0-9_-]{20,}$/),
    TELEGRAM_MANAGER_USERNAME: z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9_]{4,31}$/)
      .optional(),
    TELEGRAM_MANAGER_PHONE: phoneSchema.optional(),
    TELEGRAM_MANAGER_USER_ID: z.coerce.number().int().positive(),
    TELEGRAM_BUSINESS_CONNECTION_ID: z.string().min(1).max(256),
    TELEGRAM_WEBHOOK_SECRET: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/),
    PNL_PUBLIC_ORIGIN: z.url().refine((value) => {
      const url = new URL(value);
      return url.protocol === "https:" && url.origin === value;
    }),
  })
  .refine((value) =>
    Boolean(value.TELEGRAM_MANAGER_USERNAME || value.TELEGRAM_MANAGER_PHONE),
  );

/** Supplies hosting bindings within one request, never a process-global secret. */
export function runWithDeliveryRuntime<T>(
  env: DeliveryEnvironment,
  callback: () => T,
): T {
  return environments.run(env, callback);
}

/** Builds adapters only when every required production dependency is configured. */
export function getDeliveryRuntime(): DeliveryDependencies | null {
  const env = environments.getStore();
  const parsed = configSchema.safeParse(env);
  if (!parsed.success || !env?.PNL_DB) return null;
  const config = parsed.data;
  return {
    repository: new D1DeliveryRepository(env.PNL_DB),
    telegram: new TelegramGateway(config.TELEGRAM_BOT_TOKEN),
    managerTarget:
      config.TELEGRAM_MANAGER_USERNAME ?? config.TELEGRAM_MANAGER_PHONE!,
    managerUserId: config.TELEGRAM_MANAGER_USER_ID,
    businessConnectionId: config.TELEGRAM_BUSINESS_CONNECTION_ID,
    webhookSecret: config.TELEGRAM_WEBHOOK_SECRET,
    publicOrigin: config.PNL_PUBLIC_ORIGIN,
    async workbook(payload) {
      const response = await fetch(
        `${config.PNL_PUBLIC_ORIGIN}/templates/coffee-market-pnl-3-months.xlsx`,
        { signal: AbortSignal.timeout(15_000), redirect: "error" },
      );
      if (
        !response.ok ||
        Number(response.headers.get("content-length")) > 2_000_000
      )
        throw new Error("Template unavailable");
      const template = await response.arrayBuffer();
      if (template.byteLength > 2_000_000)
        throw new Error("Template too large");
      return new Uint8Array(
        await createPnlWorkbook(payload.input, payload.context, template),
      ).buffer;
    },
  };
}
