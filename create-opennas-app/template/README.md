# __APP_NAME__

__APP_DESCRIPTION__

An [OpenNAS](https://github.com/) app: plain HTML/CSS/JS plus an
`opennas-app.json` manifest, running in a sandboxed iframe on the OpenNAS
desktop and talking to it through the app SDK.

## Develop

Edit `index.html`. The SDK is loaded from `/app-sdk/opennas.js`, which every
OpenNAS serves — so the app only really runs once installed on a NAS.

## Pack

```sh
node pack.mjs      # → __APP_ID__-<version>.onpkg
```

No dependencies to install. Then drag the `.onpkg` into **App Center** on your
OpenNAS (admins only). An admin reviews the permissions your manifest requests
before it installs.

Bump `version` in `opennas-app.json` before re-packing — OpenNAS compares it
against the installed version to offer updates.

## Permissions

Declare only what you use in `opennas-app.json`; anything not declared is denied
at runtime, and a shorter list is easier for an admin to approve.

| Permission | Grants |
| --- | --- |
| `notifications` | Post to the desktop's notification bell |
| `storage` | A per-app, per-user key/value store |
| `user` | Read the signed-in user's username, display name and role |
| `files` | A private per-app, per-user folder (never the user's shared folders) |
| `system` | Read-only CPU / memory / storage / network stats |

Adding a permission in a later version means the update waits for an admin to
approve it — automatic updates deliberately won't grant it silently.

## Signing (recommended)

Unsigned packages install with a warning. To sign, use `opennas-sign.mjs` from
`@opennas/app-sdk`: it generates an ed25519 key, adds `publisherKey` to your
manifest and writes a `SIGNATURE` entry into the package. Keep the `.key` file
private — `.gitignore` and `pack.mjs` both exclude `*.key` already.

## Developing

```sh
node dev.mjs        # serves this folder on http://localhost:5174
```

Then in OpenNAS: **App Center → Development apps → Add**, giving that URL and
this app's id. The app runs in the same sandbox and under the same permission
checks as an installed one — only the source of the files differs — so edit,
refresh the window, and you see the change. Remove the entry when you're done.

To ship it, `node pack.mjs` and drag the `.onpkg` into App Center.

## Settings

Fields declared under `settings` in `opennas-app.json` get a form in
App Center → your app → the sliders button. OpenNAS renders that form, so
anything typed into it (an API key, say) never passes through your iframe —
you just read the result:

```js
const settings = await app.settings.all();
```

Each field takes a `scope`: `user` (the default — everyone configures their own)
or `admin` (one shared value for the whole NAS, only an administrator can change
it). Mark a text field `"secret": true` to have it masked in the form and kept
out of the audit log.
