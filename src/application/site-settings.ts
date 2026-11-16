import { createInitialInput } from "./scenarios";
import { currencies } from "../domain/markets";
import { siteSettingsSchema, type SiteSettings } from "../domain/site-settings";

/** Builds independent editable defaults for every supported currency.
 *
 * Returns:
 *   A complete validated settings document with Telegram delivery disabled.
 */
export function createDefaultSettings(): SiteSettings {
  return siteSettingsSchema.parse({
    version: 1,
    telegram: {
      managerUsername: "",
      managerPhone: "",
      enabled: false,
      messageTemplate:
        "Здравствуйте! Хочу P&L на 3 месяца. Код расчёта: {code}",
    },
    defaults: Object.fromEntries(
      currencies.map(({ code }) => [
        code,
        createInitialInput({
          market: code === "KGS" ? "KG" : "OTHER",
          currency: code,
        }),
      ]),
    ),
    content: {
      calculatorTitle: "Сколько приносит ваша чашка кофе?",
      calculatorDescription:
        "Рассчитайте себестоимость напитка и потенциальную прибыль. Подставьте свои цены, рецепт и объём продаж.",
      pnlTitle: "Следующий шаг — P&L на 3 месяца",
      pnlDescription:
        "Превратите расчёт одной чашки в редактируемый план кофейной точки. Добавьте меню, сравните сценарии и отслеживайте план и факт.",
      pnlButtonLabel: "Получить в Telegram",
    },
  });
}
