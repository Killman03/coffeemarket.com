import { z } from "zod";
import { siteSettingsSchema } from "../domain/site-settings";
import type { SettingsRepository } from "./settings-repository";
import { json, readJson } from "./http";

export type AdminIdentity = {
  userId: string;
  email: string;
  displayName: string;
};
export type AdminDependencies = {
  repository: SettingsRepository;
  user: AdminIdentity | null;
  bootstrapEmail: string | undefined;
  origin: string;
  deliveryStatus: { deliveryReady: boolean; missing: string[] };
};
export type AdminAccess =
  "anonymous" | "bootstrap" | "authorized" | "forbidden" | "unconfigured";
const updateSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    settings: siteSettingsSchema,
  })
  .strict();

/** Checks a pinned owner subject, using verified email only before first claim.
 *
 * Args:
 *   deps: Trusted server identity, persistent repository and deployment settings.
 *
 * Returns:
 *   Access state without creating or changing an owner record.
 */
export async function getAdminAccess(
  deps: AdminDependencies | null,
): Promise<AdminAccess> {
  if (!deps) return "unconfigured";
  if (!deps.user) return "anonymous";
  const owner = await deps.repository.getOwner();
  if (owner)
    return owner.subject === deps.user.userId ? "authorized" : "forbidden";
  if (!deps.bootstrapEmail) return "unconfigured";
  return deps.user.email.trim().toLowerCase() ===
    deps.bootstrapEmail.trim().toLowerCase()
    ? "bootstrap"
    : "forbidden";
}

function validMutation(request: Request, deps: AdminDependencies): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  return (
    request.headers.get("origin") === deps.origin &&
    request.headers.get("x-coffeemarket-admin") === "1" &&
    (!fetchSite || fetchSite === "same-origin" || fetchSite === "none")
  );
}
const forbidden = () =>
  json({ error: "Доступ разрешён только владельцу сайта." }, 403);
const unavailable = () =>
  json({ error: "Панель временно недоступна. Попробуйте позже." }, 503);

/** Claims the owner once, after authentication and same-origin POST verification. */
export async function claimAdmin(
  request: Request,
  deps: AdminDependencies | null,
): Promise<Response> {
  if (!deps) return unavailable();
  if (!validMutation(request, deps)) return forbidden();
  try {
    const access = await getAdminAccess(deps);
    if (access !== "bootstrap" && access !== "authorized") return forbidden();
    if (
      access === "bootstrap" &&
      !(await deps.repository.claimOwner(deps.user!.userId, Date.now()))
    )
      return forbidden();
    return json({ ok: true });
  } catch {
    return unavailable();
  }
}

/** Reads or atomically saves settings after repeating owner authorization.
 *
 * Args:
 *   request: GET or PUT request; PUT requires Origin and the admin custom header.
 *   deps: Server-owned adapters and authenticated identity.
 *
 * Returns:
 *   A settings envelope or a localized, non-sensitive error response.
 */
export async function handleAdminSettings(
  request: Request,
  deps: AdminDependencies | null,
): Promise<Response> {
  if (!deps) return unavailable();
  try {
    if (request.method !== "GET" && request.method !== "PUT")
      return json({ error: "Метод не поддерживается." }, 405);
    if (request.method === "PUT" && !validMutation(request, deps))
      return forbidden();
    const access = await getAdminAccess(deps);
    if (access === "anonymous")
      return json({ error: "Войдите в аккаунт владельца." }, 401);
    if (access !== "authorized") return forbidden();
    if (request.method === "GET") return json(await deps.repository.get());
    const parsed = updateSchema.safeParse(
      await readJson(request, 65_536).catch(() => null),
    );
    if (!parsed.success)
      return json(
        {
          error: "Проверьте значения в настройках.",
          issues: parsed.error.issues.map(({ path, message }) => ({
            path,
            message,
          })),
        },
        400,
      );
    if (
      parsed.data.settings.telegram.enabled &&
      !deps.deliveryStatus.deliveryReady
    )
      return json(
        {
          error:
            "Сначала подключите Telegram Business и серверные секреты. Контакт можно сохранить с выключенной выдачей.",
        },
        422,
      );
    const result = await deps.repository.save(
      parsed.data.settings,
      parsed.data.revision,
      deps.user!.userId,
      Date.now(),
    );
    return result
      ? json(result)
      : json(
          {
            error:
              "Настройки изменены в другой вкладке. Обновите страницу и повторите изменения.",
          },
          409,
        );
  } catch {
    return unavailable();
  }
}
