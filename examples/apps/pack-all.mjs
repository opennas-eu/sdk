// Packs every app sub-folder into a signed .onpkg under ./dist.
// An app folder containing an empty `UNSIGNED` file is packed without a signature
// (to demo the "Unsigned" badge). Usage: node pack-all.mjs
import { createHash, generateKeyPairSync, sign as edSign, createPrivateKey, createPublicKey } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const here = dirname(fileURLToPath(import.meta.url));
const KEYFILE = join(here, "publisher.key");
const enc = (s) => new TextEncoder().encode(s);

// Load or create the shared ed25519 publisher key.
let priv;
if (existsSync(KEYFILE)) {
  priv = createPrivateKey(readFileSync(KEYFILE));
} else {
  priv = generateKeyPairSync("ed25519").privateKey;
  writeFileSync(KEYFILE, priv.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  console.log("Generated publisher.key");
}
const pubDer = createPublicKey(priv).export({ type: "spki", format: "der" });
const pubB64 = pubDer.toString("base64");
const fingerprint = createHash("sha256").update(pubDer).digest("hex");

// Canonical digest — MUST match the repo + OpenNAS client (framework.ts).
function canonical(files) {
  const names = Object.keys(files).filter((n) => n !== "SIGNATURE").sort();
  const h = createHash("sha256");
  for (const n of names) {
    h.update(n + "\n");
    h.update(createHash("sha256").update(files[n]).digest("hex") + "\n");
  }
  return h.digest();
}

const distDir = join(here, "dist");
mkdirSync(distDir, { recursive: true });

const apps = readdirSync(here).filter(
  (n) => statSync(join(here, n)).isDirectory() && n !== "dist" && n !== "node_modules" && existsSync(join(here, n, "opennas-app.json")),
);

for (const app of apps) {
  const dir = join(here, app);
  const sign = !existsSync(join(dir, "UNSIGNED"));
  const manifest = JSON.parse(readFileSync(join(dir, "opennas-app.json"), "utf8"));
  if (sign) manifest.publisherKey = pubB64;

  const files = {};
  for (const name of readdirSync(dir)) {
    if (name === "opennas-app.json" || name === "UNSIGNED") continue;
    files[name] = new Uint8Array(readFileSync(join(dir, name)));
  }
  files["opennas-app.json"] = enc(JSON.stringify(manifest, null, 2) + "\n");
  if (sign) files["SIGNATURE"] = enc(edSign(null, canonical(files), priv).toString("base64") + "\n");

  const out = `${manifest.id}-${manifest.version}.onpkg`;
  const zip = zipSync(files, { level: 9 });
  writeFileSync(join(distDir, out), zip);
  console.log(`  ${sign ? "✓ signed " : "  unsigned"}  ${out.padEnd(40)} ${zip.length} bytes`);
}

console.log(`\nPublisher fingerprint: ${fingerprint}`);
console.log(`Packages → dist/  ·  publish with: node publish-all.mjs`);
