import type { Metadata } from "next";
import { renderOwnerPage, getAdminAuthMode } from "../access";
import { getAnalyticsRepository } from "../../../src/server/runtime";
import { defaultAnalyticsFilter } from "../../../src/domain/analytics";
import { AnalyticsDashboard } from "../../../src/presentation/admin/AnalyticsDashboard";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Аналитика — Coffee Market",
  robots: { index: false, follow: false },
};

export default async function AnalyticsPage() {
  return renderOwnerPage("/admin/analytics", async (deps) => {
    const now = Date.now(),
      filter = defaultAnalyticsFilter(now),
      repository = getAnalyticsRepository();
    let initial = null;
    try {
      if (repository) {
        await repository.cleanup(now);
        initial = await repository.report(filter, now);
      }
    } catch {
      /* The owner can retry without losing access to settings. */
    }
    const settings = await deps.repository.get();
    return (
      <AnalyticsDashboard
        authMode={getAdminAuthMode()}
        initial={initial}
        initialFilter={filter}
        userDisplayName={deps.user!.displayName}
        deliveryReady={
          deps.deliveryStatus.deliveryReady &&
          settings.settings.telegram.enabled
        }
      />
    );
  });
}
