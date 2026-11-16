import type {
  AnalyticsEvent,
  AnalyticsFilter,
  AnalyticsReport,
} from "../domain/analytics";

export interface AnalyticsRepository {
  ingest(
    event: AnalyticsEvent,
    now: number,
  ): Promise<"accepted" | "duplicate" | "limited">;
  report(filter: AnalyticsFilter, now: number): Promise<AnalyticsReport>;
  cleanup(now: number): Promise<void>;
}
