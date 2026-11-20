import { getApplicationRuntime } from "../../../../src/server/runtime-context";
import { json } from "../../../../src/server/http";

export const dynamic = "force-dynamic";

/** Returns non-sensitive readiness; connection errors never expose credentials. */
export async function GET() {
  const runtime = getApplicationRuntime();
  try {
    const ready = runtime ? await runtime.ready() : false;
    return json(
      {
        ready,
        storage:
          runtime?.platform === "node"
            ? "postgres"
            : (runtime?.platform ?? "unconfigured"),
      },
      ready ? 200 : 503,
    );
  } catch {
    return json({ ready: false, storage: "unavailable" }, 503);
  }
}
