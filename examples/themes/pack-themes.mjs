// Packs every theme sub-folder (one containing theme.json) into a .onthm under
// ./dist. Usage: node pack-themes.mjs
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, "dist");
mkdirSync(distDir, { recursive: true });

const themes = readdirSync(here).filter(
  (n) => statSync(join(here, n)).isDirectory() && n !== "dist" && n !== "node_modules" && existsSync(join(here, n, "theme.json")),
);

for (const t of themes) {
  const dir = join(here, t);
  const files = {};
  for (const name of readdirSync(dir)) {
    if (statSync(join(dir, name)).isDirectory()) continue;
    files[name] = new Uint8Array(readFileSync(join(dir, name)));
  }
  const manifest = JSON.parse(readFileSync(join(dir, "theme.json"), "utf8"));
  const out = `${manifest.id}.onthm`;
  const zip = zipSync(files, { level: 9 });
  writeFileSync(join(distDir, out), zip);
  console.log(`  ✓ ${out.padEnd(28)} ${zip.length} bytes`);
}

console.log(`\n${themes.length} theme(s) → dist/`);
console.log("Install: Control Panel → Personalization → Install .onthm");
