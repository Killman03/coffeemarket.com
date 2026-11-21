import { z } from "zod";
import { siteOriginSchema } from "../origin";

const common = {
  SITE_ORIGIN: siteOriginSchema.optional(),
  PG_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
};
const schema = z.discriminatedUnion("STORAGE_DRIVER", [
  z.object({
    ...common,
    STORAGE_DRIVER: z.literal("demo"),
    DATABASE_URL: z.undefined().optional(),
    BETTER_AUTH_SECRET: z.undefined().optional(),
  }),
  z.object({
    ...common,
    STORAGE_DRIVER: z.literal("postgres"),
    SITE_ORIGIN: siteOriginSchema,
    DATABASE_URL: z.url({ protocol: /^(postgres|postgresql)$/ }),
    BETTER_AUTH_SECRET: z.string().min(32).max(512).optional(),
  }),
]);
export type NodeConfiguration = z.infer<typeof schema>;

/** Validates deployment inputs while keeping invalid secret values out of errors.
 *
 * Args:
 *   environment: Process environment supplied by Next.js or the service manager.
 *
 * Returns:
 *   Explicit demo or PostgreSQL configuration.
 *
 * Raises:
 *   Error: Misconfigured fields, identified only by their names.
 */
export function readNodeConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
): NodeConfiguration {
  const parsed = schema.safeParse({
    ...environment,
    STORAGE_DRIVER: environment.STORAGE_DRIVER ?? "demo",
  });
  if (!parsed.success) {
    const fields = [
      ...new Set(parsed.error.issues.map((issue) => issue.path.join("."))),
    ];
    throw new Error(`Invalid server configuration: ${fields.join(", ")}`);
  }
  return parsed.data;
}
