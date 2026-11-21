import { betterAuth } from "better-auth/minimal";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuthSchema } from "../../../db/postgres/auth-schema";
import type { PostgresDatabase } from "../postgres/database";
import type { ServerAuthentication } from "../auth-contracts";
import { json, readJson } from "../http";
import { ownerManagementLock } from "./owner-lock";
import { adminPasswordPolicy } from "../../domain/admin-auth";

export const adminSessionSeconds = 60 * 60 * 8;
export type AuthenticationConfiguration = { origin: string; secret: string };
type AuthDatabase =
  | PostgresDatabase
  | Parameters<Parameters<PostgresDatabase["transaction"]>[0]>[0];

/** Configures library-owned credentials, cookies, sessions and atomic DB limits.
 *
 * Args:
 *   db: Process-owned PostgreSQL connection pool through Drizzle.
 *   config: Fixed public origin and a runtime-only signing secret.
 *
 * Returns:
 *   Better Auth instance with registration and account self-service disabled.
 */
function createBetterAuth(
  db: AuthDatabase,
  config: AuthenticationConfiguration,
) {
  return betterAuth({
    appName: "Coffee Market",
    baseURL: config.origin,
    basePath: "/api/auth",
    secret: config.secret,
    trustedOrigins: [config.origin],
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: betterAuthSchema,
      transaction: true,
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: adminPasswordPolicy.minLength,
      maxPasswordLength: adminPasswordPolicy.maxLength,
    },
    session: {
      expiresIn: adminSessionSeconds,
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
    },
    advanced: {
      cookiePrefix: "coffee-market",
      useSecureCookies: config.origin.startsWith("https:"),
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
      // Until a trusted proxy is configured, every visitor shares one limit.
      // Forged X-Forwarded-For/cf-connecting-ip cannot rotate this bucket.
      ipAddress: { ipAddressHeaders: [] },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/get-session": false,
      },
    },
    logger: { disabled: true },
  });
}

/** Adapts Better Auth to the application's framework-independent identity port.
 *
 * Args:
 *   db: PostgreSQL adapter shared with the application repositories.
 *   config: Validated authentication secrets and origin.
 *
 * Returns:
 *   Session identity reader and a narrowly scoped HTTP endpoint handler.
 */
export function createNodeAuthentication(
  db: PostgresDatabase,
  config: AuthenticationConfiguration,
): ServerAuthentication {
  const auth = createBetterAuth(db, config);
  return {
    async getIdentity(headers) {
      const result = await auth.api.getSession({
        headers,
        query: { disableCookieCache: true, disableRefresh: true },
      });
      return result
        ? {
            userId: result.user.id,
            email: result.user.email,
            displayName: result.user.name,
          }
        : null;
    },
    async handle(request) {
      const path = new URL(request.url).pathname;
      const method = new Map([
        ["/api/auth/sign-in/email", "POST"],
        ["/api/auth/sign-out", "POST"],
        ["/api/auth/get-session", "GET"],
      ]).get(path);
      if (!method) return json({ error: "Не найдено." }, 404);
      if (request.method !== method)
        return new Response(null, {
          status: 405,
          headers: { Allow: method, "Cache-Control": "no-store" },
        });
      if (
        method === "POST" &&
        (request.headers.get("origin") !== config.origin ||
          request.headers.get("content-type")?.split(";")[0].trim() !==
            "application/json")
      )
        return json({ error: "Недопустимый источник запроса." }, 403);
      let bounded = request;
      if (method === "POST") {
        try {
          const body = await readJson(request, 8_192);
          const headers = new Headers(request.headers);
          headers.delete("content-length");
          bounded = new Request(request.url, {
            method,
            headers,
            body: JSON.stringify(body),
          });
        } catch {
          return json({ error: "Недопустимый запрос." }, 400);
        }
      }
      try {
        const response =
          path === "/api/auth/sign-in/email"
            ? await db.transaction(async (tx) => {
                await tx.execute(ownerManagementLock);
                return createBetterAuth(tx, config).handler(bounded);
              })
            : await auth.handler(bounded);
        if (response.status >= 500) {
          console.error("Authentication request failed");
          return json(
            { error: "Вход временно недоступен. Попробуйте позже." },
            503,
          );
        }
        response.headers.set("Cache-Control", "no-store");
        response.headers.set("Pragma", "no-cache");
        return response;
      } catch {
        console.error("Authentication request failed");
        return json(
          { error: "Вход временно недоступен. Попробуйте позже." },
          503,
        );
      }
    },
  };
}
