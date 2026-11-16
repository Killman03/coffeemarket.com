import { StorefrontPreview } from "../src/presentation/StorefrontPreview";
import { catalogRepository } from "../src/infrastructure/catalog-repository";
import { getSiteSettings } from "../src/server/runtime";
import { toPublicSettings } from "../src/domain/site-settings";
import { AnalyticsProvider } from "../src/presentation/AnalyticsProvider";
import { getAdminDependencies } from "./admin/dependencies";
import { getAdminAccess } from "../src/server/admin";

export const dynamic = "force-dynamic";

export default async function Home() {
  let analyticsEnabled = false;
  try {
    const admin = await getAdminDependencies();
    const access = await getAdminAccess(admin);
    analyticsEnabled =
      Boolean(admin) && access !== "authorized" && access !== "bootstrap";
  } catch {
    /* Fail closed for analytics while retaining the calculator. */
  }
  return (
    <AnalyticsProvider enabled={analyticsEnabled}>
      <StorefrontPreview
        catalog={catalogRepository.getCatalog()}
        settings={toPublicSettings(await getSiteSettings())}
      />
    </AnalyticsProvider>
  );
}
