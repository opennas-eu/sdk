/**
 * @opennas/app-sdk — the client SDK an OpenNAS app loads to talk to the desktop.
 *
 * An OpenNAS app is a sandboxed web app running inside an iframe (opaque origin).
 * It can't touch OpenNAS directly; instead it exchanges `postMessage`s with the
 * host desktop, which enforces the permissions declared in the app's manifest.
 * This SDK wraps that protocol in a small promise-based API.
 *
 *   <script src="/app-sdk/opennas.js"></script>
 *   <script>
 *     const app = await OpenNAS.ready();
 *     app.notify({ title: "Hello!" });          // needs "notifications" permission
 *     await app.storage.set("count", "1");       // needs "storage" permission
 *   </script>
 */

export type Theme = "light" | "dark";
export type NotifyLevel = "info" | "success" | "warning" | "critical";

export interface HostInfo {
  /** OpenNAS version. */
  version: string;
  /** Current desktop theme. Also available via `app.theme`. */
  theme: Theme;
}

/** A folder or file the user handed to this app through the OpenNAS picker. */
export interface ShareGrant {
  /** Pass this back as `in` on shares calls. */
  handle: string;
  /** Where it is, for showing the user. */
  path: string;
  name: string;
  type: "file" | "dir";
  mode: "read" | "readwrite";
  createdAt: string;
  lastUsedAt: string | null;
}

/** One entry inside a shared folder. */
export interface ShareEntry {
  name: string;
  type: "file" | "dir";
  sizeBytes: number;
  modifiedAt: string;
  mime: string | null;
  /** Whether this app may write here — grey the action out rather than failing. */
  writable: boolean;
}

export interface ShareListing {
  path: string;
  entries: ShareEntry[];
  writable: boolean;
}

/** Where a shares call should look. Omit `in` to use a manifest-granted path. */
export interface ShareRef {
  /** A grant handle from `shares.pick()`; paths are then relative to it. */
  in?: string;
}

export interface DialogOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as destructive. */
  danger?: boolean;
}

export interface PromptDialogOptions extends DialogOptions {
  defaultValue?: string;
  placeholder?: string;
}

export interface AppInfo {
  id: string;
  name: string;
  permissions: string[];
}

/** The signed-in user — present only if the app holds the "user" permission. */
export interface AppUser {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "user";
}

/**
 * A read-only snapshot of the machine ("system" permission).
 *
 * Narrower than what the OpenNAS dashboard shows: no hostname, no process list,
 * and storage/network are totals rather than per-mount and per-interface.
 */
export interface SystemInfo {
  os: { platform: string; distro: string; release: string; arch: string };
  cpu: {
    brand: string;
    cores: number;
    /** Overall load, 0-100. */
    loadPercent: number;
    /** Per-core load, 0-100. */
    perCorePercent: number[];
    /** Package temperature in °C, or null when unreadable. */
    temperatureC: number | null;
  };
  memory: { totalBytes: number; usedBytes: number; freeBytes: number };
  /** Totalled across data volumes. */
  storage: { totalBytes: number; usedBytes: number; freeBytes: number };
  /** Totalled across network interfaces. */
  network: { rxBytesPerSec: number; txBytesPerSec: number };
  uptimeSeconds: number;
  /** OpenNAS version. */
  version: string;
}

/** Options for `app.fetch()` ("fetch" permission). */
export interface FetchOptions {
  /** GET (default), HEAD, POST, PUT, PATCH or DELETE. */
  method?: string;
  /** Extra headers. `host`, `cookie` and hop-by-hop headers are dropped. */
  headers?: Record<string, string>;
  /** Request body, max 1 MB. Ignored for GET/HEAD. */
  body?: string;
}

/** The result of `app.fetch()`. */
export interface FetchResult {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  /** Text responses as-is; binary comes back base64 — check `encoding`. */
  body: string;
  encoding: "utf8" | "base64";
  /** The final URL, which differs from the request if redirects were followed. */
  url: string;
  /** Convenience: `status` in the 200-299 range. */
  ok: boolean;
  /** Parse the body as JSON. Throws if it isn't JSON. */
  json<T = unknown>(): T;
}

