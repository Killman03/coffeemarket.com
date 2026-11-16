import { z } from "zod";
import { getChatGPTUser } from "../chatgpt-auth";
import type { AdminDependencies } from "../../src/server/admin";
import {
  getRuntimeEnvironment,
  getSettingsRepository,
  getDeliveryStatus,
} from "../../src/server/runtime";

const originSchema = z.url().refine((value) => {
  const url = new URL(value);
  return (
    url.origin === value &&
    (url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))
  );
});

/** Composes trusted platform identity with request-scoped storage and secrets. */
export async function getAdminDependencies(): Promise<AdminDependencies | null> {
  const env = getRuntimeEnvironment();
  const repository = getSettingsRepository();
  const origin = originSchema.safeParse(env?.SITE_ORIGIN);
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
