import { z } from "zod";
import { getApplicationRuntime } from "../../src/server/runtime-context";
import { siteOriginSchema } from "../../src/server/origin";
import { getChatGPTUser } from "../chatgpt-auth";
import type { AdminDependencies } from "../../src/server/admin";
import {
  getRuntimeEnvironment,
  getSettingsRepository,
  getDeliveryStatus,
} from "../../src/server/runtime";

/** Composes trusted platform identity with request-scoped storage and secrets. */
export async function getAdminDependencies(): Promise<AdminDependencies | null> {
  // Node.js has no trusted Sites gateway. Independent identity is a separate
  // deployment step; user-supplied oai-authenticated-* headers cannot grant access.
  if (getApplicationRuntime()?.platform !== "sites") return null;
  const env = getRuntimeEnvironment();
  const repository = getSettingsRepository();
  const origin = siteOriginSchema.safeParse(env?.SITE_ORIGIN);
  if (!repository || !origin.success) return null;
  const bootstrap = z.email().safeParse(env?.ADMIN_BOOTSTRAP_EMAIL);
  return {
    repository,
    user: await getChatGPTUser(),
    origin: origin.data,
    bootstrapEmail: bootstrap.success ? bootstrap.data : undefined,
    deliveryStatus: getDeliveryStatus(),
  };
}