/**
 * What OpenNAS should do when a scheduled task falls due ("schedule" permission).
 *
 * Your app is a sandboxed iframe, so it isn't running when the task fires —
 * OpenNAS performs the action for you. That's why an action can only be
 * something your app is already allowed to do.
 */
export type ScheduledAction =
  /** Post a notification. Also needs "notifications". */
  | { kind: "notify"; title: string; body?: string; level?: NotifyLevel }
  /**
   * Fetch a URL from your `fetchHosts` and save the response body under
   * `storeAs` in your storage, ready for the next time the app opens.
   * Also needs "fetch" and "storage".
   */
  | { kind: "fetch"; url: string; method?: string; headers?: Record<string, string>; storeAs: string };

/** A task you registered. */
export interface ScheduledTask {
  id: string;
  name: string;
  intervalSeconds: number;
  action: ScheduledAction;
  enabled: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  lastStatus: "ok" | "error" | null;
  lastError: string | null;
  createdAt: string;
}

/** An entry in the app's private data folder ("files" permission). */
export interface AppFileEntry {
  name: string;
  type: "file" | "dir";
  sizeBytes: number;
  modifiedAt: string;
}

/**
 * Called as bytes move. `total` is 0 when the size isn't known in advance.
 *
 * Fires only while the transfer is running: once the promise settles, it stops,
 * so a progress bar can be torn down in a `finally` without racing a last event.
 */
export type TransferProgress = (loaded: number, total: number) => void;

export interface TransferOptions {
  onProgress?: TransferProgress;
}

export interface NotifyOptions {
  title: string;
  body?: string;
  level?: NotifyLevel;
}

const PROTOCOL = 1 as const;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

let seq = 0;
const pending = new Map<number, Pending>();
const themeListeners = new Set<(t: Theme) => void>();
const closeHandlers = new Set<() => boolean | Promise<boolean>>();

let hostInfo: HostInfo = { version: "", theme: "light" };
let appInfo: AppInfo = { id: "", name: "", permissions: [] };
let appUser: AppUser | null = null;
let theme: Theme = "light";
let readyPromise: Promise<OpenNASApp> | null = null;

function post(type: string, payload: unknown, onProgress?: TransferProgress): Promise<unknown> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    if (onProgress) progressListeners.set(id, onProgress);
    // Origin is opaque inside the sandbox, so the host validates by source.
    window.parent.postMessage({ __opennas: PROTOCOL, id, type, payload }, "*");
  });
}

/**
 * Progress callbacks, keyed by the request they belong to.
 *
 * Kept out of `pending` because they are cleared on a different schedule: the
 * promise settles once, and the callback has to stop firing at exactly that
 * moment or a slow last chunk arrives after the caller thinks it is done.
 */
const progressListeners = new Map<number, TransferProgress>();

