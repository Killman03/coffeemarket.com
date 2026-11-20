import { z } from "zod";
import { TelegramGateway } from "./telegram";
import type { DeliveryDependencies, CleanupDependencies } from "./delivery";
import { createPnlWorkbook } from "../infrastructure/pnl-workbook";
import { createDefaultSettings } from "../application/site-settings";
import type { SiteSettings } from "../domain/site-settings";
import {
  getApplicationRuntime,
  type RuntimeEnvironment,
} from "./runtime-context";
import type { SettingsRepository } from "./settings-contracts";
import type { AnalyticsRepository } from "./analytics-contracts";
const configSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().regex(/^[0-9]+:[A-Za-z0-9_-]{20,}$/),
  TELEGRAM_MANAGER_USER_ID: z.coerce.number().int().positive(),
  TELEGRAM_BUSINESS_CONNECTION_ID: z.string().min(1).max(256),
  TELEGRAM_WEBHOOK_SECRET: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/),
  PNL_PUBLIC_ORIGIN: z.url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value;
  }),
});

/** Returns the current request's bindings without retaining credentials globally. */
export function getRuntimeEnvironment(): RuntimeEnvironment | undefined {
  return getApplicationRuntime()?.environment;
}

/** Opens the settings adapter when durable storage is bound to this request. */
export function getSettingsRepository(): SettingsRepository | null {
  return getApplicationRuntime()?.settings ?? null;
}

/** Opens the analytics adapter within the current request's storage scope. */
export function getAnalyticsRepository(): AnalyticsRepository | null {
  return getApplicationRuntime()?.analytics ?? null;
}

/** Loads current settings; standalone calculator builds retain explicit defaults. */
export async function getSiteSettings(): Promise<SiteSettings> {
  const repository = getSettingsRepository();
  return repository
    ? (await repository.get()).settings
    : createDefaultSettings();
}

/** Reports server dependency readiness without exposing credential values. */
export function getDeliveryStatus(): {
  deliveryReady: boolean;
  missing: string[];
} {
  const env = getRuntimeEnvironment();
  const parsed = configSchema.safeParse(env);
  const labels: Record<string, string> = {
    TELEGRAM_BOT_TOKEN: "Токен бизнес-бота",
    TELEGRAM_MANAGER_USER_ID: "Telegram ID менеджера",
    TELEGRAM_BUSINESS_CONNECTION_ID: "Подключение Telegram Business",
    TELEGRAM_WEBHOOK_SECRET: "Секрет вебхука",
    PNL_PUBLIC_ORIGIN: "Публичный адрес для Excel",
  };
  const missing = new Set(
    parsed.success
      ? []
      : parsed.error.issues.map(
          (issue) => labels[String(issue.path[0])] ?? "Конфигурация Telegram",
        ),
  );
  if (!getApplicationRuntime()?.delivery) missing.add("База данных");
  return { deliveryReady: missing.size === 0, missing: [...missing] };
}

/** Keeps retention available even while the administrator pauses new requests. */
export function getCleanupRuntime(): CleanupDependencies | null {
  const env = getRuntimeEnvironment();
  const repository = getApplicationRuntime()?.delivery;
  const secret = z
    .string()
    .regex(/^[A-Za-z0-9_-]{32,256}$/)
    .safeParse(env?.TELEGRAM_WEBHOOK_SECRET);
  return repository && secret.success
    ? {
        repository,
        webhookSecret: secret.data,
      }
    : null;
}

/** Builds adapters from current durable settings and server-only credentials. */
export async function getDeliveryRuntime(): Promise<DeliveryDependencies | null> {
  const env = getRuntimeEnvironment();
  const repository = getApplicationRuntime()?.delivery;
  const parsed = configSchema.safeParse(env);
  if (!parsed.success || !repository) return null;
  const config = parsed.data;
  const { telegram } = await getSiteSettings();
  if (
    !telegram.enabled ||
    (!telegram.managerUsername && !telegram.managerPhone)
  )
    return null;
  return {
    repository,
    telegram: new TelegramGateway(config.TELEGRAM_BOT_TOKEN),
    managerTarget: telegram.managerUsername || telegram.managerPhone,
    messageTemplate: telegram.messageTemplate,
    managerUserId: config.TELEGRAM_MANAGER_USER_ID,
    businessConnectionId: config.TELEGRAM_BUSINESS_CONNECTION_ID,
    webhookSecret: config.TELEGRAM_WEBHOOK_SECRET,
    publicOrigin: config.PNL_PUBLIC_ORIGIN,
    clientAddress:
      getApplicationRuntime()?.platform === "sites"
        ? (request) => request.headers.get("cf-connecting-ip") ?? undefined
        : undefined,
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
