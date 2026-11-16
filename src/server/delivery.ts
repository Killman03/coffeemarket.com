import {
  requestSchema,
  telegramUpdateSchema,
  type DeliveryRepository,
  type PnlRequest,
  type TelegramUpdate,
} from "./contracts";
import { TelegramError, type TelegramGateway } from "./telegram";
import { buildManagerTelegramUrl } from "../domain/site-settings";
import { createDefaultSettings } from "../application/site-settings";
import { markets } from "../domain/markets";
import { json, readJson } from "./http";
export { json } from "./http";

export type DeliveryDependencies = {
  repository: DeliveryRepository;
  telegram: Pick<TelegramGateway, "message" | "document" | "verifyConnection">;
  managerTarget: string;
  messageTemplate?: string;
  managerUserId: number;
  businessConnectionId: string;
  webhookSecret: string;
  publicOrigin: string;
  workbook: (payload: PnlRequest) => Promise<ArrayBuffer>;
  now?: () => number;
};
export type CleanupDependencies = Pick<
  DeliveryDependencies,
  "repository" | "webhookSecret" | "now"
>;

export const unavailable = () =>
  json(
    {
      error:
        "Отправка в Telegram пока не подключена. Калькулятор доступен без регистрации.",
    },
    503,
  );

/** Hashes opaque identifiers so database access does not reveal usable tickets. */
export async function digest(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (value) => value.toString(16).padStart(2, "0"),
  ).join("");
}

async function equalSecret(provided: string | null, expected: string) {
  const [a, b] = await Promise.all([digest(provided ?? ""), digest(expected)]);
  let difference = 0;
  for (let i = 0; i < a.length; i++)
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

/** Stores explicit consent and creates a fifteen-minute manager-chat ticket. */
export async function createDeliveryRequest(
  request: Request,
  deps: DeliveryDependencies | null,
) {
  if (!deps) return unavailable();
  if (request.headers.get("origin") !== deps.publicOrigin)
    return json({ error: "Недопустимый источник запроса" }, 403);
  const parsed = requestSchema.safeParse(
    await readJson(request, 16_384).catch(() => null),
  );
  if (!parsed.success) return json({ error: "Проверьте данные расчёта" }, 400);
  try {
    const now = deps.now?.() ?? Date.now();
    await deps.repository.cleanup(now);
    const ticket = btoa(
      String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24))),
    )
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
    // CF supplies this header at the trusted edge. Other hosts must inject a trusted
    // client address or all clients share the conservative anonymous quota.
    const rateKey = await digest(
      `${deps.webhookSecret}:${request.headers.get("cf-connecting-ip") ?? "anonymous"}`,
    );
    const expiresAt = now + 15 * 60_000;
    const { input, context, phone } = parsed.data;
    const created = await deps.repository.create(
      {
        id: await digest(ticket),
        payload: { input, context },
        phone,
        expiresAt,
        chatId: null,
        userId: null,
        state: "pending",
      },
      rateKey,
      now,
    );
    if (!created)
      return json(
        { error: "Слишком много запросов. Попробуйте через 10 минут." },
        429,
      );
    const telegramUrl = buildManagerTelegramUrl(
      {
        enabled: true,
        managerUsername: deps.managerTarget.startsWith("+")
          ? ""
          : deps.managerTarget,
        managerPhone: deps.managerTarget.startsWith("+")
          ? deps.managerTarget
          : "",
        messageTemplate:
          deps.messageTemplate ??
          createDefaultSettings().telegram.messageTemplate,
      },
      {
        code: `CM_${ticket}`,
        market: markets.find((market) => market.code === context.market)!.name,
        currency: context.currency,
      },
    );
    return json({
      telegramUrl,
      expiresAt,
    });
  } catch {
    return unavailable();
  }
}

