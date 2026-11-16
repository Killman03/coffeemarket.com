import {
  analyticsEventSchema,
  analyticsFilterSchema,
  analyticsInterval,
} from "../domain/analytics";
import type { AnalyticsRepository } from "./analytics-contracts";
import type { AdminDependencies } from "./admin";
import { getAdminAccess } from "./admin";
import { json, readJson } from "./http";

type CollectorDependencies = {
  repository: AnalyticsRepository;
  origin: string;
  excluded: boolean;
  now?: () => number;
};

/** Accepts a bounded browser observation, never a claimed business conversion.
 *
 * Args:
 *   request: Same-origin JSON request with the analytics custom header.
 *   deps: Storage, canonical origin, verified owner exclusion and server clock.
 *
 * Returns:
 *   An uncached acknowledgment or a non-sensitive rejection.
 */
export async function collectAnalytics(
  request: Request,
  deps: CollectorDependencies | null,
): Promise<Response> {
  if (!deps) return json({ error: "Statistics unavailable" }, 503);
  if (
    request.headers.get("origin") !== deps.origin ||
    request.headers.get("x-coffeemarket-analytics") !== "1" ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    return json({ error: "Forbidden" }, 403);
  if (
    deps.excluded ||
    request.headers.get("dnt") === "1" ||
    request.headers.get("sec-gpc") === "1"
  )
    return new Response(null, {
      status: 204,
      headers: { "cache-control": "no-store" },
    });
  const parsed = analyticsEventSchema.safeParse(
    await readJson(request, 4096).catch(() => null),
  );
  if (!parsed.success) return json({ error: "Invalid event" }, 400);
  try {
    const now = deps.now?.() ?? Date.now();
    await deps.repository.cleanup(now);
    const result = await deps.repository.ingest(parsed.data, now);
    return result === "limited"
      ? json({ error: "Rate limited" }, 429)
      : json({ ok: true }, result === "accepted" ? 202 : 200);
  } catch {
    return json({ error: "Statistics unavailable" }, 503);
  }
}

/** Authorizes every report read and validates its bounded UTC period.
 *
 * Args:
 *   request: GET with schema-validated report filters.
 *   admin: Existing owner authorization dependencies.
 *   repository: Analytics persistence port.
 *   now: Server clock for deterministic interval checks.
 *
 * Returns:
 *   Aggregated report, never event logs, identities or contact information.
 */
export async function readAnalyticsReport(
  request: Request,
  admin: AdminDependencies | null,
  repository: AnalyticsRepository | null,
  now = Date.now(),
): Promise<Response> {
  if (!admin || !repository)
    return json({ error: "Аналитика временно недоступна." }, 503);
  try {
    const access = await getAdminAccess(admin);
    if (access !== "authorized")
      return json(
        { error: "Доступ разрешён только владельцу." },
        access === "anonymous" ? 401 : 403,
      );
    const parsed = analyticsFilterSchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success || !analyticsInterval(parsed.data, now))
      return json(
        {
          error:
            "Выберите период в пределах последних 90 дней, включая сегодня.",
        },
        400,
      );
    await repository.cleanup(now);
    return json(await repository.report(parsed.data, now));
  } catch {
    return json(
      { error: "Не удалось загрузить отчёт. Попробуйте ещё раз." },
      503,
    );
  }
}
