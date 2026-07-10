# Frontend Cache and Refresh Debugging

## Frontend and local URL

This repository serves a React frontend with Vite from `apps/web`. The root development command
starts both `@soko/api` and `@soko/web`.

Open the exact URL printed by Vite, normally:

```text
http://127.0.0.1:5173
```

The frontend now requires port `5173` instead of silently selecting another port. If startup says
the port is already in use, stop the older Vite process before opening the browser. In browser
DevTools, confirm `window.location.href` and the `[Soko.market] frontend boot` console message both
show the expected URL.

## Restart and clear the Vite cache

From the repository root, clean the frontend's Vite cache and build output, then restart the API
and frontend:

```bash
pnpm restart:dev
```

The equivalent commands are:

```bash
pnpm clean:dev
pnpm dev
```

To run only the frontend:

```bash
pnpm dev:web
```

For a Docker bind mount, WSL filesystem, network drive, or any environment where filesystem events
are unreliable, force polling:

```bash
pnpm dev:web:poll
```

Vite Fast Refresh watches `apps/web/src` and imported workspace sources such as `packages/ui/src`.
Development responses use `Cache-Control: no-store`, and the app unregisters its service worker and
removes Soko PWA caches on development boot.

## Hard-refresh the browser

After restarting Vite:

- Chrome, Edge, and Firefox on Windows/Linux: press `Ctrl+Shift+R`.
- Chrome, Edge, and Firefox on macOS: press `Cmd+Shift+R`.
- With DevTools open, use the Network tab's **Disable cache** option and reload.

If an older tab was opened before the automatic service-worker cleanup, close all tabs for the
local origin, reopen `http://127.0.0.1:5173`, and hard-refresh once. In Chromium, the Application
tab's Service Workers and Cache Storage sections can confirm no development worker or
`soko-market-app-*` cache remains.

## Confirm a live deployment changed

Production builds emit hashed filenames under `assets/`, so changed source produces new asset URLs.
To verify a deployment:

1. Open DevTools Console and find `[Soko.market] frontend boot`.
2. Compare its `version` and `buildTimestamp` with the expected deployment.
3. In the Network tab, reload and confirm the document references newly hashed `/assets/...` files.
4. Check the hosting provider's deployment log or commit identifier and confirm the deployment
   completed after the logged build timestamp.

The footer build identity is visible automatically in development. To display it temporarily in a
production build, set `DEBUG_UI=true` in the build environment. Do not leave production debug UI
enabled longer than needed.

## Confirm the edited folder is the served folder

A common mistake is editing one checkout or frontend directory while another is running. This
repository's Vite entry is `apps/web/index.html`, and its React entry is `apps/web/src/main.tsx`.
Run commands from the repository root that contains this `docs` file, and check the terminal's Vite
root and URL. If multiple clones exist, compare `pwd` in the editor terminal with the terminal that
started `pnpm dev`.
