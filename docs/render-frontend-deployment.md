# Render frontend deployment

This repository is a pnpm monorepo. The frontend is a Vite React app in `apps/web`.
The backend is a Node/Fastify API in `services/api`.

## Production services

- Production Git branch: `main`
- Frontend Render service: `soko-market-web`
- Backend Render service: `soko-market-api`
- Frontend root directory: repository root
- Backend root directory: repository root
- Frontend build command: `COREPACK_HOME=/tmp/corepack corepack pnpm install --frozen-lockfile && COREPACK_HOME=/tmp/corepack corepack pnpm --filter @soko/web build`
- Frontend publish directory: `apps/web/dist`
- Backend build command: `COREPACK_HOME=/tmp/corepack corepack pnpm install --frozen-lockfile && COREPACK_HOME=/tmp/corepack corepack pnpm --filter @soko/api build`
- Backend start command: `COREPACK_HOME=/tmp/corepack corepack pnpm --filter @soko/api start`
- Frontend API variable: `VITE_API_BASE_URL=https://api.soko.market`

The frontend service is a Render Static Site. It must not run the Vite development
server in production.

## Required Render dashboard checks

Open both Render services and confirm:

- Repository is `LuckiestManAliveEver/soko.market`.
- Branch is `main`.
- Auto-deploy is enabled for commits.
- The frontend service is `runtime: static`.
- The frontend publish directory is `apps/web/dist`.
- The backend service is `runtime: node`.
- The frontend environment includes `VITE_API_BASE_URL=https://api.soko.market`.
- The backend environment includes `WEB_ORIGINS=https://soko.market,https://www.soko.market`.

If the dashboard differs from `render.yaml`, sync the Blueprint or update the service
settings to match.

## Deploy latest frontend changes

Confirm the changes are on the production branch:

```bash
git status
git branch --show-current
git log -5 --oneline
git remote -v
```

If you made changes on another branch, merge them to `main` before expecting the
production site to update.

```bash
git checkout main
git pull --rebase origin main
git merge --ff-only <source-branch>
git push origin main
```

If the merge is not fast-forward, open a pull request or resolve the merge explicitly.
Do not force-push production history.

Standard verification workflow:

```bash
git add .
git commit -m "Deploy latest frontend changes"
git push origin main
```

Then in Render:

```text
Open the frontend service
Confirm the latest commit is detected
Trigger Manual Deploy if required
Use Clear build cache and deploy when stale artifacts are suspected
Wait for a successful deployment status
Open the deployed frontend
Compare the displayed commit SHA or build timestamp
Hard-refresh the browser
```

## Cache behavior

The static site config should serve:

- `/` and `/index.html`: `Cache-Control: no-cache, must-revalidate`
- `/sw.js`: `Cache-Control: no-cache, must-revalidate`
- `/manifest.webmanifest`: `Cache-Control: no-cache, must-revalidate`
- `/assets/*`: `Cache-Control: public, max-age=31536000, immutable`

Vite builds JavaScript and CSS assets with content hashes, so immutable caching is safe
for `/assets/*`. The HTML and service worker must revalidate so each deployment can
point browsers at the latest hashed assets.

## Confirm which commit is live

Open the deployed frontend and check the browser console for:

```text
[Soko.market] frontend boot
```

The logged object includes:

- `version`
- `buildTimestamp`
- `commitSha`
- `environment`
- `apiBaseUrl`
- current page URL

If `DEBUG_UI=true` is set during the frontend build, the footer also shows the build
identity. Otherwise normal production users do not see it.

## Hard-refresh and service worker cleanup

To hard-refresh:

- Chrome, Edge, Firefox on Linux/Windows: `Ctrl+Shift+R`
- Chrome, Edge, Firefox on macOS: `Cmd+Shift+R`
- Safari: enable the Develop menu, then use Empty Caches and reload

To unregister an obsolete service worker:

1. Open browser developer tools.
2. Go to Application, then Service Workers.
3. Click Unregister for `soko.market`.
4. Go to Storage and clear site data for `soko.market`.
5. Reload the page.

## Failed build inspection

In Render, open the failed deploy and inspect:

- The Git commit Render checked out.
- The branch Render deployed.
- The frontend build command.
- The publish directory.
- The value of `VITE_API_BASE_URL`.
- Any TypeScript, Vite, or pnpm install errors.

A successful deploy with an old `commitSha` means the browser or service worker is
stale. A deploy that never saw the expected commit means the problem is Git branch,
repository, service, or auto-deploy configuration.

## Roll back safely

Use Render's rollback action for the affected service when the previous deploy is
known good. If the bad commit is already on `main`, revert it with a new commit and
push `main`; do not force-push.
