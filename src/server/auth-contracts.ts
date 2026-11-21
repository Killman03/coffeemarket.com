import type { AdminIdentity } from "./admin";

/** Hosting-independent boundary for authenticated requests and session endpoints. */
export interface ServerAuthentication {
  getIdentity(headers: Headers): Promise<AdminIdentity | null>;
  handle(request: Request): Promise<Response>;
}
