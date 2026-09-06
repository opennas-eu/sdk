#!/usr/bin/env node
/**
 * A dev server for this app — edit a file, hit refresh, see the change. No
 * repacking, no reinstalling.
 *
 *   node dev.mjs                       # serves this folder on :5174
 *   node dev.mjs 5180                  # ...on a different port
 *   node dev.mjs 5174 https://nas.lan  # ...against a NAS that isn't local
 *
 * Then in OpenNAS: App Center → Development apps → Add, with this URL and the
 * app id from opennas-app.json. It runs in the same sandbox and under the same
 * permission checks as an installed app; only the source of the files differs.
 *
 * Zero dependencies, like pack.mjs — nothing to install before you can work.
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(fileURLToPath(new URL(".", import.meta.url)));
const port = Number(process.argv[2] ?? 5174);
// Where to borrow the SDK from. Your app's HTML references /app-sdk/opennas.js
// exactly as it will once packaged; that file only exists on the OpenNAS
// origin, so this server fetches it from there and serves it under the same
// path. The markup is then identical in development and in the shipped package.
const opennas = (process.argv[3] ?? process.env.OPENNAS_URL ?? "http://localhost:5173").replace(/\/+$/, "");

let sdkCache = null;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/" || rel.endsWith("/")) rel += "index.html";

  // Serve only from this folder. normalize() collapses "..", and the prefix
  // check catches anything that still points outside.
  const target = resolve(here, "." + normalize(rel));
  if (target !== here && !target.startsWith(here + sep)) {
    res.writeHead(403).end("outside the app folder");
    return;
  }

  // The SDK, proxied from OpenNAS so the app can load it at the same path it
  // will use once installed.
  if (rel === "/app-sdk/opennas.js") {
    try {
      if (!sdkCache) {
        const upstream = await fetch(`${opennas}/app-sdk/opennas.js`);
        if (!upstream.ok) throw new Error(`HTTP ${upstream.status}`);
        sdkCache = Buffer.from(await upstream.arrayBuffer());
      }
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
      res.end(sdkCache);
    } catch (err) {
      process.stderr.write(`Could not fetch the SDK from ${opennas}: ${err.message}\n`);
      res.writeHead(502, { "content-type": "text/plain" });
      res.end(
        `Could not fetch the OpenNAS SDK from ${opennas}.\n` +
          "Pass your OpenNAS URL as the second argument:  node dev.mjs 5174 https://your-nas\n",
      );
    }
    return;
  }

  try {
    const info = await stat(target);
    if (info.isDirectory()) {
      res.writeHead(404).end("not found");
      return;
    }
    const body = await readFile(target);
    res.writeHead(200, {
      "content-type": TYPES[extname(target).toLowerCase()] ?? "application/octet-stream",
      // The whole point is that a refresh shows the edit, so never let the
      // browser (or the iframe) hold on to a previous version.
      "cache-control": "no-store, max-age=0",
    });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});

// Loopback only — this is your machine's source tree, not a web host, and
// OpenNAS will not accept a development app on any other address.
server.listen(port, "127.0.0.1", () => {
  process.stdout.write(
    `Serving ${here}\n  → http://localhost:${port}\n` +
      `  SDK from ${opennas}\n\n` +
      "Add it in OpenNAS: App Center → Development apps → Add.\n" +
      "Edit a file and refresh the app window to see the change.\n",
  );
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    process.stderr.write(`Port ${port} is already in use. Try: node dev.mjs ${port + 1}\n`);
    process.exit(1);
  }
  throw err;
});
