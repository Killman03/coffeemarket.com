import { createAuthClient } from "better-auth/react";

// Same-origin URLs work unchanged behind any reverse proxy and on local hosts.
export const adminAuthClient = createAuthClient({ basePath: "/api/auth" });
