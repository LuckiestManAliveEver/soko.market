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

## Browser-inference staging service

The Blueprint also defines `soko-market-web-staging` on `agent/passkey-auth`. It is intentionally
separate from `soko-market-web` and:

- builds with `VITE_DEPLOYMENT_ENV=staging`;
- enables `VITE_BROWSER_LOCAL_INFERENCE_ENABLED=true`;
- requires a staging-only `VITE_API_BASE_URL` value during Blueprint sync;
- applies CSP, COOP and COEP headers needed for model downloads, worker execution, threaded WASM and
  memory measurement;
- has no production custom domain.

Do not point `VITE_API_BASE_URL` at the production API. Create or select an isolated staging API,
then sync the Blueprint and confirm the staging static-site URL. Production remains on `main` with
browser-local inference disabled.

After deployment, verify headers:

```bash
curl -sSI https://<staging-static-site>.onrender.com/
```

Then run each backend in a fresh browser process so a timed-out WebGPU queue cannot delay the WASM
measurement:

```bash
pnpm benchmark:browser-inference -- \
  --url=https://<staging-static-site>.onrender.com \
  --api-origin=https://<staging-api>.onrender.com \
  --profile=pixel-5 \
  --backends=webgpu \
  --max-new-tokens=32 \
  --output=/tmp/soko-browser-inference-webgpu.json

pnpm benchmark:browser-inference -- \
  --url=https://<staging-static-site>.onrender.com \
  --api-origin=https://<staging-api>.onrender.com \
  --profile=pixel-5 \
  --backends=wasm \
  --max-new-tokens=32 \
  --output=/tmp/soko-browser-inference-wasm.json
```

The Pixel/Galaxy profiles emulate viewport, user agent, reported memory and processor count. They do
not substitute for physical Android GPU, thermal or memory-pressure testing.

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
- The backend environment includes `COOKIE_SECURE=true` and `COOKIE_SAME_SITE=lax` for the
  same-site `soko.market` / `api.soko.market` topology.

There is no Vercel configuration in this repository. If an external Vercel deployment is used,
follow the cross-site cookie and exact-origin requirements in
[`authentication/agent-session-contract.md`](./authentication/agent-session-contract.md); a
Vercel URL is not implicitly covered by the Render production settings.

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
