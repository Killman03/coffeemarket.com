// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readNodeConfiguration } from "./config";
import { createNodeRuntime } from "./bootstrap";

describe("Node server configuration", () => {
  it("keeps the explicit demo usable without any credentials", async () => {
    const runtime = await createNodeRuntime({ STORAGE_DRIVER: "demo" });
    expect(runtime.platform).toBe("demo");
    expect(runtime.settings).toBeNull();
    expect(runtime.analytics).toBeNull();
    expect(await runtime.ready()).toBe(true);
    await runtime.close();
  });
  it("rejects missing PostgreSQL inputs instead of falling back to demo", () => {
    expect(() => readNodeConfiguration({ STORAGE_DRIVER: "postgres" })).toThrow(
      "DATABASE_URL",
    );
    expect(() =>
      readNodeConfiguration({
        STORAGE_DRIVER: "postgres",
        DATABASE_URL: "postgresql://localhost/app",
      }),
    ).toThrow("SITE_ORIGIN");
  });
  it("does not ignore a database URL accidentally configured in demo", () => {
    expect(() =>
      readNodeConfiguration({ DATABASE_URL: "postgresql://localhost/app" }),
    ).toThrow("DATABASE_URL");
  });
  it("redacts invalid values and rejects invalid origins, drivers and pool sizes", () => {
    const valid = {
      STORAGE_DRIVER: "postgres",
      DATABASE_URL: "postgresql://localhost/app",
      SITE_ORIGIN: "https://example.com",
    };
    for (const invalid of [
      { DATABASE_URL: "secret-value" },
      { SITE_ORIGIN: "https://example.com/path" },
      { STORAGE_DRIVER: "other" },
      { PG_POOL_MAX: "0" },
      { PG_POOL_MAX: "101" },
    ]) {
      expect(() => readNodeConfiguration({ ...valid, ...invalid })).toThrow(
        "Invalid server configuration",
      );
      try {
        readNodeConfiguration({ ...valid, ...invalid });
      } catch (error) {
        expect(String(error)).not.toContain("secret-value");
      }
    }
  });
});