async function processUpdate(
  update: TelegramUpdate,
  deps: DeliveryDependencies,
) {
  const message = update.business_message;
  if (
    !message ||
    message.business_connection_id !== deps.businessConnectionId ||
    message.chat.type !== "private" ||
    !message.from ||
    message.from.is_bot ||
    message.from.id !== message.chat.id ||
    message.from.id === deps.managerUserId
  )
    return;
  const chatId = message.chat.id;
  const userId = message.from.id;
  const now = deps.now?.() ?? Date.now();
  // A single opaque marker identifies an explicitly submitted, short-lived request.
  // Issued links keep working after the administrator changes the surrounding copy.
  const markers = [
    ...(message.text ?? "").matchAll(
      /(?<![A-Za-z0-9_-])CM_([A-Za-z0-9_-]{32})(?![A-Za-z0-9_-])/g,
    ),
  ];
  if (markers.length !== 1) return;
  const ticket = markers[0][1];
  if (
    !(await deps.telegram.verifyConnection(
      deps.businessConnectionId,
      deps.managerUserId,
    ))
  )
    throw new Error("Business connection unavailable");
  const record = await deps.repository.bind(
    await digest(ticket),
    chatId,
    userId,
    now,
  );
  if (!record) {
    await deps.telegram.message(
      chatId,
      "Ссылка устарела или уже использована. Вернитесь в калькулятор и создайте новую заявку.",
      deps.businessConnectionId,
    );
    return;
  }
  if (!(await deps.repository.claimDelivery(record.id, now))) return;
  let bytes: ArrayBuffer;
  try {
    bytes = await deps.workbook(record.payload);
  } catch {
    await deps.repository.setState(record.id, "pending");
    throw new Error("Workbook generation unavailable");
  }
  try {
    await deps.telegram.document(chatId, bytes, deps.businessConnectionId);
  } catch (error) {
    // Bot API has no idempotency key. A timeout may mean Telegram accepted the
    // file. Never automatically send a second file after an ambiguous outcome.
    await deps.repository.setState(
      record.id,
      error instanceof TelegramError && error.confirmedRejected
        ? "pending"
        : "unknown",
    );
    if (error instanceof TelegramError && error.confirmedRejected) throw error;
    return;
  }
  await deps.repository.setState(record.id, "delivered");
}

/** Authenticates webhook requests before parsing or accessing personal data. */
export async function handleTelegramWebhook(
  request: Request,
  deps: DeliveryDependencies | null,
) {
  if (!deps) return unavailable();
  if (
    !(await equalSecret(
      request.headers.get("x-telegram-bot-api-secret-token"),
      deps.webhookSecret,
    ))
  )
    return json({ error: "Unauthorized" }, 401);
  const parsed = telegramUpdateSchema.safeParse(
    await readJson(request, 65_536).catch(() => null),
  );
  if (!parsed.success) return json({ error: "Invalid update" }, 400);
  const now = deps.now?.() ?? Date.now();
  try {
    await deps.repository.cleanup(now);
    const claim = await deps.repository.claimUpdate(parsed.data.update_id, now);
    if (claim === "done") return json({ ok: true });
    if (claim === "busy") return json({ error: "Retry later" }, 503);
    try {
      await processUpdate(parsed.data, deps);
      await deps.repository.finishUpdate(parsed.data.update_id, true);
      return json({ ok: true });
    } catch {
      await deps.repository.finishUpdate(parsed.data.update_id, false);
      return json({ error: "Delivery temporarily unavailable" }, 503);
    }
  } catch {
    return json({ error: "Delivery temporarily unavailable" }, 503);
  }
}

/** Runs retention cleanup for a trusted scheduler without returning lead data. */
export async function cleanupDeliveryData(
  request: Request,
  deps: CleanupDependencies | null,
) {
  if (!deps) return unavailable();
  if (
    !(await equalSecret(
      request.headers.get("x-telegram-bot-api-secret-token"),
      deps.webhookSecret,
    ))
  )
    return json({ error: "Unauthorized" }, 401);
  try {
    await deps.repository.cleanup(deps.now?.() ?? Date.now());
    return json({ ok: true });
  } catch {
    return json({ error: "Cleanup temporarily unavailable" }, 503);
  }
}
