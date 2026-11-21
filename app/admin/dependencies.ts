import { z } from "zod";
import { getApplicationRuntime } from "../../src/server/runtime-context";
import { siteOriginSchema } from "../../src/server/origin";
import { getChatGPTUser } from "../chatgpt-auth";
import { headers } from "next/headers";
import type { AdminDependencies } from "../../src/server/admin";
import {
  getRuntimeEnvironment,
  getSettingsRepository,
  getDeliveryStatus,
} from "../../src/server/runtime";

/** Composes trusted platform identity with request-scoped storage and secrets. */
export async function getAdminDependencies(): Promise<AdminDependencies | null> {
  const runtime = getApplicationRuntime();
  if (!runtime || runtime.platform === "demo") return null;
  if (runtime.platform === "node" && !runtime.authentication) return null;
  const env = getRuntimeEnvironment();
  const repository = getSettingsRepository();
  const origin = siteOriginSchema.safeParse(env?.SITE_ORIGIN);
  if (!repository || !origin.success) return null;
  const bootstrap = z.email().safeParse(env?.ADMIN_BOOTSTRAP_EMAIL);
  return {
    repository,
    user:
      runtime.platform === "node"
        ? await runtime.authentication!.getIdentity(
            new Headers(await headers()),
          )
        : await getChatGPTUser(),
    origin: origin.data,
    bootstrapEmail:
      runtime.platform === "sites" && bootstrap.success
        ? bootstrap.data
        : undefined,
    deliveryStatus: getDeliveryStatus(),
  };
}
