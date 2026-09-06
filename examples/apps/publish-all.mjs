// Publishes every dist/*.onpkg to a repository.
// Usage: REPO_URL=https://repo.opennas.eu REPO_TOKEN=xxxx node publish-all.mjs
//    or: node publish-all.mjs <repoUrl> <token>
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, "dist");
const url = (process.env.REPO_URL || process.argv[2] || "http://127.0.0.1:4178").replace(/\/+$/, "");
const token = process.env.REPO_TOKEN || process.argv[3];

if (!token) {
  console.error("Set REPO_TOKEN (the repo's REPO_ADMIN_TOKEN), or pass it as the 2nd arg.");
  process.exit(1);
}
if (!existsSync(distDir)) {
  console.error("No dist/ — run `node pack-all.mjs` first.");
  process.exit(1);
}

const pkgs = readdirSync(distDir).filter((n) => n.endsWith(".onpkg"));
if (pkgs.length === 0) {
  console.error("No .onpkg files in dist/ — run `node pack-all.mjs`.");
  process.exit(1);
}

console.log(`Publishing ${pkgs.length} package(s) to ${url}\n`);
for (const p of pkgs) {
  const fd = new FormData();
  fd.append("file", new Blob([readFileSync(join(distDir, p))]), p);
  try {
    const res = await fetch(`${url}/v1/apps`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: fd });
    const body = await res.json().catch(() => ({}));
    const tag = body.signed ? "✓ verified" : res.ok ? "unsigned" : "";
    console.log(`  [${res.status}] ${p.padEnd(40)} ${tag} ${body.message ?? ""}`.trimEnd());
  } catch (err) {
    console.log(`  [err] ${p}  ${err.message}`);
  }
}
console.log(`\nDone — browse the repo at ${url}`);
