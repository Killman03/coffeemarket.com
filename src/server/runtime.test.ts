// @vitest-environment node
import { beforeEach, describe, it, expect, vi } from "vitest";
import { createDefaultSettings } from "../application/site-settings";
const state = vi.hoisted(() => ({ settings: undefined as unknown }));
vi.mock("./settings-repository", () => ({
  D1SettingsRepository: class {
    async get() {
      return { settings: state.settings };
    }
  },
}));
import {
  getCleanupRuntime,
  getDeliveryRuntime,
  getDeliveryStatus,
  getRuntimeEnvironment,
  runWithDeliveryRuntime,
  type DeliveryEnvironment,
} from "./runtime";

const env: DeliveryEnvironment = {
  PNL_DB: {} as D1Database,
  TELEGRAM_BOT_TOKEN: `123:${"a".repeat(30)}`,
  TELEGRAM_MANAGER_USER_ID: "99",
  TELEGRAM_BUSINESS_CONNECTION_ID: "business",
  TELEGRAM_WEBHOOK_SECRET: "a".repeat(32),
  PNL_PUBLIC_ORIGIN: "https://example.com",
};
beforeEach(() => {
  state.settings = createDefaultSettings();
});
describe("request scoped runtime", () => {
  it("isolates overlapping requests without process-global credentials", async () => {
    const values = await Promise.all(
      ["first", "second"].map((secret) =>
        runWithDeliveryRuntime(
          { TELEGRAM_WEBHOOK_SECRET: secret },
          async () => {
            await Promise.resolve();
            return getRuntimeEnvironment()?.TELEGRAM_WEBHOOK_SECRET;
          },
        ),
      ),
    );
    expect(values).toEqual(["first", "second"]);
    expect(getRuntimeEnvironment()).toBeUndefined();
  });
  it("reads current database contact and enabled state without restart", async () => {
    const settings = createDefaultSettings();
    state.settings = settings;
    await runWithDeliveryRuntime(env, async () => {
      expect(await getDeliveryRuntime()).toBeNull();
      settings.telegram = {
        ...settings.telegram,
        enabled: true,
        managerUsername: "coffee_first",
      };
      expect((await getDeliveryRuntime())?.managerTarget).toBe("coffee_first");
      settings.telegram.managerUsername = "coffee_second";
      expect((await getDeliveryRuntime())?.managerTarget).toBe("coffee_second");
      settings.telegram.enabled = false;
      expect(await getDeliveryRuntime()).toBeNull();
    });
  });
  it("keeps retention running when delivery is disabled and needs only its own dependencies", () => {
    runWithDeliveryRuntime(
      {
        PNL_DB: env.PNL_DB,
        TELEGRAM_WEBHOOK_SECRET: env.TELEGRAM_WEBHOOK_SECRET,
      },
      () => {
        expect(getCleanupRuntime()).not.toBeNull();
        expect(getDeliveryStatus().deliveryReady).toBe(false);
      },
    );
    expect(getCleanupRuntime()).toBeNull();
  });
  it("reports missing setup without returning secrets", () => {
    runWithDeliveryRuntime(env, () => {
      expect(getDeliveryStatus()).toEqual({ deliveryReady: true, missing: [] });
    });
    expect(
      JSON.stringify(
        runWithDeliveryRuntime(
          { ...env, TELEGRAM_BOT_TOKEN: "malformed-secret-value" },
          getDeliveryStatus,
        ),
      ),
    ).not.toContain("malformed-secret-value");
  });
});