if (typeof window !== "undefined") {
  window.addEventListener("message", (e: MessageEvent) => {
    const d = e.data as
      | { __opennas?: number; id?: number; ok?: boolean; result?: unknown; error?: string; event?: string; payload?: unknown }
      | null;
    if (!d || d.__opennas !== PROTOCOL) return;

    if (d.event === "beforeClose") {
      // The host is asking whether this window may close. Every registered
      // handler has to agree; anything that throws is treated as "don't know",
      // which must not be a veto.
      const requestId = (d.payload as { requestId?: number } | undefined)?.requestId;
      void (async () => {
        let allow = true;
        for (const fn of closeHandlers) {
          try {
            if ((await fn()) === false) { allow = false; break; }
          } catch {
            /* a broken handler doesn't get to keep the window open */
          }
        }
        window.parent.postMessage({ __opennas: PROTOCOL, beforeCloseReply: requestId, allow }, "*");
      })();
      return;
    }
    if (d.event === "theme") {
      theme = d.payload === "dark" ? "dark" : "light";
      hostInfo = { ...hostInfo, theme };
      themeListeners.forEach((fn) => fn(theme));
      return;
    }
    if (d.event === "progress") {
      const { id, loaded, total } = (d.payload ?? {}) as { id?: number; loaded?: number; total?: number };
      if (typeof id === "number") {
        try {
          progressListeners.get(id)?.(loaded ?? 0, total ?? 0);
        } catch {
          /* a throwing progress callback must not break the transfer */
        }
      }
      return;
    }
    if (typeof d.id === "number" && pending.has(d.id)) {
      const p = pending.get(d.id)!;
      pending.delete(d.id);
      // Stop before settling, so nothing fires after the caller has its answer.
      progressListeners.delete(d.id);
      if (d.ok) p.resolve(d.result);
      else p.reject(new Error(d.error || "Request failed"));
    }
  });
}

