import { describe, expect, it } from "vitest";
import { createDefaultSettings } from "../application/site-settings";
import { currencies } from "./markets";
import { createInitialInput } from "../application/scenarios";
import {
  buildManagerTelegramUrl,
  messageTemplateSchema,
  publicSettingsSchema,
  siteSettingsSchema,
  toPublicSettings,
} from "./site-settings";

describe("site settings domain", () => {
  it("builds complete independent defaults from the existing scenario policy", () => {
    const settings = createDefaultSettings();
    expect(Object.keys(settings.defaults)).toEqual(
      currencies.map((value) => value.code),
    );
    for (const { code } of currencies)
      expect(settings.defaults[code]).toEqual(
        createInitialInput({
          market: code === "KGS" ? "KG" : "OTHER",
          currency: code,
        }),
      );
    expect(settings.telegram.enabled).toBe(false);
    settings.defaults.KGS.salePrice = 0;
    expect(createDefaultSettings().defaults.KGS.salePrice).not.toBe(0);
    expect(settings.defaults.USD).not.toBe(settings.defaults.EUR);
  });

  it("rejects incomplete currency sets, unsupported currencies and unsafe nested input", () => {
    const settings = createDefaultSettings();
    const { JPY: _, ...incomplete } = settings.defaults;
    expect(
      siteSettingsSchema.safeParse({ ...settings, defaults: incomplete })
        .success,
    ).toBe(false);
    expect(
      siteSettingsSchema.safeParse({
        ...settings,
        defaults: { ...settings.defaults, GBP: settings.defaults.USD },
      }).success,
    ).toBe(false);
    expect(
      siteSettingsSchema.safeParse({
        ...settings,
        defaults: {
          ...settings.defaults,
          USD: { ...settings.defaults.USD, sysPath: "secret" },
        },
      }).success,
    ).toBe(false);
    expect(
      siteSettingsSchema.safeParse({
        ...settings,
        defaults: {
          ...settings.defaults,
          USD: {
            ...settings.defaults.USD,
            feePercent: 60,
            turnoverTaxPercent: 50,
          },
        },
      }).success,
    ).toBe(false);
  });

  it("normalizes manager addresses and rejects enabled delivery without an address", () => {
    const settings = createDefaultSettings();
    expect(
      siteSettingsSchema.parse({
        ...settings,
        telegram: {
          ...settings.telegram,
          managerUsername: " @coffee_manager ",
        },
      }).telegram.managerUsername,
    ).toBe("coffee_manager");
    expect(
      siteSettingsSchema.parse({
        ...settings,
        telegram: { ...settings.telegram, managerPhone: "+1 202 555 0123" },
      }).telegram.managerPhone,
    ).toBe("+12025550123");
    expect(
      siteSettingsSchema.safeParse({
        ...settings,
        telegram: { ...settings.telegram, enabled: true },
      }).success,
    ).toBe(false);
    expect(
      siteSettingsSchema.safeParse({
        ...settings,
        telegram: {
          ...settings.telegram,
          managerUsername: "https://t.me/manager",
        },
      }).success,
    ).toBe(false);
    expect(
      siteSettingsSchema.safeParse({
        ...settings,
        telegram: { ...settings.telegram, managerPhone: "123" },
      }).success,
    ).toBe(false);
  });

  it("accepts exactly one code placeholder and rejects unknown or broken placeholders", () => {
    expect(
      messageTemplateSchema.parse(
        "Расчёт {code}. Рынок {market}, валюта {currency}",
      ),
    ).toContain("{code}");
    for (const template of [
      "Без кода",
      "{code}{code}",
      "{code}{token}",
      "{code} {",
      "{code} }",
      "{{code}}",
      "{code}{CODE}",
      "{code}" + "x".repeat(1000),
    ])
      expect(messageTemplateSchema.safeParse(template).success).toBe(false);
  });

  it("exposes only explicit public display settings and rejects secret fields", () => {
    const settings = createDefaultSettings();
    const publicSettings = toPublicSettings(settings);
    expect(publicSettings).toEqual({
      defaults: settings.defaults,
      content: settings.content,
    });
    expect(publicSettingsSchema.safeParse(settings).success).toBe(false);
    expect(
      siteSettingsSchema.safeParse({ ...settings, botToken: "not-allowed" })
        .success,
    ).toBe(false);
    expect(
      siteSettingsSchema.safeParse({
        ...settings,
        telegram: { ...settings.telegram, webhookSecret: "not-allowed" },
      }).success,
    ).toBe(false);
  });

  it("builds safe links with literal placeholder values and a phone fallback", () => {
    const telegram = {
      ...createDefaultSettings().telegram,
      managerUsername: "@coffee_manager",
      messageTemplate: "Хочу {code}: {market} / {currency}",
    };
    const variables = {
      code: "CM_example",
      market: "Казахстан & Кыргызстан",
      currency: "USD",
    };
    const url = new URL(buildManagerTelegramUrl(telegram, variables)!);
    expect(url.origin).toBe("https://t.me");
    expect(url.pathname).toBe("/coffee_manager");
    expect(url.searchParams.get("text")).toBe(
      "Хочу CM_example: Казахстан & Кыргызстан / USD",
    );
    expect(
      new URL(
        buildManagerTelegramUrl(
          { ...telegram, managerUsername: "", managerPhone: "+12025550123" },
          variables,
        )!,
      ).pathname,
    ).toBe("/+12025550123");
    expect(
      buildManagerTelegramUrl(createDefaultSettings().telegram, variables),
    ).toBeNull();
  });
});
