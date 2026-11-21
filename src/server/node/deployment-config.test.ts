// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse } from "dotenv";
import { configureDeployment } from "../../../deploy/configuration";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function options() {
  const directory = await mkdtemp(path.join(tmpdir(), "coffee-deployment-"));
  directories.push(directory);
  return {
    origin: "https://calculator.example.com",
    revision: "a".repeat(40),
    proxyNetwork: "example_proxy",
    directory,
    hostDirectory: "/etc/coffee-market-calculator",
  };
}

describe("isolated deployment configuration", () => {
  it("separates app, migration and operator credentials and binds only the new database", async () => {
    const input = await options();
    await configureDeployment(input);
    const read = async (name: string) =>
      parse(await readFile(path.join(input.directory, name), "utf8"));
    const app = await read("application.env"),
      migration = await read("migration.env"),
      operator = await read("operator.env"),
      database = await read("database.env");
    expect(Object.keys(app).sort()).toEqual([
      "BETTER_AUTH_SECRET",
      "DATABASE_URL",
      "PG_POOL_MAX",
      "SITE_ORIGIN",
      "STORAGE_DRIVER",
    ]);
    const appUrl = new URL(app.DATABASE_URL),
      migrationUrl = new URL(migration.MIGRATION_DATABASE_URL),
      operatorUrl = new URL(operator.ADMIN_DATABASE_URL);
    expect(appUrl.hostname).toBe("calculator-db");
    expect(appUrl.username).toBe("coffee_app");
    expect(migrationUrl.username).toBe("coffee_migrator");
    expect(operatorUrl.username).toBe("coffee_admin");
    expect(
      new Set([
        appUrl.password,
        migrationUrl.password,
        operatorUrl.password,
        database.POSTGRES_PASSWORD,
      ]).size,
    ).toBe(4);
    expect(app.BETTER_AUTH_SECRET.length).toBeGreaterThanOrEqual(32);
    if (process.platform !== "win32") {
      expect((await stat(input.directory)).mode & 0o777).toBe(0o700);
      expect(
        (await stat(path.join(input.directory, "application.env"))).mode &
          0o777,
      ).toBe(0o600);
    }
  });
  it("refuses a repeated setup without rotating credentials for an existing database", async () => {
    const input = await options();
    await configureDeployment(input);
    const before = await readFile(path.join(input.directory, "database.env"));
    await expect(configureDeployment(input)).rejects.toThrow("already exists");
    expect(
      (await readFile(path.join(input.directory, "database.env"))).equals(
        before,
      ),
    ).toBe(true);
  });
  it("rejects unsafe origins and non-immutable image revisions before writing secrets", async () => {
    const input = await options();
    for (const invalid of [
      { origin: "http://public.example.com" },
      { origin: "https://calculator.example.com/path" },
      { revision: "latest" },
      { hostDirectory: "/etc/config\nINJECTED=1" },
      { proxyNetwork: "name\nINJECTED=1" },
    ])
      await expect(
        configureDeployment({ ...input, ...invalid }),
      ).rejects.toThrow();
    await expect(
      readFile(path.join(input.directory, "database.env")),
    ).rejects.toThrow();
  });
  it("allows only one concurrent setup and keeps each database credential consistent", async () => {
    const input = await options();
    const results = await Promise.allSettled([
      configureDeployment(input),
      configureDeployment(input),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const database = parse(
      await readFile(path.join(input.directory, "database.env"), "utf8"),
    );
    const app = parse(
      await readFile(path.join(input.directory, "application.env"), "utf8"),
    );
    expect(
      new URL(app.DATABASE_URL).password ===
        database.COFFEE_APPLICATION_PASSWORD,
    ).toBe(true);
  });
  it.skipIf(process.platform === "win32")(
    "does not follow a symlink to an unrelated configuration directory",
    async () => {
      const input = await options();
      const link = `${input.directory}-link`;
      directories.push(link);
      await symlink(input.directory, link);
      await expect(
        configureDeployment({ ...input, directory: link }),
      ).rejects.toThrow("real directory");
    },
  );
});
