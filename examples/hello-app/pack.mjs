// Packs this folder into a distributable OpenNAS app package (.onpkg).
// Usage: node pack.mjs   →   hello-opennas-<version>.onpkg
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const here = dirname(fileURLToPath(import.meta.url));

// Files we never ship inside a package. (*.key = the publisher's PRIVATE key —
// it must never be packaged. SIGNATURE, if present, IS shipped.)
const SKIP = new Set(["pack.mjs", "package.json", "README.md", "node_modules"]);

function collect(dir, base = dir) {
  const out = {};
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name) || name.endsWith(".onpkg") || name.endsWith(".key")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) Object.assign(out, collect(full, base));
    else out[relative(base, full).split(sep).join("/")] = new Uint8Array(readFileSync(full));
  }
  return out;
}

const manifest = JSON.parse(readFileSync(join(here, "opennas-app.json"), "utf8"));
const files = collect(here);
if (!files["opennas-app.json"]) throw new Error("opennas-app.json missing");
if (!files[manifest.entry]) throw new Error(`entry "${manifest.entry}" missing`);

const zipped = zipSync(files, { level: 9 });
const outName = `${manifest.id}-${manifest.version}.onpkg`;
writeFileSync(join(here, outName), zipped);
console.log(`Packed ${Object.keys(files).length} files → ${outName} (${zipped.length} bytes)`);
