# Designed to exist

Static scroll-animated site. No build step, no dependencies.

## Deploy on Vercel
1. Push this folder to a GitHub repo and import it at vercel.com/new, or run `npx vercel` inside the folder.
2. Framework preset: **Other**. Build command: none. Output directory: leave empty (root).
3. After you get your domain, change `og.jpg` in index.html to the full URL, e.g. `https://yourdomain.com/og.jpg`, so link previews work everywhere.

## Notes
- Frames live in `frames/` and are cached for a year (see vercel.json). If you ever replace them, rename the folder (e.g. `frames-v2/`) and update the path in `js/app.js`.
- Run locally: `npx serve .`
