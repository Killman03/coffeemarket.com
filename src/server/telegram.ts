import { z } from "zod";

export class TelegramError extends Error {
  constructor(readonly confirmedRejected: boolean) {
    super("Telegram delivery failed");
  }
}

/** Sends only to the private chat explicitly bound to a user's request. */
export class TelegramGateway {
  constructor(
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async call(
    method: string,
    body: BodyInit,
    headers?: HeadersInit,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(
        `https://api.telegram.org/bot${this.token}/${method}`,
        {
          method: "POST",
          body,
          headers,
          signal: AbortSignal.timeout(20_000),
        },
      );
    } catch {
      throw new TelegramError(false);
    }
    const parsed = z
      .object({ ok: z.boolean(), result: z.unknown().optional() })
      .safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new TelegramError(false);
    if (!parsed.data.ok) throw new TelegramError(true);
    if (!response.ok) throw new TelegramError(false);
    return parsed.data.result;
  }

  async verifyConnection(connectionId: string, ownerId: number) {
    const raw = await this.call(
      "getBusinessConnection",
      JSON.stringify({ business_connection_id: connectionId }),
      { "content-type": "application/json" },
    );
    const result = z
      .object({
        id: z.string(),
        is_enabled: z.boolean(),
        user: z.object({ id: z.number() }),
        rights: z.object({ can_reply: z.boolean().optional() }).optional(),
      })
      .safeParse(raw);
    return (
      result.success &&
      result.data.id === connectionId &&
      result.data.is_enabled &&
      result.data.user.id === ownerId &&
      result.data.rights?.can_reply === true
    );
  }

  async message(chatId: number, text: string, connectionId: string) {
    await this.call(
      "sendMessage",
      JSON.stringify({
        chat_id: chatId,
        text,
        business_connection_id: connectionId,
      }),
      { "content-type": "application/json" },
    );
  }

  async document(chatId: number, bytes: ArrayBuffer, connectionId: string) {
    const body = new FormData();
    body.set("chat_id", String(chatId));
    body.set("business_connection_id", connectionId);
    body.set(
      "caption",
      "Ваш P&L на 3 месяца. Файл сформирован автоматически по вашему расчёту. По вопросам ответит менеджер. Прогноз зависит от ваших предположений.",
    );
    body.set(
      "document",
      new Blob([bytes], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      "Coffee-Market-PnL-3-months.xlsx",
    );
    await this.call("sendDocument", body);
  }
}
