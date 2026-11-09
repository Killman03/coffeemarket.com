import { cp } from "node:fs/promises";

// Next.js standalone output intentionally excludes these assets. Copy them
// using Node's standard filesystem API so the build works on every host.
const root = new URL("../", import.meta.url);
await cp(new URL("public/", root), new URL(".next-node/standalone/public/", root), {
  recursive: true,
});
await cp(
  new URL(".next-node/static/", root),
  new URL(".next-node/standalone/.next-node/static/", root),
  { recursive: true },
);
