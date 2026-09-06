// Builds the SDK into:
//   dist/index.js          — ESM, for `npm i @opennas/app-sdk` consumers
//   dist/opennas.js        — IIFE global (window.OpenNAS), the hosted script
//
// It deliberately does NOT write into the OpenNAS web app any more. The SDK is
// its own area (and will be its own repository), so reaching across to drop a
// file into someone else's source tree is exactly the coupling that makes a
// split painful later. The web app keeps a vendored copy of `opennas.js` in
// `opennas/apps/web/public/app-sdk/`; refresh it with `pnpm sync-host` from
// here, or take it from a published release.
import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// ESM build (npm package entry).
await build({
  entryPoints: [resolve(here, "src/index.ts")],
  outfile: resolve(here, "dist/index.js"),
  bundle: true,
  format: "esm",
  target: "es2020",
  sourcemap: false,
});

// IIFE build (hosted global script).
const iifeOut = resolve(here, "dist/opennas.js");
await build({
  entryPoints: [resolve(here, "src/global.ts")],
  outfile: iifeOut,
  bundle: true,
  format: "iife",
  target: "es2018",
  minify: true,
  sourcemap: false,
  banner: { js: "/* OpenNAS app SDK — load with <script src=\"/app-sdk/opennas.js\"></script> */" },
});

console.log("app-sdk: built dist/index.js and dist/opennas.js");
