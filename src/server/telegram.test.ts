// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { TelegramError, TelegramGateway } from "./telegram";

describe("official Telegram Business API adapter", () => {
  it("checks connection ownership, enabled status and reply rights", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        ok: true,
        result: {
          id: "connection",
          is_enabled: true,
          user: { id: 99 },
          rights: { can_reply: true },
        },
      }),
    );
    const gateway = new TelegramGateway("test-token", fetcher);
    expect(await gateway.verifyConnection("connection", 99)).toBe(true);
    fetcher.mockResolvedValueOnce(
      Response.json({
        ok: true,
        result: {
          id: "connection",
          is_enabled: true,
          user: { id: 100 },
          rights: { can_reply: true },
        },
      }),
    );
    expect(await gateway.verifyConnection("connection", 99)).toBe(false);
    fetcher.mockResolvedValueOnce(
      Response.json({
        ok: true,
        result: {
          id: "connection",
          is_enabled: true,
          user: { id: 99 },
          rights: {},
        },
      }),
    );
    expect(await gateway.verifyConnection("connection", 99)).toBe(false);
  });

  it("uploads the file with the business connection and transparent caption", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ ok: true, result: {} }));
    await new TelegramGateway("test-token", fetcher).document(
      42,
      new Uint8Array([1, 2, 3]).buffer,
      "connection",
    );
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/bottest-token/sendDocument");
    const body = options!.body as FormData;
    expect(body.get("chat_id")).toBe("42");
    expect(body.get("business_connection_id")).toBe("connection");
    expect(body.get("caption")).toContain("сформирован автоматически");
    const file = body.get("document") as File;
    expect(file.name).toBe("Coffee-Market-PnL-3-months.xlsx");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it("distinguishes a confirmed API rejection from ambiguous transport failure", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ ok: false }, { status: 429 }));
    const gateway = new TelegramGateway("test-token", fetcher);
    await expect(
      gateway.document(42, new ArrayBuffer(1), "connection"),
    ).rejects.toMatchObject({ confirmedRejected: true });
    fetcher.mockRejectedValueOnce(new Error("network"));
    await expect(
      gateway.document(42, new ArrayBuffer(1), "connection"),
    ).rejects.toMatchObject({ confirmedRejected: false });
    fetcher.mockResolvedValueOnce(
      new Response("upstream unavailable", { status: 502 }),
    );
    await expect(
      gateway.document(42, new ArrayBuffer(1), "connection"),
    ).rejects.toBeInstanceOf(TelegramError);
  });
});
