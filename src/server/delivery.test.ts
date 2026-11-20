// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  createDeliveryRequest,
  cleanupDeliveryData,
  digest,
  handleTelegramWebhook,
  type DeliveryDependencies,
} from "./delivery";
import { type DeliveryRecord, type DeliveryRepository } from "./contracts";
import { defaultInput } from "../application/scenarios";
import { TelegramError } from "./telegram";
import { z } from "zod";

/** Test-only repository; production always requires durable storage. */
class MemoryRepository implements DeliveryRepository {
  records = new Map<string, DeliveryRecord>();
  updates = new Map<number, "pending" | "processing" | "done">();
  async create(record: DeliveryRecord, _rateKey: string, _now: number) {
    this.records.set(record.id, { ...record });
    return true;
  }
  async bind(id: string, chatId: number, userId: number, now: number) {
    const record = this.records.get(id);
    if (
      !record ||
      record.expiresAt <= now ||
      record.state !== "pending" ||
      (record.userId !== null &&
        (record.userId !== userId || record.chatId !== chatId))
    )
      return null;
    record.chatId = chatId;
    record.userId = userId;
    return record;
  }
  async pending(chatId: number, userId: number, now: number) {
    return (
      [...this.records.values()].find(
        (record) =>
          record.chatId === chatId &&
          record.userId === userId &&
          record.expiresAt > now &&
          record.state === "pending",
      ) ?? null
    );
  }
  async claimDelivery(id: string, now: number) {
    const record = this.records.get(id);
    if (!record || record.state !== "pending" || record.expiresAt <= now)
      return false;
    record.state = "sending";
    return true;
  }
  async setState(id: string, state: DeliveryRecord["state"]) {
    this.records.get(id)!.state = state;
  }
  async claimUpdate(id: number): Promise<"claimed" | "busy" | "done"> {
    const current = this.updates.get(id);
    if (current === "done") return "done";
    if (current === "processing") return "busy";
    this.updates.set(id, "processing");
    return "claimed";
  }
  async finishUpdate(id: number, success: boolean) {
    this.updates.set(id, success ? "done" : "pending");
  }
  async cleanup() {}
}

function setup() {
  let now = 1_800_000_000_000;
  const repository = new MemoryRepository();
  const telegram = {
    message: vi.fn().mockResolvedValue(undefined),
    document: vi.fn().mockResolvedValue(undefined),
    verifyConnection: vi.fn().mockResolvedValue(true),
  };
  const deps: DeliveryDependencies = {
    repository,
    telegram,
    managerTarget: "coffee_manager",
    managerUserId: 99,
    businessConnectionId: "business-123",
    webhookSecret: "test-secret",
    publicOrigin: "https://example.com",
    workbook: vi.fn().mockResolvedValue(new ArrayBuffer(10)),
    now: () => now,
  };
  return {
    deps,
    repository,
    telegram,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}
const payload = {
  input: defaultInput,
  context: { market: "KG", currency: "KGS" },
  phone: "+12025550123",
  consent: true,
};
const request = (body: unknown = payload, origin = "https://example.com") =>
  new Request("https://example.com/api/pnl/requests", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
function webhook(
  ticket: string,
  updateId = 1,
  senderId = 42,
  connectionId = "business-123",
  customText?: string,
) {
  return new Request("https://example.com/api/telegram/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": "test-secret",
    },
    body: JSON.stringify({
      update_id: updateId,
      business_message: {
        business_connection_id: connectionId,
        chat: { id: senderId, type: "private" },
        from: { id: senderId, is_bot: false },
        text:
          customText ??
          `Здравствуйте! Хочу P&L на 3 месяца. Код расчёта: CM_${ticket}`,
      },
    }),
  });
}
async function create(deps: DeliveryDependencies) {
  const response = await createDeliveryRequest(request(), deps);
  expect(response.status).toBe(200);
  const result = z
    .object({ telegramUrl: z.string() })
    .parse(await response.json());
  const text = new URL(result.telegramUrl).searchParams.get("text")!;
  return text.split("CM_")[1] as string;
}

