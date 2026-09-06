// Copies the built `opennas.js` into the OpenNAS web app, which serves it at
// /app-sdk/opennas.js.
//
// A separate command rather than part of the build, because it writes outside
// this project. While the SDK and the system share a tree that is a convenience;
// once they are separate repositories this is what a release does — or the web
// app takes the file from a published `@opennas/app-sdk` instead. Either way the
// build itself stays self-contained.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const built = resolve(here, "dist/opennas.js");
if (!existsSync(built)) {
  console.error("dist/opennas.js is missing — run `pnpm build` first.");
  process.exit(1);
}

// ../../opennas from sdk/app-sdk.
const target = resolve(here, "../../opennas/apps/web/public/app-sdk");
if (!existsSync(resolve(target, "..", ".."))) {
  console.error(`No web app at ${target} — nothing to sync into.`);
  process.exit(1);
}
mkdirSync(target, { recursive: true });
copyFileSync(built, resolve(target, "opennas.js"));
console.log(`app-sdk: copied opennas.js -> ${target}`);
