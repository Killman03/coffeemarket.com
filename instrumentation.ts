/** Uses Next.js's supported server-startup hook; builds need no database. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initializeNodeRuntime } =
      await import("./src/server/node/bootstrap");
    await initializeNodeRuntime();
  }
}