describe("manager-chat P&L delivery", () => {
  it("ignores forged edge IP headers without a trusted hosting adapter", async () => {
    const { deps, repository } = setup();
    const create = vi.spyOn(repository, "create");
    for (const address of ["192.0.2.1", "192.0.2.2"]) {
      const input = request();
      input.headers.set("cf-connecting-ip", address);
      expect((await createDeliveryRequest(input, deps)).status).toBe(200);
    }
    const expected = await digest(`${deps.webhookSecret}:anonymous`);
    expect(create.mock.calls[0][1]).toBe(expected);
    expect(create.mock.calls[1][1]).toBe(expected);
  });
  it("uses the configured template and accepts its single opaque marker after copy changes", async () => {
    const { deps, telegram } = setup();
    deps.messageTemplate =
      "Мой план: {code}. Рынок {market}, валюта {currency}.";
    const response = await createDeliveryRequest(request(), deps);
    const { telegramUrl } = (await response.json()) as { telegramUrl: string };
    const text = new URL(telegramUrl).searchParams.get("text")!;
    expect(text).toContain("Рынок Кыргызстан, валюта KGS.");
    const ticket = text.match(/CM_([A-Za-z0-9_-]{32})/)![1];
    deps.messageTemplate = "Новый шаблон {code}";
    await handleTelegramWebhook(
      webhook(ticket, 1, 42, "business-123", text),
      deps,
    );
    expect(telegram.document).toHaveBeenCalledTimes(1);
  });
  it("ignores ambiguous or malformed markers", async () => {
    const { deps, telegram } = setup();
    const ticket = await create(deps);
    for (const [index, text] of [
      `CM_${ticket} CM_${ticket}`,
      `CM_${ticket}extra`,
    ].entries())
      await handleTelegramWebhook(
        webhook(ticket, index + 1, 42, "business-123", text),
        deps,
      );
    expect(telegram.document).not.toHaveBeenCalled();
  });
  it("requires scheduler authentication and never returns retained personal data", async () => {
    const { deps, repository } = setup();
    const cleanup = vi.spyOn(repository, "cleanup");
    expect(
      (
        await cleanupDeliveryData(
          new Request("https://example.com/api/pnl/cleanup", {
            method: "POST",
          }),
          deps,
        )
      ).status,
    ).toBe(401);
    expect(cleanup).not.toHaveBeenCalled();
    const response = await cleanupDeliveryData(
      new Request("https://example.com/api/pnl/cleanup", {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
      }),
      deps,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(cleanup).toHaveBeenCalledWith(deps.now!());
  });
  it("does not collect a phone when configuration is unavailable", async () => {
    expect((await createDeliveryRequest(request(), null)).status).toBe(503);
  });
  it("validates consent, international phone, origin and request size before storage", async () => {
    const { deps, repository } = setup();
    expect(
      (
        await createDeliveryRequest(
          request({ ...payload, consent: false }),
          deps,
        )
      ).status,
    ).toBe(400);
    expect(
      (await createDeliveryRequest(request({ ...payload, phone: "123" }), deps))
        .status,
    ).toBe(400);
    expect(
      (
        await createDeliveryRequest(
          request(payload, "https://attacker.test"),
          deps,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await createDeliveryRequest(
          request({ ...payload, ignored: "a".repeat(20_000) }),
          deps,
        )
      ).status,
    ).toBe(400);
    expect(repository.records.size).toBe(0);
  });
  it("creates an opaque manager deep link without phone or scenario data", async () => {
    const { deps, repository } = setup();
    const ticket = await create(deps);
    expect(ticket).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const saved = repository.records.get(await digest(ticket))!;
    expect(saved.phone).toBe(payload.phone);
    expect(saved.payload).toEqual({
      input: defaultInput,
      context: payload.context,
    });
    expect(repository.records.has(ticket)).toBe(false);
  });
  it("requires the webhook secret before inspecting updates", async () => {
    const { deps, telegram, repository } = setup();
    expect(
      (
        await handleTelegramWebhook(
          new Request("https://example.com", { method: "POST", body: "{}" }),
          deps,
        )
      ).status,
    ).toBe(401);
    expect(telegram.verifyConnection).not.toHaveBeenCalled();
    expect(repository.updates.size).toBe(0);
  });
  it("sends one personalized workbook through the verified manager connection", async () => {
    const { deps, telegram, repository } = setup();
    const ticket = await create(deps);
    expect((await handleTelegramWebhook(webhook(ticket), deps)).status).toBe(
      200,
    );
    expect(telegram.verifyConnection).toHaveBeenCalledWith("business-123", 99);
    expect(telegram.document).toHaveBeenCalledWith(
      42,
      expect.any(ArrayBuffer),
      "business-123",
    );
    expect(repository.records.get(await digest(ticket))?.state).toBe(
      "delivered",
    );
    await handleTelegramWebhook(webhook(ticket), deps);
    expect(telegram.document).toHaveBeenCalledTimes(1);
  });
  it("ignores messages from other connections and the manager's outgoing messages", async () => {
    const { deps, telegram } = setup();
    const ticket = await create(deps);
    await handleTelegramWebhook(webhook(ticket, 1, 42, "different"), deps);
    await handleTelegramWebhook(webhook(ticket, 2, 99), deps);
    expect(telegram.document).not.toHaveBeenCalled();
    expect(telegram.verifyConnection).not.toHaveBeenCalled();
  });
  it("does not deliver through a disabled or mismatched business connection", async () => {
    const { deps, telegram } = setup();
    const ticket = await create(deps);
    telegram.verifyConnection.mockResolvedValue(false);
    expect((await handleTelegramWebhook(webhook(ticket), deps)).status).toBe(
      503,
    );
    expect(telegram.document).not.toHaveBeenCalled();
  });
  it("rejects expired tickets without generating a workbook", async () => {
    const { deps, advance, telegram } = setup();
    const ticket = await create(deps);
    advance(15 * 60_000);
    await handleTelegramWebhook(webhook(ticket), deps);
    expect(deps.workbook).not.toHaveBeenCalled();
    expect(telegram.document).not.toHaveBeenCalled();
  });
  it("binds tickets atomically to one customer", async () => {
    const { deps, repository, telegram } = setup();
    const ticket = await create(deps);
    await repository.bind(await digest(ticket), 42, 42, deps.now!());
    await handleTelegramWebhook(webhook(ticket, 1, 43), deps);
    expect(telegram.document).not.toHaveBeenCalled();
  });
  it("retries a generation failure without losing the calculation", async () => {
    const { deps, telegram } = setup();
    const ticket = await create(deps);
    vi.mocked(deps.workbook).mockRejectedValueOnce(
      new Error("template unavailable"),
    );
    expect((await handleTelegramWebhook(webhook(ticket), deps)).status).toBe(
      503,
    );
    expect((await handleTelegramWebhook(webhook(ticket), deps)).status).toBe(
      200,
    );
    expect(telegram.document).toHaveBeenCalledTimes(1);
  });
  it("retries a confirmed rejection but never auto-resends an ambiguous timeout", async () => {
    const first = setup();
    const ticket = await create(first.deps);
    first.telegram.document.mockRejectedValueOnce(new TelegramError(true));
    expect(
      (await handleTelegramWebhook(webhook(ticket), first.deps)).status,
    ).toBe(503);
    await handleTelegramWebhook(webhook(ticket), first.deps);
    expect(first.telegram.document).toHaveBeenCalledTimes(2);
    const second = setup();
    const another = await create(second.deps);
    second.telegram.document.mockRejectedValueOnce(new TelegramError(false));
    expect(
      (await handleTelegramWebhook(webhook(another), second.deps)).status,
    ).toBe(200);
    await handleTelegramWebhook(webhook(another), second.deps);
    expect(second.telegram.document).toHaveBeenCalledTimes(1);
    expect(second.repository.records.get(await digest(another))?.state).toBe(
      "unknown",
    );
  });
});
