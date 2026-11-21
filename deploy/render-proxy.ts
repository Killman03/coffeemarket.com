import { parseArgs } from "node:util";
import { z } from "zod";
import { renderProxyConfiguration } from "./proxy-configuration";

try {
  const { values } = parseArgs({
    options: { origin: { type: "string" }, stage: { type: "string" } },
  });
  process.stdout.write(
    renderProxyConfiguration(
      z.string().parse(values.origin),
      z.enum(["http", "tls"]).parse(values.stage),
    ),
  );
} catch {
  console.error(
    "Invalid proxy arguments. A canonical HTTPS origin and http/tls stage are required.",
  );
  process.exitCode = 1;
}
