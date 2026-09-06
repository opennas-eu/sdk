#!/usr/bin/env node
/**
 * create-opennas-app — scaffold a new OpenNAS app.
 *
 *   npm create opennas-app my-app
 *   npx create-opennas-app my-app --perms notifications,storage --yes
 *
 * Writes a ready-to-pack app folder: manifest, entry page, icon, README and a
 * `pack.mjs` that builds the `.onpkg`, and a `dev.mjs` live-reload server —
 * neither with any dependencies to install.
 */
import { createInterface } from "node:readline/promises";
import { cp, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stdin, stdout } from "node:process";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = join(HERE, "template");

const PERMISSIONS = ["notifications", "storage", "user", "files", "system", "fetch", "schedule"];
const CATEGORIES = ["system", "utilities", "media", "productivity", "developer"];
const ID_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const HOST_RE = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-y" || a === "--yes") opts.yes = true;
    else if (a === "-h" || a === "--help") opts.help = true;
    else if (a === "--force") opts.force = true;
    else if (a.startsWith("--")) {
      const [key, inline] = a.slice(2).split("=");
      opts[key] = inline ?? argv[++i];
    } else opts._.push(a);
  }
  return opts;
}

function usage() {
  return `create-opennas-app — scaffold a new OpenNAS app

Usage
  create-opennas-app [directory] [options]

Options
  --id <id>              App id: lowercase a-z 0-9 . _ - (default: from directory)
  --name <name>          Display name
  --author <author>      Publisher name
  --description <text>   One-line description
  --category <cat>       ${CATEGORIES.join(" | ")}
  --perms <csv>          ${PERMISSIONS.join(",")}
  --hosts <csv>          Hosts the fetch proxy may reach (required with --perms fetch),
                         e.g. api.example.com,*.example.org
  --force                Write into a non-empty directory
  -y, --yes              Don't prompt; use defaults for anything not given
  -h, --help             Show this

Examples
  create-opennas-app disk-widget --id com.me.diskwidget --perms system --yes
  create-opennas-app weather --perms fetch --hosts api.open-meteo.com --yes
`;
}

