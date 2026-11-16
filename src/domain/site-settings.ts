import { z } from "zod";
import { calculatorSchema } from "./calculator";
import { phoneSchema } from "./contact";
import { currencySchema } from "./markets";

const usernameSchema = z
  .string()
  .trim()
  .max(33)
  .transform((value) => value.replace(/^@/, ""))
  .pipe(
    z
      .string()
      .regex(
        /^(?:[A-Za-z][A-Za-z0-9_]{4,31})?$/,
        "Укажите username без ссылки, например coffee_manager",
      ),
  );

export const messageTemplateSchema = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .superRefine((value, context) => {
    if ((value.match(/\{code\}/g) ?? []).length !== 1)
      context.addIssue({
        code: "custom",
        message: "Шаблон должен содержать ровно один {code}",
      });
    if (/[{}]/.test(value.replace(/\{(?:code|market|currency)\}/g, "")))
      context.addIssue({
        code: "custom",
        message: "Разрешены только подстановки {code}, {market} и {currency}",
      });
  });

export const telegramSettingsSchema = z
  .object({
    managerUsername: usernameSchema,
    managerPhone: z
      .string()
      .trim()
      .pipe(z.union([z.literal(""), phoneSchema])),
    enabled: z.boolean().default(false),
    messageTemplate: messageTemplateSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.enabled && !value.managerUsername && !value.managerPhone)
      context.addIssue({
        code: "custom",
        path: ["managerUsername"],
        message: "Для включения выдачи укажите username или телефон менеджера",
      });
  });

export const contentSettingsSchema = z
  .object({
    calculatorTitle: z.string().trim().min(1).max(120),
    calculatorDescription: z.string().trim().min(1).max(500),
    pnlTitle: z.string().trim().min(1).max(120),
    pnlDescription: z.string().trim().min(1).max(500),
    pnlButtonLabel: z.string().trim().min(1).max(60),
  })
  .strict();

export const defaultsSettingsSchema = z.record(
  currencySchema,
  calculatorSchema.strict(),
);
export const siteSettingsSchema = z
  .object({
    version: z.literal(1),
    telegram: telegramSettingsSchema,
    defaults: defaultsSettingsSchema,
    content: contentSettingsSchema,
  })
  .strict();
export const publicSettingsSchema = siteSettingsSchema
  .pick({ defaults: true, content: true })
  .strict();

export type SiteSettings = z.infer<typeof siteSettingsSchema>;
export type PublicSettings = z.infer<typeof publicSettingsSchema>;
export type SettingsSection = "telegram" | "defaults" | "content";
export const settingsEnvelopeSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative().nullable(),
    settings: siteSettingsSchema,
  })
  .strict();
export type SettingsEnvelope = z.infer<typeof settingsEnvelopeSchema>;

/** Builds a manager chat URL from the same validated template used by delivery.
 *
 * Args:
 *   telegram: Validated public manager address and message configuration.
 *   variables: Literal values for the three supported placeholders.
 *
 * Returns:
 *   A standard Telegram deep link, or null when no manager address is configured.
 */
export function buildManagerTelegramUrl(
  telegram: SiteSettings["telegram"],
  variables: { code: string; market: string; currency: string },
): string | null {
  const validated = telegramSettingsSchema.parse(telegram);
  const target = validated.managerUsername || validated.managerPhone;
  if (!target) return null;
  const text = validated.messageTemplate.replace(
    /\{(code|market|currency)\}/g,
    (_, key: keyof typeof variables) => variables[key],
  );
  const url = new URL(`https://t.me/${target}`);
  url.searchParams.set("text", text);
  return url.toString();
}

/** Selects the explicit, non-sensitive settings exposed to visitors.
 *
 * Args:
 *   settings: Fully validated settings from the repository.
 *
 * Returns:
 *   Calculator defaults and display copy without manager configuration.
 */
export function toPublicSettings(settings: SiteSettings): PublicSettings {
  return publicSettingsSchema.parse({
    defaults: settings.defaults,
    content: settings.content,
  });
}
