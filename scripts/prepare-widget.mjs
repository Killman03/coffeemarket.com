import { copyFile, cp } from "node:fs/promises";

// Ship a runnable HTML integration example beside the standard Vite assets.
await copyFile(
  new URL("../examples/widget.html", import.meta.url),
  new URL("../widget-dist/index.html", import.meta.url),
);
await cp(
  new URL("../public/templates/", import.meta.url),
  new URL("../widget-dist/templates/", import.meta.url),
  { recursive: true },
);
