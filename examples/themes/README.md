# Example themes

Custom themes for OpenNAS. A theme is a tiny zip (`.onthm`) with a `theme.json`
manifest at its root and (optionally) a wallpaper image.

| Theme | Mode | Wallpaper |
| --- | --- | --- |
| **Midnight Rose** | dark | CSS gradient |
| **Sakura** | light | CSS gradient |
| **Aurora Glass** | dark | packaged `wallpaper.svg` + rounder windows |

## Pack

```bash
pnpm install
node pack-themes.mjs      # → dist/*.onthm
```

Then install a theme via **Control Panel → Personalization → Install .onthm**
(admin), and anyone can apply it from the Themes row.

## theme.json

```json
{
  "themeVersion": 1,
  "id": "my-theme",
  "name": "My Theme",
  "author": "You",
  "description": "…",
  "mode": "dark",                 // light | dark
  "accent": "#e11d48",            // one hex (shades auto-derived) or {400,500,600,700}
  "wallpaper": "wallpaper.png",   // a packaged image, OR a CSS background (gradient)
  "vars": { "--radius-window": "16px" }   // optional, allow-listed CSS overrides
}
```
