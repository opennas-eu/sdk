# OpenNAS SDK

Tools for building apps and themes for OpenNAS. Apps run in a sandboxed iframe
on the NAS desktop and use the SDK to access the capabilities an administrator
has approved.

This directory is an independent pnpm workspace. Commands below run from `sdk/`
unless stated otherwise. Use Node 20 or later and pnpm.

## Contents

| Directory | Purpose |
| --- | --- |
| [app-sdk/](./app-sdk/README.md) | Browser SDK, TypeScript types and package-signing tool. |
| [create-opennas-app/](./create-opennas-app/) | App generator with HTML, manifest, development server and package builder templates. |
| [examples/hello-app/](./examples/hello-app/) | Minimal app that demonstrates the SDK. |
| [examples/apps/](./examples/apps/README.md) | Pomodoro Timer, Markdown Pad and Color Lab. |
| [examples/themes/](./examples/themes/README.md) | Example themes and a theme packer. |

## Create an app

The local generator requires no dependency installation:

```sh
node create-opennas-app/index.mjs my-app --id com.example.my-app --perms notifications,storage --yes
cd my-app
node dev.mjs
```

This creates a `my-app/` directory and serves it at <http://localhost:5174>.
The generated server fetches the hosted SDK from an OpenNAS development instance
at <http://localhost:5173> by default. To use another NAS:

```sh
node dev.mjs 5174 https://nas.example.com
```

Open OpenNAS on the same computer as the app development server. In
**App Center > Development apps > Add**, enter `http://localhost:5174` and the app
ID from `opennas-app.json`. Development URLs must use localhost or a loopback
address. The app still runs inside OpenNAS with the usual permission checks.

Edit `index.html` and refresh the app window to try your changes. The generated
README explains the manifest, settings and packaging workflow.

## Package and install

From the generated app directory:

```sh
node pack.mjs
```

The packer writes `<app-id>-<version>.onpkg`. Install it through **App Center**
using an administrator account, then review the requested permissions. Increase
the manifest version before packaging an update.

Apps load `/app-sdk/opennas.js` and call `OpenNAS.ready()` to connect to the host.
See the [SDK reference](./app-sdk/README.md) for storage, files, shared-folder
grants, notifications, system information, HTTP requests and scheduled actions.
Declare only the capabilities the app needs.

## Sign a package

From `sdk/`, sign the app before packing it:

```sh
node app-sdk/opennas-sign.mjs keygen my-app/publisher.key
node app-sdk/opennas-sign.mjs sign my-app
node my-app/pack.mjs
```

Keep the private key outside version control. The generated packer excludes
`.key` files. A valid signature identifies the publisher; an administrator
chooses whether to trust that publisher in App Center.

## Build the SDK

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
```

The build writes these files under `app-sdk/dist/`:

- `index.js`: ES module entry point.
- `opennas.js`: browser bundle exposing `window.OpenNAS`.
- TypeScript declaration files.

Building the SDK does not update the NAS web app. In this combined checkout,
copy the new browser bundle into the host explicitly:

```sh
pnpm sync-host
```

This writes `../opennas/apps/web/public/app-sdk/opennas.js`. Run it after a build
when testing SDK changes together with the NAS desktop.

## Build the examples

After installing workspace dependencies:

```sh
pnpm --filter @opennas/example-hello-app pack
pnpm --filter opennas-example-apps pack
pnpm --filter opennas-example-themes pack
```

The app and theme collections write packages to their respective `dist/`
directories. The app collection generates a publisher key and signs its examples,
except Color Lab, which demonstrates an unsigned package. See each example
README for details.

Install `.onthm` files through **Control Panel > Personalization > Install .onthm**.
For hosting app packages, see the [repository server guide](../repo-server/README.md).

## Licence

The SDK and generated templates use the [MIT licence](./LICENSE).
OpenNAS itself uses GPL-3.0-or-later.