export interface OpenNASApp {
  /** Host (desktop) info — version + current theme. */
  readonly host: HostInfo;
  /** This app's id, name and granted permissions. */
  readonly app: AppInfo;
  /** The signed-in user — null unless the app holds the "user" permission. */
  readonly user: AppUser | null;
  /** Current theme. */
  readonly theme: Theme;
  /** Subscribe to theme changes; returns an unsubscribe fn. */
  onThemeChange(fn: (theme: Theme) => void): () => void;
  /** Post a notification to the OpenNAS notification center. Needs "notifications". */
  notify(options: NotifyOptions): Promise<void>;
  /** Per-app, per-user key/value storage (persisted server-side). Needs "storage". */
  /**
   * Values for the settings your manifest declares. OpenNAS renders the form
   * for them, so this is read-only — the user changes them in App Center, and
   * you read what they chose.
   */
  settings: {
    all(): Promise<Record<string, string | number | boolean>>;
  };
  storage: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
    list(): Promise<Record<string, string>>;
  };
  /**
   * Private per-app, per-user file storage on the NAS. Needs "files".
   *
   * `read`/`write` are for text and are capped at a few megabytes — they carry
   * the content as a string through the desktop. For anything else, and for
   * anything big, use the binary pair:
   *
   *   // A file the user dropped on your window
   *   await app.files.writeBinary("photos/holiday.jpg", file, {
   *     onProgress: (done, total) => setPercent(total ? (done / total) * 100 : 0),
   *   });
   *
   *   const blob = await app.files.readBinary("photos/holiday.jpg");
   *   if (blob) img.src = URL.createObjectURL(blob);
   *
   * Bytes travel as a `Blob`, which the browser keeps in its own store rather
   * than in your page's memory — so a large file costs you an object, not a
   * hundred megabytes of heap. Pass a `File` straight from an `<input>` or a
   * drop event; a `Blob`, `ArrayBuffer` or typed array works too.
   *
   * One file here is capped at 512 MB, because this storage lives on the
   * partition OpenNAS itself runs from. Files that belong to the *user* belong
   * in their shares — see `shares`, where their own storage and quota apply.
   */
  files: {
    list(path?: string): Promise<AppFileEntry[]>;
    /** Contents as text, or null if there's no such file. For text; a few MB max. */
    read(path: string): Promise<string | null>;
    write(path: string, content: string): Promise<void>;
    /** Contents as a Blob, or null if there's no such file. Any type, any size. */
    readBinary(path: string, options?: TransferOptions): Promise<Blob | null>;
    /** Write bytes. Accepts a File, Blob, ArrayBuffer or typed array. */
    writeBinary(path: string, data: Blob | ArrayBuffer | ArrayBufferView, options?: TransferOptions): Promise<void>;
    /**
     * Hand a file to the browser for the user to save.
     *
     * OpenNAS starts the download, not your iframe — which is sandboxed without
     * download permission on purpose, so an app can't start one nobody asked
     * for. Resolves false if there's no such file.
     */
    save(path: string, filename?: string): Promise<boolean>;
    mkdir(path: string): Promise<void>;
    delete(path: string): Promise<void>;
  };
  /**
   * Make an outbound HTTP request through OpenNAS. Needs "fetch", and the host
   * must match a pattern in your manifest's `fetchHosts` — OpenNAS refuses
   * anything else, along with any host that resolves to a private or loopback
   * address.
   *
   *   const res = await app.fetch("https://api.example.com/things");
   *   if (res.ok) console.log(res.json());
   */
  fetch(url: string, options?: FetchOptions): Promise<FetchResult>;
  /**
   * Background work OpenNAS performs while your app is closed. Needs "schedule",
   * plus whatever the action itself needs.
   *
   *   await app.schedule.set("refresh", 3600, {
   *     kind: "fetch", url: "https://api.example.com/x", storeAs: "latest",
   *   });
   *
   * Tasks are per-user and keyed by `name`, so re-registering one on every launch
   * updates it in place rather than piling up. Minimum interval is 15 minutes.
   */
  schedule: {
    list(): Promise<ScheduledTask[]>;
    /** Register or update a task. `intervalSeconds` must be >= 900. */
    set(name: string, intervalSeconds: number, action: ScheduledAction, enabled?: boolean): Promise<ScheduledTask>;
    delete(name: string): Promise<void>;
  };
  /**
   * The user's **real shared folders** — not the private sandbox `files` gives
   * you.
   *
   * There are two ways in, and picking is the one to reach for:
   *
   *   // Ask for one folder. Needs no permission at all; the user chooses it in
   *   // OpenNAS's own picker and you get back only what they picked.
   *   const grant = await app.shares.pick({ select: "dir", mode: "readwrite" });
   *   if (!grant) return;                       // they said no — that's normal
   *   const items = await app.shares.list(".", { in: grant.handle });
   *   await app.shares.write("notes.txt", "hi", { in: grant.handle });
   *
   *   // Or, with "shares:read" in your manifest, browse everywhere they can:
   *   const shares = await app.shares.list("/");
   *
   * With a grant handle, paths are **relative to the granted folder** and can't
   * climb out of it. Without one, they're absolute paths like "/Photos/2024".
   *
   * A grant never gives you more than the user has: OpenNAS re-checks their own
   * access on every call, so a folder can go read-only or vanish underneath you.
   * Always handle `writable` being false rather than assuming.
   */
  shares: {
    /** Ask the user for a file or folder. Resolves null if they cancel. */
    pick(options?: { select?: "file" | "dir"; mode?: "read" | "readwrite"; title?: string }): Promise<ShareGrant | null>;
    /** Everything this app currently holds for this user. */
    grants(): Promise<ShareGrant[]>;
    /** Hand a grant back. Good manners when you're done with a folder. */
    revoke(handle: string): Promise<ShareGrant[]>;
    list(path?: string, ref?: ShareRef): Promise<ShareListing>;
    /** File contents as text, or null if it isn't a readable file. Max 4 MB. */
    read(path: string, ref?: ShareRef): Promise<string | null>;
    write(path: string, content: string, ref?: ShareRef): Promise<void>;
    /**
     * File contents as a Blob — any type, any size. Null if there's no such file.
     *
     *   const grant = await app.shares.pick({ select: "file" });
     *   if (grant) {
     *     const blob = await app.shares.readBinary(".", { in: grant.handle });
     *     audio.src = URL.createObjectURL(blob!);
     *   }
     */
    readBinary(path: string, ref?: ShareRef, options?: TransferOptions): Promise<Blob | null>;
    /**
     * Write bytes into a folder the user gave you. Needs write access on the
     * grant — check `writable` rather than assuming, since a folder can go
     * read-only underneath you.
     */
    writeBinary(
      path: string,
      data: Blob | ArrayBuffer | ArrayBufferView,
      ref?: ShareRef,
      options?: TransferOptions,
    ): Promise<void>;
    /** Hand the file to the browser for the user to save. False if it's missing. */
    save(path: string, ref?: ShareRef, filename?: string): Promise<boolean>;
    mkdir(path: string, ref?: ShareRef): Promise<void>;
    delete(path: string, ref?: ShareRef): Promise<void>;
  };
  /**
   * Dialogs drawn by OpenNAS rather than by you.
   *
   * They match the desktop and sit above your window, so they read as the system
   * asking rather than as your page. `prompt` is text-only on purpose — an app
   * must never be able to put up something that looks like OpenNAS asking for
   * the user's password.
   */
  dialog: {
    alert(message: string, options?: DialogOptions): Promise<void>;
    confirm(message: string, options?: DialogOptions): Promise<boolean>;
    prompt(message: string, options?: PromptDialogOptions): Promise<string | null>;
  };
  /** Show a count on this app's taskbar button. Pass null (or 0) to clear it. */
  setBadge(count: number | null): Promise<void>;
  /** Ask for a window size in CSS pixels. OpenNAS clamps it to what fits. */
  requestSize(size: { width: number; height: number }): Promise<void>;
  /** Maximize or restore this app's window. */
  setFullscreen(on: boolean): Promise<void>;
  /**
   * Be asked before your window closes — for unsaved work.
   *
   *   const stop = app.onBeforeClose(() => !hasUnsavedChanges || confirmDiscard());
   *
   * Return false (or a promise of it) to keep the window open. Answer promptly:
   * OpenNAS waits a moment and then closes anyway, so this can't wedge a window
   * shut. Returns an unsubscribe fn.
   */
  onBeforeClose(fn: () => boolean | Promise<boolean>): () => void;
  /**
   * Read-only machine stats. Needs "system".
   *
   * Values are sampled at most once a second and shared between callers, so
   * polling faster than that just returns the same snapshot.
   */
  system: {
    info(): Promise<SystemInfo>;
  };
  /** Set the window title bar text. */
  setTitle(title: string): Promise<void>;
  /** Ask the host to close this app's window. */
  close(): Promise<void>;
}

