// Packs this folder into an OpenNAS app package (.onpkg).
//
//   node pack.mjs        →  <id>-<version>.onpkg
//
// No dependencies: a .onpkg is a plain ZIP, and this writes one with entries
// stored (uncompressed), which every unzipper — including OpenNAS's — accepts.
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// Never shipped inside a package. *.key is the publisher's PRIVATE signing key —
// it must never end up in an archive. SIGNATURE, if present, IS shipped.
// dev.mjs is tooling for the author, not part of the app — shipping it would
// put a file server inside every installed copy.
const SKIP = new Set(["pack.mjs", "dev.mjs", "package.json", "README.md", "node_modules", ".git", ".gitignore"]);

function collect(dir, base = dir) {
  const out = {};
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name) || name.endsWith(".onpkg") || name.endsWith(".key")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) Object.assign(out, collect(full, base));
    else out[relative(base, full).split(sep).join("/")] = readFileSync(full);
  }
  return out;
}

// ---- Minimal ZIP writer (stored entries) -----------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** DOS date/time fields for one Date. */
function dosStamp(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2) & 0x1f);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time: time & 0xffff, date: date & 0xffff };
}

function zip(files) {
  const { time, date } = dosStamp(new Date());
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const name of Object.keys(files).sort()) {
    const content = files[name];
    const nameBytes = Buffer.from(name, "utf8");
    const crc = crc32(content);

    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(content.length, 18); // compressed size
    local.writeUInt32LE(content.length, 22); // uncompressed size
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    nameBytes.copy(local, 30);
    locals.push(local, content);

    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0); // central directory signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(0, 10); // method: stored
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30); // extra length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE(0, 38); // external attributes
    central.writeUInt32LE(offset, 42); // offset of local header
    nameBytes.copy(central, 46);
    centrals.push(central);

    offset += local.length + content.length;
  }

  const centralDir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  end.writeUInt16LE(0, 4); // this disk
  end.writeUInt16LE(0, 6); // disk with central directory
  end.writeUInt16LE(centrals.length, 8); // entries on this disk
  end.writeUInt16LE(centrals.length, 10); // total entries
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16); // central directory offset
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...locals, centralDir, end]);
}

// ---- Pack ------------------------------------------------------------------

const manifest = JSON.parse(readFileSync(join(here, "opennas-app.json"), "utf8"));
const files = collect(here);
if (!files["opennas-app.json"]) throw new Error("opennas-app.json is missing");
if (!files[manifest.entry]) throw new Error(`entry "${manifest.entry}" is not in the package`);
if (!files[manifest.icon]) throw new Error(`icon "${manifest.icon}" is not in the package`);

const archive = zip(files);
const outName = `${manifest.id}-${manifest.version}.onpkg`;
writeFileSync(join(here, outName), archive);
console.log(`Packed ${Object.keys(files).length} files → ${outName} (${archive.length} bytes)`);
