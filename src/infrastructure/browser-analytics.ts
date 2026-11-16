import { z } from "zod";
import {
  analyticsEventSchema,
  attributionSchema,
  type AnalyticsEvent,
  type AnalyticsEventName,
  type Attribution,
} from "../domain/analytics";
import type { MarketContext } from "../domain/markets";

export const ANALYTICS_STORAGE_KEY = "cm.analytics.session.v1";
export const ANALYTICS_PREFERENCE_KEY = "cm.analytics.preference.v1";
const SESSION_IDLE_MS = 30 * 60_000;
const sessionSchema = z.object({
  id: z.uuid(),
  lastActive: z.number().finite(),
  sequence: z.number().int().nonnegative(),
  attribution: attributionSchema,
  seen: z.array(z.string().max(100)).max(128),
  queue: z.array(analyticsEventSchema).max(20),
});
type Session = z.infer<typeof sessionSchema>;
type Transport = (
  event: AnalyticsEvent,
) => Promise<"accepted" | "retry" | "discard">;

/** Captures only allowlisted campaign labels and a hostname, never a full URL.
 *
 * Args:
 *   href: Current page URL, used locally to extract three UTM labels.
 *   referrer: Browser referrer, reduced to an external hostname.
 *
 * Returns:
 *   Bounded attribution labels without query strings or advertising identifiers.
 */
export function captureAnalyticsAttribution(
  href: string,
  referrer: string,
): Attribution {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { source: "direct", medium: "none", campaign: "" };
  }
  let host = "";
  try {
    const referral = new URL(referrer);
    if (
      ["http:", "https:"].includes(referral.protocol) &&
      referral.hostname !== url.hostname
    )
      host = referral.hostname.slice(0, 80);
  } catch {
    /* No external referrer. */
  }
  const clean = (value: string | null) => {
    const result = attributionSchema.shape.campaign.safeParse(value ?? "");
    return result.success ? result.data : "";
  };
  const source = clean(url.searchParams.get("utm_source"));
  const external = clean(host);
  return {
    source: source.toLowerCase() || external || "direct",
    medium:
      clean(url.searchParams.get("utm_medium")).toLowerCase() ||
      (source ? "unspecified" : external ? "referral" : "none"),
    campaign: clean(url.searchParams.get("utm_campaign")),
  };
}

/** Maintains a per-tab session and a small retry queue independently of React. */
export class BrowserAnalytics {
  private session: Session | null = null;
  private running = false;
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private retries = 0;
  constructor(
    private readonly storage: Pick<
      Storage,
      "getItem" | "setItem" | "removeItem"
    > | null,
    private readonly attribution: Attribution,
    private readonly transport: Transport,
    private readonly now: () => number = Date.now,
  ) {
    try {
      const parsed = sessionSchema.safeParse(
        JSON.parse(storage?.getItem(ANALYTICS_STORAGE_KEY) ?? "null"),
      );
      if (
        parsed.success &&
        this.now() - parsed.data.lastActive < SESSION_IDLE_MS &&
        this.now() >= parsed.data.lastActive
      )
        this.session = parsed.data;
    } catch {
      /* Storage denial never prevents calculation. */
    }
  }
  private persist() {
    try {
      if (this.session)
        this.storage?.setItem(
          ANALYTICS_STORAGE_KEY,
          JSON.stringify(this.session),
        );
    } catch {
      /* In-memory session remains usable. */
    }
  }
  private ensure(context: MarketContext): Session {
    const now = this.now();
    if (
      !this.session ||
      now - this.session.lastActive >= SESSION_IDLE_MS ||
      now < this.session.lastActive
    ) {
      this.session = {
        id: crypto.randomUUID(),
        lastActive: now,
        sequence: 0,
        attribution: this.attribution,
        seen: [],
        queue: [],
      };
      this.append("page_view", context, "page_view");
    }
    this.session.lastActive = now;
    return this.session;
  }
  private append(
    name: AnalyticsEventName,
    context: MarketContext,
    key: string,
  ) {
    const session = this.session!;
    if (
      session.seen.includes(key) ||
      session.queue.length >= 20 ||
      session.seen.length >= 128
    )
      return;
    session.sequence += 1;
    session.queue.push(
      analyticsEventSchema.parse({
        version: 1,
        eventId: crypto.randomUUID(),
        sessionId: session.id,
        name,
        sequence: session.sequence,
        context,
        attribution: session.attribution,
      }),
    );
    session.seen.push(key);
  }

  /** Records one semantic milestone per session, with context-specific market changes.
   *
   * Args:
   *   name: Allowlisted browser observation, never a server delivery assertion.
   *   context: Market and currency only; financial inputs are not accepted.
   */
  track(name: AnalyticsEventName, context: MarketContext): void {
    if (this.stopped) return;
    try {
      this.ensure(context);
      this.append(
        name,
        context,
        name === "market_changed"
          ? `${name}:${context.market}:${context.currency}`
          : name,
      );
      this.persist();
      void this.flush();
    } catch {
      // Telemetry failure must never interrupt the calculator or expose inputs.
      this.stop(true);
    }
  }

  /** Returns the current unexpired session for optional request attribution. */
  sessionId(): string | undefined {
    return this.session &&
      this.now() - this.session.lastActive < SESSION_IDLE_MS
      ? this.session.id
      : undefined;
  }

  /** Flushes in order with bounded exponential retries and stable event IDs. */
  async flush(): Promise<void> {
    if (
      this.running ||
      this.stopped ||
      this.timer ||
      !this.session?.queue.length
    )
      return;
    this.running = true;
    const session = this.session,
      event = session.queue[0];
    let outcome: Awaited<ReturnType<Transport>>;
    try {
      outcome = await this.transport(event);
    } catch {
      outcome = "retry";
    }
    this.running = false;
    if (this.stopped) return;
    if (this.session !== session) {
      void this.flush();
      return;
    }
    if (outcome !== "retry") {
      session.queue.shift();
      this.retries = 0;
      this.persist();
      void this.flush();
    } else {
      this.retries = Math.min(this.retries + 1, 5);
      this.timer = setTimeout(
        () => {
          this.timer = undefined;
          void this.flush();
        },
        Math.min(1000 * 2 ** this.retries, 30_000),
      );
    }
  }

  /** Stops background work; opting out additionally erases the local session. */
  stop(erase = false): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (erase) {
      this.session = null;
      try {
        this.storage?.removeItem(ANALYTICS_STORAGE_KEY);
      } catch {
        /* Storage may be unavailable. */
      }
    }
  }
}
