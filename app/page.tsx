import { StorefrontPreview } from "../src/presentation/StorefrontPreview";
import { catalogRepository } from "../src/infrastructure/catalog-repository";
import { getSiteSettings } from "../src/server/runtime";
import { toPublicSettings } from "../src/domain/site-settings";
import { AnalyticsProvider } from "../src/presentation/AnalyticsProvider";
import { getAnalyticsDependencies } from "./analytics-dependencies";

export const dynamic = "force-dynamic";

export default async function Home() {
  let analyticsEnabled = false;
  try {
    const analytics = await getAnalyticsDependencies();
    analyticsEnabled = Boolean(analytics && !analytics.excluded);
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