const app: OpenNASApp = {
  get host() {
    return hostInfo;
  },
  get app() {
    return appInfo;
  },
  get user() {
    return appUser;
  },
  get theme() {
    return theme;
  },
  onThemeChange(fn) {
    themeListeners.add(fn);
    return () => themeListeners.delete(fn);
  },
  async notify(options) {
    await post("notify", options);
  },
  settings: {
    all: () => post("settings.all", {}) as Promise<Record<string, string | number | boolean>>,
  },
  storage: {
    get: (key) => post("storage.get", { key }) as Promise<string | null>,
    set: async (key, value) => {
      await post("storage.set", { key, value });
    },
    delete: async (key) => {
      await post("storage.delete", { key });
    },
    list: () => post("storage.list", {}) as Promise<Record<string, string>>,
  },
  files: {
    list: (path = "/") => post("files.list", { path }) as Promise<AppFileEntry[]>,
    read: (path) => post("files.read", { path }) as Promise<string | null>,
    write: async (path, content) => {
      await post("files.write", { path, content });
    },
    readBinary: (path, options = {}) =>
      post("files.readBinary", { path, progress: !!options.onProgress }, options.onProgress) as Promise<Blob | null>,
    writeBinary: async (path, data, options = {}) => {
      // `data` goes into the message as-is. A Blob or File structured-clones by
      // reference, so nothing is copied; an ArrayBuffer is copied once, which is
      // why the docs point at Blob for anything large.
      await post("files.writeBinary", { path, data, progress: !!options.onProgress }, options.onProgress);
    },
    save: async (path, filename) => (await post("files.save", { path, filename })) === true,
    mkdir: async (path) => {
      await post("files.mkdir", { path });
    },
    delete: async (path) => {
      await post("files.delete", { path });
    },
  },
  async fetch(url, options = {}) {
    const raw = (await post("fetch", {
      url,
      method: options.method,
      headers: options.headers,
      body: options.body,
    })) as Omit<FetchResult, "ok" | "json">;
    return {
      ...raw,
      ok: raw.status >= 200 && raw.status < 300,
      json<T = unknown>(): T {
        if (raw.encoding !== "utf8") throw new Error("Response is not text, so it can't be parsed as JSON.");
        return JSON.parse(raw.body) as T;
      },
    };
  },
  schedule: {
    list: () => post("schedule.list", {}) as Promise<ScheduledTask[]>,
    set: (name, intervalSeconds, action, enabled) =>
      post("schedule.set", { name, intervalSeconds, action, enabled }) as Promise<ScheduledTask>,
    delete: async (name) => {
      await post("schedule.delete", { name });
    },
  },
  shares: {
    pick: (options = {}) =>
      post("shares.pick", {
        select: options.select ?? "dir",
        mode: options.mode ?? "read",
        title: options.title,
      }) as Promise<ShareGrant | null>,
    grants: () => post("shares.grants", {}) as Promise<ShareGrant[]>,
    revoke: (handle) => post("shares.revoke", { handle }) as Promise<ShareGrant[]>,
    list: (path = "/", ref = {}) => post("shares.list", { path, handle: ref.in }) as Promise<ShareListing>,
    read: (path, ref = {}) => post("shares.read", { path, handle: ref.in }) as Promise<string | null>,
    write: async (path, content, ref = {}) => {
      await post("shares.write", { path, content, handle: ref.in });
    },
    readBinary: (path, ref = {}, options = {}) =>
      post(
        "shares.readBinary",
        { path, handle: ref.in, progress: !!options.onProgress },
        options.onProgress,
      ) as Promise<Blob | null>,
    writeBinary: async (path, data, ref = {}, options = {}) => {
      await post(
        "shares.writeBinary",
        { path, data, handle: ref.in, progress: !!options.onProgress },
        options.onProgress,
      );
    },
    save: async (path, ref = {}, filename) =>
      (await post("shares.save", { path, handle: ref.in, filename })) === true,
    mkdir: async (path, ref = {}) => {
      await post("shares.mkdir", { path, handle: ref.in });
    },
    delete: async (path, ref = {}) => {
      await post("shares.delete", { path, handle: ref.in });
    },
  },
  dialog: {
    alert: async (message, options = {}) => {
      await post("dialog.alert", { message, ...options });
    },
    confirm: (message, options = {}) => post("dialog.confirm", { message, ...options }) as Promise<boolean>,
    prompt: (message, options = {}) => post("dialog.prompt", { message, ...options }) as Promise<string | null>,
  },
  async setBadge(count) {
    await post("setBadge", { count });
  },
  async requestSize(size) {
    await post("requestSize", size);
  },
  async setFullscreen(on) {
    await post("setFullscreen", { on });
  },
  onBeforeClose(fn) {
    closeHandlers.add(fn);
    // Only tell the host to start asking once someone actually cares.
    if (closeHandlers.size === 1) void post("guardClose", { on: true });
    return () => {
      closeHandlers.delete(fn);
      if (closeHandlers.size === 0) void post("guardClose", { on: false });
    };
  },
  system: {
    info: () => post("system.info", {}) as Promise<SystemInfo>,
  },
  async setTitle(title) {
    await post("setTitle", { title });
  },
  async close() {
    await post("close", {});
  },
};

/**
 * Handshake with the host and resolve to the app API. Call this once at startup
 * and await it before using any other method.
 */
export function ready(): Promise<OpenNASApp> {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    const res = (await post("ready", {})) as { host: HostInfo; app: AppInfo; user: AppUser | null };
    hostInfo = res.host;
    appInfo = res.app;
    appUser = res.user ?? null;
    theme = res.host.theme;
    return app;
  })();
  return readyPromise;
}

export const OpenNAS = { ready };
export default OpenNAS;
