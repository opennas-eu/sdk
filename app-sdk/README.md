# @opennas/app-sdk — build apps for OpenNAS

An OpenNAS app is a small web app (HTML/JS/CSS — any framework, or none) that runs
on the OpenNAS desktop inside a **sandboxed iframe**. It can't touch OpenNAS
directly; it talks to the desktop through this SDK, and only gets the capabilities
its manifest declares and the admin granted at install time. Build it, pack it into
a `.onpkg`, and install it from **App Center**.

## 1. Project layout

The fastest way to get all of this is the scaffolder — it writes the manifest,
entry page, icon and a zero-dependency packer for you:

```sh
npm create opennas-app my-app
# or non-interactively:
npx create-opennas-app my-app --perms notifications,storage --yes
```

Either way the shape is just:

```
my-app/
  opennas-app.json    # the manifest (required, at the package root)
  index.html          # your entry (loads the SDK)
  pack.mjs            # builds the .onpkg
  …any other assets
```

## 2. The manifest — `opennas-app.json`

```json
{
  "manifestVersion": 1,
  "id": "com.me.todo",          // unique, lowercase: a-z 0-9 . _ -
  "name": "Todo",
  "version": "1.0.0",
  "author": "Me",
  "description": "A little task list.",
  "icon": "icon.png",            // a packaged image, OR a lucide name like "StickyNote"
  "iconGradient": "from-sky-400 to-blue-600",
  "category": "productivity",    // system | utilities | media | productivity | developer
  "entry": "index.html",
  "minRole": "user",             // user | admin
  "permissions": ["notifications", "storage"],
  "fetchHosts": [],              // required if you request "fetch": ["api.example.com", "*.example.org"]
  "window": { "defaultWidth": 760, "defaultHeight": 560, "minWidth": 420, "minHeight": 320, "resizable": true }
}
```

