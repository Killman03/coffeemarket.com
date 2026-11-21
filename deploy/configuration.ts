import { randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, open, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { siteOriginSchema } from "../src/server/origin";

const optionsSchema = z.object({
  origin: siteOriginSchema,
  revision: z.string().regex(/^[0-9a-f]{40}$/),
  proxyNetwork: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/),
  directory: z.string().refine(path.isAbsolute),
  hostDirectory: z.string().regex(/^\/[a-zA-Z0-9_./-]+$/),
});
export type DeploymentOptions = z.infer<typeof optionsSchema>;

/** Writes distinct credentials once, keeping operator privileges out of the app.
 *
 * Args:
 *   input: Origin, immutable image revision, proxy network and explicit directories.
 *
 * Returns:
 *   Paths of generated files; secret values are never returned or printed.
 *
 * Raises:
 *   Error: Invalid configuration, a symlink or an existing generated file.
 */
export async function configureDeployment(input: unknown): Promise<string[]> {
  const options = optionsSchema.parse(input);
  const fileNames = [
    "application.env",
    "database.env",
    "migration.env",
    "operator.env",
    "compose.env",
    "domain",
  ];
  const info = await lstat(options.directory).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return null;
    },
  );
  if (info && (!info.isDirectory() || info.isSymbolicLink()))
    throw new Error("Configuration directory must be a real directory");
  await mkdir(options.directory, { recursive: true, mode: 0o700 });
  await chmod(options.directory, 0o700);
  const lockPath = path.join(options.directory, ".setup.lock");
  const lock = await open(lockPath, "wx", 0o600);
  try {
    for (const name of fileNames) {
      try {
        await lstat(path.join(options.directory, name));
        throw new Error(
          "Configuration already exists; credentials will not be overwritten",
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    const password = () => randomBytes(32).toString("hex");
    const rootPassword = password(),
      migrationPassword = password(),
      appPassword = password(),
      operatorPassword = password();
    const connection = (user: string, value: string) => {
      const url = new URL("postgresql://calculator-db:5432/coffee_market");
      url.username = user;
      url.password = value;
      return url.href;
    };
    const files: Record<string, string> = {
      "application.env": [
        "STORAGE_DRIVER=postgres",
        `DATABASE_URL=${connection("coffee_app", appPassword)}`,
        `SITE_ORIGIN=${options.origin}`,
        "PG_POOL_MAX=3",
        `BETTER_AUTH_SECRET=${randomBytes(48).toString("base64url")}`,
      ].join("\n"),
      "database.env": [
        "POSTGRES_DB=coffee_market",
        "POSTGRES_USER=postgres",
        `POSTGRES_PASSWORD=${rootPassword}`,
        `COFFEE_MIGRATOR_PASSWORD=${migrationPassword}`,
        `COFFEE_APPLICATION_PASSWORD=${appPassword}`,
        `COFFEE_OPERATOR_PASSWORD=${operatorPassword}`,
      ].join("\n"),
      "migration.env": `MIGRATION_DATABASE_URL=${connection("coffee_migrator", migrationPassword)}`,
      "operator.env": `ADMIN_DATABASE_URL=${connection("coffee_admin", operatorPassword)}`,
      "compose.env": [
        `CALCULATOR_CONFIG_DIR=${options.hostDirectory}`,
        `CALCULATOR_REVISION=${options.revision}`,
        `CALCULATOR_PROXY_NETWORK=${options.proxyNetwork}`,
        "CALCULATOR_PORT=3107",
      ].join("\n"),
      domain: new URL(options.origin).hostname,
    };
    for (const [name, data] of Object.entries(files))
      await writeFile(path.join(options.directory, name), `${data}\n`, {
        flag: "wx",
        mode: 0o600,
      });
    return fileNames.map((name) => path.join(options.directory, name));
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}
