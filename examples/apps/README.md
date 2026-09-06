# Example apps

Three small, real OpenNAS apps you can pack and publish to a repository
(`repo-server/`) to see how the catalogue / browse UI looks populated.

| App | id | Category | Signed | Uses |
| --- | --- | --- | --- | --- |
| **Pomodoro Timer** | `com.opennas.pomodoro` | productivity | ✓ | notifications |
| **Markdown Pad** | `com.opennas.markdown-pad` | developer | ✓ | storage |
| **Color Lab** | `com.opennas.color-lab` | utilities | — (unsigned demo) | — |

Each is a self-contained `index.html` + a custom `icon.svg` + an
`opennas-app.json` manifest. They load the hosted SDK (`/app-sdk/opennas.js`)
and degrade gracefully when opened outside a NAS.

## Use it

```bash
pnpm install          # pulls fflate

node pack-all.mjs     # → dist/*.onpkg (creates a shared publisher.key, signs them)

# publish to a running repo (repo-server)
REPO_URL=http://127.0.0.1:4178 REPO_TOKEN=<your REPO_ADMIN_TOKEN> node publish-all.mjs
```

Then open the repo URL in a browser to see the three apps in the catalogue,
with verified / unsigned badges and their custom icons.

## Notes

- `pack-all.mjs` creates a single `publisher.key` (ed25519) and signs every app
  with it, so they show the **verified-publisher** badge — except **Color Lab**,
  which has an empty `UNSIGNED` marker file and is packed without a signature.
- To turn an app into a real package for any OpenNAS box, just grab its
  `dist/<id>-<version>.onpkg` and install it via **Package Center → App Center**.
- `publisher.key`, `node_modules/` and `dist/` are gitignored.