Permissions: **`notifications`** (post to the bell), **`storage`** (per-app,
per-user key/value store), **`user`** (read the signed-in user's name/role),
**`files`** (a private per-app, per-user file folder on the NAS), **`system`**
(read-only CPU/memory/storage/network stats), **`fetch`** (outbound HTTP to hosts
you list) and **`schedule`** (background work while your app is closed). Request only what you use — anything not declared is denied, and
an admin reviews the list before the app installs, so a shorter list installs more
easily. The theme and window controls need no permission.

**`fetch` needs `fetchHosts`.** There's no "any host" option: you declare the
hosts up front (`api.example.com`, or `*.example.org` for subdomains — the
wildcard does *not* cover the bare domain, so list it too if you need it), and the
admin sees exactly that list when approving the install. Max 10 hosts.

### Custom icon

`icon` can be either:

- **A packaged image** — `"icon.png"`, `"icon.svg"`, etc. Ship the file in your
  package (PNG / SVG / JPG / WEBP / GIF / ICO / AVIF) and reference it by its
  relative path. This is the recommended way to give your app a unique look —
  the example app uses `icon.svg`.
- **A built-in [lucide](https://lucide.dev) name** — `"StickyNote"`, `"Rocket"`,
  … — rendered with the `iconGradient` behind it (Tailwind gradient classes).

A packaged icon is shown everywhere your app appears: the desktop, launcher,
window title — and, once published, on the **repository's web catalogue**
(the repo extracts it from your package and serves it). Keep it square (≈64–512px)
for crisp scaling.

### Screenshots

Ship screenshots to give your app a proper **detail page** — they show up in the
OS App Center (click an app) and on the repository's web catalogue. Add the image
files to your package and list them in the manifest:

```json
"screenshots": ["screenshot-1.png", "screenshot-2.png"]
```

Up to 8 images (PNG / JPG / WEBP / SVG); ~16:10 landscape looks best. They're
optional — apps without screenshots just show their description.

## 3. Use the SDK

Load the hosted SDK (served by every OpenNAS at a stable path) and call `ready()`:

```html
<script src="/app-sdk/opennas.js"></script>
<script>
  (async () => {
    const app = await OpenNAS.ready();

    app.host;            // { version, theme }
    app.app;             // { id, name, permissions }
    app.theme;           // "light" | "dark"
    app.onThemeChange(t => document.documentElement.dataset.theme = t);

    // needs "user"
    app.user;            // { id, username, displayName, role } | null

    // needs "storage"
    await app.storage.set("count", "1");
    await app.storage.get("count");       // → "1" | null
    await app.storage.list();             // → { count: "1", … }
    await app.storage.delete("count");

    // needs "files" — a private folder scoped to this app + user
    await app.files.write("notes/today.txt", "hello");
    await app.files.read("notes/today.txt");   // → "hello" | null
    await app.files.list("notes");             // → [{ name, type, sizeBytes, modifiedAt }]
    await app.files.mkdir("photos");
    await app.files.delete("notes/today.txt");

    // needs "notifications"
    app.notify({ title: "Done!", body: "Task saved", level: "success" });

    // needs "fetch" — OpenNAS makes the request for you
    const res = await app.fetch("https://api.example.com/things", {
      method: "POST",                                 // GET/HEAD/POST/PUT/PATCH/DELETE
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hello: "world" }),
    });
    res.ok;        // status 200-299
    res.status;    // upstream status — a 404 comes back as a result, not an error
    res.json();    // parse the body as JSON
    res.body;      // text as-is; binary arrives base64 (check res.encoding)

    // needs "schedule" — OpenNAS does this while your app is closed
    await app.schedule.set("digest", 86400, {         // seconds; minimum 900
      kind: "notify", title: "Daily digest", body: "3 new items",
    });
    await app.schedule.set("refresh", 3600, {
      kind: "fetch", url: "https://api.example.com/x", storeAs: "latest",
    });
    await app.schedule.list();                        // → [{ name, nextRunAt, lastStatus, … }]
    await app.schedule.delete("digest");

    // needs "system" — read-only machine stats, sampled at most once a second
    const sys = await app.system.info();
    sys.cpu.loadPercent;        // 0-100 overall
    sys.cpu.perCorePercent;     // [12.5, 3.1, …]
    sys.cpu.temperatureC;       // °C, or null
    sys.memory;                 // { totalBytes, usedBytes, freeBytes }
    sys.storage;                // totals across data volumes
    sys.network;                // { rxBytesPerSec, txBytesPerSec }
    sys.os;                     // { platform, distro, release, arch }
    sys.uptimeSeconds;

    app.setTitle("Todo — 3 items");       // window title bar
    app.close();                          // close my window
  })();
})
</script>
```

TypeScript projects can instead `npm i @opennas/app-sdk` and
`import { ready } from "@opennas/app-sdk"`.

### What the fetch proxy will refuse

Requests are made by OpenNAS, not your app, so they're constrained:

- a host that isn't in your `fetchHosts`, **including after a redirect** — every
  hop is re-checked;
- any host that resolves to a private, loopback, link-local or otherwise
  non-public address, so an app can't reach the NAS itself or the LAN;
- schemes other than `http`/`https`, URLs with embedded credentials, methods
  outside the six listed, and `host`/`cookie`/hop-by-hop headers;
- bodies over 1 MB, responses over 5 MB, anything slower than 15s, more than
  3 redirects, and more than 120 requests a minute per app.

No cookies or OpenNAS credentials are ever attached — every request is built from
scratch from what you passed.

### Scheduling, and why it looks like this

Your app is a sandboxed iframe, so when a task falls due **your code isn't
running** — OpenNAS performs the action for you. That's the whole reason an
action is a small declarative object rather than a callback, and why the only
actions are ones OpenNAS can already do on your behalf:

- `notify` — needs `notifications`, and lands in the notification centre whether
  or not anyone is signed in at the time;
- `fetch` — needs `fetch` + `storage`; the response is saved under `storeAs`, so
  it's already waiting in `app.storage` next time someone opens your app.

Scheduling grants nothing new: every action is re-checked against your
permissions **when it runs**, not just when you registered it. Tasks are per-user
and keyed by `name` (re-registering updates in place), minimum interval 15
minutes, maximum 10 per app. They're deleted when your app is uninstalled.

## 4. Pack & install

Zip the package (the manifest must sit at the **root** of the archive) with a
`.onpkg` extension, then drag it into **App Center** (admins only). See
[`examples/hello-app`](../../examples/hello-app) for a complete app plus a
`pack.mjs` script you can copy:

```sh
node examples/hello-app/pack.mjs   # → hello-opennas-1.0.0.onpkg
```

## 5. Signing (optional, recommended)

Sign your app so it installs as a **verified** publisher instead of showing an
"Unverified app" warning:

```sh
node opennas-sign.mjs keygen my-app/publisher.key   # one-time: your ed25519 key
node opennas-sign.mjs sign my-app                    # sets publisherKey + writes SIGNATURE
node my-app/pack.mjs                                 # pack (the private *.key is never included)
```

On install OpenNAS verifies the signature and shows the publisher key fingerprint;
an admin can then **Trust publisher** in App Center to mark it verified. Keep
`publisher.key` secret and out of version control.

## 6. Notes

- Your app runs in an opaque origin: it **cannot** read OpenNAS cookies, the
  desktop DOM, or other apps. The SDK is the only bridge.
- Use relative URLs for your own assets; load the SDK from the absolute
  `/app-sdk/opennas.js`.
- Match the desktop look by reacting to `app.theme` / `onThemeChange`.

## Big files and binary data

`read`/`write` carry a string through the desktop and are capped at a few
megabytes — fine for a document, useless for a photo. For anything else, and for
anything large, use the binary pair:

```js
// A file the user dropped on your window
await app.files.writeBinary("photos/holiday.jpg", file, {
  onProgress: (done, total) => bar.value = total ? done / total : 0,
});

const blob = await app.files.readBinary("photos/holiday.jpg");
if (blob) img.src = URL.createObjectURL(blob);
```

Bytes travel as a `Blob`, which the browser keeps in its own store rather than in
your page's memory — so a 400 MB video costs you an object, not 400 MB of heap.
Pass a `File` straight from an `<input>` or a drop event; a `Blob`, `ArrayBuffer`
or typed array works too. `readBinary` returns `null` when there's no such file.

The same pair exists on `shares`, for folders the user picked:

```js
const grant = await app.shares.pick({ select: "dir", mode: "readwrite" });
if (grant) {
  await app.shares.writeBinary("export.zip", zipBlob, { in: grant.handle });
}
```

To let the user **save** a file to their own computer, ask OpenNAS to hand it to
the browser — your iframe is sandboxed without download permission on purpose,
so an app can't start a download nobody asked for:

```js
await app.files.save("photos/holiday.jpg");          // uses the file's own name
await app.shares.save("report.pdf", { in: grant.handle }, "Q3 report.pdf");
```

Two limits worth knowing. One file in your **private** storage may be up to
512 MB, because that storage lives on the partition OpenNAS itself runs from —
files that belong to the *user* belong in their shares, where their own storage
and quota apply and no such cap exists. And `onProgress` stops firing the moment
the promise settles, so a progress bar can be torn down in a `finally` without
racing a last event.

Downloads support range requests, so you can point a `<video>` or `<audio>` at a
blob URL and seeking works rather than pulling the whole file to play the end.

## Publishing (coming soon)

A future release adds an App Store: publish a `.onpkg` to a catalog and let other
OpenNAS users install it (and receive updates) with one click. The manifest and
package format above are forward-compatible with it.

## Licence

This SDK is **MIT** ([`LICENSE`](./LICENSE)), and so is everything
`create-opennas-app` generates. OpenNAS itself is GPL-3.0-or-later, but that
stops at the sandbox boundary: your app is a separate program that talks to the
desktop over `postMessage`, and the piece you actually import is deliberately
permissive. **Your app is yours** — ship it under any licence you like, including
none at all.