/** "My Cool App" / "my-cool-app" → "my-cool-app" */
function slug(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** "my-cool-app" → "My Cool App" */
function titleCase(text) {
  return String(text)
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

function parsePerms(value) {
  if (!value) return [];
  const list = String(value)
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  const bad = list.filter((p) => !PERMISSIONS.includes(p));
  if (bad.length > 0) {
    throw new Error(`Unknown permission(s): ${bad.join(", ")}. Valid: ${PERMISSIONS.join(", ")}`);
  }
  return [...new Set(list)];
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    stdout.write(usage());
    return;
  }

  const interactive = stdin.isTTY && !opts.yes;
  const rl = interactive ? createInterface({ input: stdin, output: stdout }) : null;
  const ask = async (question, fallback) => {
    if (!rl) return fallback;
    const answer = (await rl.question(`${question}${fallback ? ` (${fallback})` : ""}: `)).trim();
    return answer || fallback;
  };

  try {
    const dirName = opts._[0] ?? (await ask("Directory", "my-opennas-app"));
    const target = resolve(process.cwd(), dirName);

    if (existsSync(target) && !opts.force) {
      const entries = await readdir(target);
      if (entries.length > 0) {
        throw new Error(`${target} already exists and isn't empty. Pass --force to write into it anyway.`);
      }
    }

    const defaultName = titleCase(dirName);
    const name = opts.name ?? (await ask("App name", defaultName));
    const defaultId = `com.example.${slug(dirName)}`;
    const id = opts.id ?? (await ask("App id", defaultId));
    if (!ID_RE.test(id)) {
      throw new Error(`Invalid app id "${id}". Use lowercase letters, digits, '.', '_' or '-' (2-64 chars).`);
    }
    const author = opts.author ?? (await ask("Author", ""));
    const description = opts.description ?? (await ask("Description", `${name} for OpenNAS.`));
    const category = opts.category ?? (await ask(`Category [${CATEGORIES.join("/")}]`, "utilities"));
    if (!CATEGORIES.includes(category)) {
      throw new Error(`Invalid category "${category}". Valid: ${CATEGORIES.join(", ")}`);
    }
    const permissions = parsePerms(
      opts.perms ?? (await ask(`Permissions [${PERMISSIONS.join("/")}], comma-separated`, "notifications,storage")),
    );

    // "fetch" is only meaningful with a host list — the manifest requires one,
    // so ask for it rather than scaffolding an app that won't install.
    let fetchHosts = [];
    if (permissions.includes("fetch")) {
      const raw = opts.hosts ?? (await ask("Hosts it may contact (comma-separated)", ""));
      fetchHosts = String(raw)
        .split(",")
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean);
      if (fetchHosts.length === 0) {
        throw new Error('The "fetch" permission needs at least one host — pass --hosts api.example.com');
      }
      const badHost = fetchHosts.find((h) => !HOST_RE.test(h) || !h.includes("."));
      if (badHost) throw new Error(`"${badHost}" isn't a valid host or *.host pattern.`);
    } else if (opts.hosts) {
      throw new Error('--hosts needs --perms fetch');
    }

    await mkdir(target, { recursive: true });
    await cp(TEMPLATE, target, { recursive: true });
    // npm rewrites a literal .gitignore inside a published package, so the
    // template ships it under a plain name and it gets restored here.
    await rename(join(target, "gitignore"), join(target, ".gitignore"));

    const manifest = {
      manifestVersion: 1,
      id,
      name,
      version: "1.0.0",
      author,
      description,
      icon: "icon.svg",
      iconGradient: "from-sky-400 to-blue-600",
      category,
      entry: "index.html",
      minRole: "user",
      permissions,
      ...(fetchHosts.length > 0 ? { fetchHosts } : {}),
      // A worked example of the settings panel: OpenNAS renders the form for
      // these, and the app reads the chosen values with app.settings.all().
      settings: [
        {
          key: "greeting",
          label: "Greeting",
          type: "text",
          default: "Hello",
          description: "Shown at the top of the app.",
        },
        {
          key: "compact",
          label: "Compact layout",
          type: "boolean",
          default: false,
        },
      ],
      window: { defaultWidth: 760, defaultHeight: 560, minWidth: 420, minHeight: 320, resizable: true },
    };
    await writeFile(join(target, "opennas-app.json"), `${JSON.stringify(manifest, null, 2)}\n`);

    // Substitute the placeholders the template leaves for us.
    for (const file of ["index.html", "README.md"]) {
      const path = join(target, file);
      const filled = (await readFile(path, "utf8"))
        .replaceAll("__APP_NAME__", name)
        .replaceAll("__APP_ID__", id)
        .replaceAll("__APP_DESCRIPTION__", description);
      await writeFile(path, filled);
    }

    stdout.write(
      [
        "",
        `  Created ${name} in ${target}`,
        "",
        `  id           ${id}`,
        `  permissions  ${permissions.length > 0 ? permissions.join(", ") : "(none)"}`,
        ...(fetchHosts.length > 0 ? [`  hosts        ${fetchHosts.join(", ")}`] : []),
        "",
        "  Next:",
        `    cd ${dirName}`,
        "    node dev.mjs           # live dev server on http://localhost:5174",
        "    node pack.mjs          # → .onpkg (no dependencies to install)",
        "",
        "  While developing: App Center → Development apps → Add, with the URL",
        "  above and this app's id. Then edit a file and refresh the window.",
        "  When you're done, pack it and drag the .onpkg into App Center.",
        "",
      ].join("\n"),
    );
  } finally {
    rl?.close();
  }
}

main().catch((err) => {
  process.stderr.write(`\n  ${err instanceof Error ? err.message : String(err)}\n\n`);
  process.exit(1);
});
