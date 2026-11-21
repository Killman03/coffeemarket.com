import { getApplicationRuntime } from "../../../../src/server/runtime-context";
import { json } from "../../../../src/server/http";

export const dynamic = "force-dynamic";

/** Delegates HTTP auth to the configured Node adapter without Sites fallbacks. */
async function handle(request: Request) {
  const runtime = getApplicationRuntime();
  if (runtime?.platform !== "node" || !runtime.authentication)
    return json({ error: "Вход на сервере не настроен." }, 503);
  return runtime.authentication.handle(request);
}
export { handle as GET, handle as POST };
