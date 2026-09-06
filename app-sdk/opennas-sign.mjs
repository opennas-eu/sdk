#!/usr/bin/env node
// Sign an OpenNAS app so it installs as a "verified" publisher.
//
//   node opennas-sign.mjs keygen [keyfile]     generate an ed25519 publisher key
//   node opennas-sign.mjs sign <appdir> [keyfile]
//
// `sign` sets `publisherKey` in the app's opennas-app.json and writes a SIGNATURE
// file. The signature covers every file in the package except SIGNATURE itself
// (digest algorithm matches apps/api/src/apps/framework.ts → canonicalDigest).
import { createHash, generateKeyPairSync, sign as edSign, createPrivateKey, createPublicKey } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const KEYFILE_DEFAULT = "publisher.key";
// Must match pack.mjs exactly so the signed digest covers the same files that
// actually ship. The private *.key never goes into the package.
const SKIP = new Set(["node_modules", "pack.mjs", "package.json", "README.md"]);
const skip = (name) => SKIP.has(name) || name.endsWith(".onpkg") || name.endsWith(".key");

function collect(dir, base = dir, out = {}) {
  for (const name of readdirSync(dir)) {
    if (skip(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) collect(full, base, out);
    else out[relative(base, full).split(sep).join("/")] = new Uint8Array(readFileSync(full));
  }
  return out;
}

function digest(files) {
  const names = Object.keys(files).filter((n) => n !== "SIGNATURE").sort();
  const h = createHash("sha256");
  for (const name of names) {
    h.update(name + "\n");
    h.update(createHash("sha256").update(files[name]).digest("hex") + "\n");
  }
  return h.digest();
}

const [cmd, arg, keyArg] = process.argv.slice(2);

if (cmd === "keygen") {
  const file = arg || KEYFILE_DEFAULT;
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  writeFileSync(file, privateKey.export({ type: "pkcs8", format: "pem" }));
  const spki = publicKey.export({ type: "spki", format: "der" });
  console.log(`Wrote private key → ${file}  (KEEP THIS SECRET)`);
  console.log(`Public key (SPKI base64): ${spki.toString("base64")}`);
  console.log(`Fingerprint:              ${createHash("sha256").update(spki).digest("hex")}`);
} else if (cmd === "sign") {
  const dir = arg;
  if (!dir || !existsSync(join(dir, "opennas-app.json"))) {
    console.error("usage: node opennas-sign.mjs sign <appdir> [keyfile]");
    process.exit(1);
  }
  const keyfile = keyArg || join(dir, KEYFILE_DEFAULT);
  if (!existsSync(keyfile)) {
    console.error(`No key at ${keyfile}. Run: node opennas-sign.mjs keygen ${keyfile}`);
    process.exit(1);
  }
  const privateKey = createPrivateKey(readFileSync(keyfile));
  const spkiB64 = createPublicKey(privateKey).export({ type: "spki", format: "der" }).toString("base64");

  // Put the publisher key in the manifest, then sign the whole package.
  const manifestPath = join(dir, "opennas-app.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.publisherKey = spkiB64;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  const files = collect(dir);
  const sig = edSign(null, digest(files), privateKey).toString("base64");
  writeFileSync(join(dir, "SIGNATURE"), sig + "\n");
  console.log(`Signed ${dir} → SIGNATURE written, publisherKey set in opennas-app.json.`);
  console.log("Now pack it (node pack.mjs) and install — it'll show the publisher fingerprint.");
} else {
  console.log("usage:\n  node opennas-sign.mjs keygen [keyfile]\n  node opennas-sign.mjs sign <appdir> [keyfile]");
}
