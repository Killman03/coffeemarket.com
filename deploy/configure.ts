import { parseArgs } from "node:util";
import { configureDeployment } from "./configuration";

try {
  const { values } = parseArgs({
    options: {
      origin: { type: "string" },
      revision: { type: "string" },
      "proxy-network": { type: "string" },
      directory: { type: "string", default: "/config" },
      "host-directory": {
        type: "string",
        default: "/etc/coffee-market-calculator",
      },
    },
  });
  const files = await configureDeployment({
    origin: values.origin,
    revision: values.revision,
    proxyNetwork: values["proxy-network"],
    directory: values.directory,
    hostDirectory: values["host-directory"],
  });
  console.log(
    `Created ${files.length} configuration files. Secret values are not displayed.`,
  );
} catch {
  console.error(
    "Configuration not created. Check arguments and directory; existing credentials are never overwritten.",
  );
  process.exitCode = 1;
}
