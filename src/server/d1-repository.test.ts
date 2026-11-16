// @vitest-environment node
import { createSQLiteD1 } from "../test-support/d1";

import { describe, expect, it } from "vitest";
import { D1DeliveryRepository } from "./d1-repository";
import {
  CONSENT_TEXT,
  CONSENT_VERSION,
  type DeliveryRecord,
} from "./contracts";
import { defaultInput } from "../application/scenarios";

/** Runs real generated SQL against SQLite; the shim only adapts D1's API. */
function setup() {
  const { db, sql } = createSQLiteD1();
  return { repository: new D1DeliveryRepository(db), sql };
}

const now = 1_800_000_000_000;
const record = (id = "hash"): DeliveryRecord => ({
  id,
  payload: { input: defaultInput, context: { market: "KG", currency: "KGS" } },
  phone: "+12025550123",
  chatId: null,
  userId: null,
  expiresAt: now + 900_000,
  state: "pending",
});

describe("persistent delivery repository", () => {
  it("stores consent with its exact text, version and timestamp", async () => {
    const { repository, sql } = setup();
    expect(await repository.create(record(), "client", now)).toBe(true);
    expect(
      sql
        .prepare(
          "SELECT phone, consent_text, consent_version, consented_at FROM pnl_requests",
        )
        .get(),
    ).toMatchObject({
      phone: "+12025550123",
      consent_text: CONSENT_TEXT,
      consent_version: CONSENT_VERSION,
      consented_at: now,
    });
    sql.close();
  });
  it("enforces the per-client quota in the same insert statement", async () => {
    const { repository, sql } = setup();
    for (let i = 0; i < 5; i++)
      expect(await repository.create(record(String(i)), "client", now)).toBe(
        true,
      );
    expect(await repository.create(record("sixth"), "client", now)).toBe(false);
    expect(
      await repository.create(record("different"), "another-client", now),
    ).toBe(true);
    sql.close();
  });
  it("claims one customer and one delivery with compare-and-set SQL", async () => {
    const { repository, sql } = setup();
    await repository.create(record(), "client", now);
    expect(await repository.bind("hash", 42, 42, now)).toMatchObject({
      userId: 42,
    });
    expect(await repository.bind("hash", 43, 43, now)).toBeNull();
    expect(await repository.claimDelivery("hash", now)).toBe(true);
    expect(await repository.claimDelivery("hash", now)).toBe(false);
    await repository.setState("hash", "delivered");
    expect(await repository.bind("hash", 42, 42, now)).toBeNull();
    sql.close();
  });
  it("rejects expiration and preserves completed update deduplication", async () => {
    const { repository, sql } = setup();
    await repository.create(record(), "client", now);
    expect(await repository.bind("hash", 42, 42, now + 900_000)).toBeNull();
    expect(await repository.claimUpdate(1, now)).toBe("claimed");
    expect(await repository.claimUpdate(1, now)).toBe("busy");
    await repository.finishUpdate(1, false);
    expect(await repository.claimUpdate(1, now)).toBe("claimed");
    await repository.finishUpdate(1, true);
    expect(await repository.claimUpdate(1, now)).toBe("done");
    sql.close();
  });
  it("deletes contacts and payloads after the retention window", async () => {
    const { repository, sql } = setup();
    await repository.create(record(), "client", now);
    await repository.claimUpdate(1, now);
    await repository.cleanup(now + 31 * 86_400_000);
    expect(
      sql.prepare("SELECT COUNT(*) AS count FROM pnl_requests").get()?.count,
    ).toBe(0);
    expect(
      sql.prepare("SELECT COUNT(*) AS count FROM pnl_updates").get()?.count,
    ).toBe(0);
    sql.close();
  });
});
