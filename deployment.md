# Soko Market Deployment

This is the deployment runbook for testing Soko Market with:

- GitHub for source code
- Render for the frontend and backend
- Cloudflare for DNS
- Web domain: `soko.market`
- API domain: `api.soko.market`

Cloudflare is already registered and active for `soko.market`. Do not repeat domain registration or nameserver setup. The remaining work is to connect Render to GitHub, deploy both Render services, and add the DNS records Render asks for in Cloudflare.

## 1. Confirm GitHub Is Ready

1. Open GitHub.
2. Go to `LuckiestManAliveEver/soko.market`.
3. Confirm the default branch is `main`.
4. Confirm the latest commit includes `render.yaml`.
5. Open the Actions tab.
6. Confirm CI passes on `main`.

The repo already includes a Render Blueprint at the root:

```text
render.yaml
```

That file defines:

- `soko-market-web`: Render Static Site for the Vite frontend.
- `soko-market-api`: Render Web Service for the Fastify backend.

## 2. Connect Render To GitHub

1. Log in to Render.
2. Click New.
3. Select Blueprint.
4. Connect your GitHub account if Render is not already connected.
5. Choose the repo `LuckiestManAliveEver/soko.market`.
6. Select branch `main`.
7. Confirm Render detects `render.yaml`.
8. Create the Blueprint.

Render should create two services:

1. `soko-market-api`
   - Type: Web Service
   - Runtime: Node
   - Plan: Free
   - Node version: `20.19.0`
   - Build command: `COREPACK_HOME=/tmp/corepack corepack pnpm install --frozen-lockfile`
   - Start command: `COREPACK_HOME=/tmp/corepack corepack pnpm exec tsx services/api/src/index.ts`
   - Health check path: `/health`
   - Custom domain: `api.soko.market`

2. `soko-market-web`
   - Type: Static Site
   - Node version: `20.19.0`
   - Build command: `COREPACK_HOME=/tmp/corepack corepack pnpm install --frozen-lockfile && COREPACK_HOME=/tmp/corepack corepack pnpm --filter @soko/web build`
   - Publish directory: `apps/web/dist`
   - Custom domain: `soko.market`
   - API URL: `https://api.soko.market`

## 3. Confirm Render Environment Variables

Open Render service `soko-market-api`, then go to Environment.

Confirm these values:

```text
NODE_ENV=production
NODE_VERSION=20.19.0
API_HOST=0.0.0.0
WEB_ORIGINS=https://soko.market,https://www.soko.market
```

Optional for future persistence work:

```text
MONGODB_URI=<Atlas test connection string>
```

Open Render service `soko-market-web`, then go to Environment.

Confirm:

```text
NODE_VERSION=20.19.0
VITE_API_URL=https://api.soko.market
```

If you change any frontend environment variable, redeploy `soko-market-web` because Vite reads env vars at build time.

## 4. Deploy Both Render Services

In Render:

1. Open `soko-market-api`.
2. Start or wait for the latest deploy.
3. Confirm the deploy status is Live.
4. Open `soko-market-web`.
5. Start or wait for the latest deploy.
6. Confirm the deploy status is Live.

Do not configure Cloudflare records until Render gives you the DNS targets for the custom domains.

## 5. Get Render DNS Targets

For the backend API:

1. Open Render service `soko-market-api`.
2. Go to Settings.
3. Find Custom Domains.
4. Confirm `api.soko.market` exists.
5. Copy the DNS target Render shows for `api.soko.market`.

For the frontend:

1. Open Render service `soko-market-web`.
2. Go to Settings.
3. Find Custom Domains.
4. Confirm `soko.market` exists.
5. Copy the DNS target Render shows for `soko.market`.

If a custom domain is missing, add it manually in Render:

- Add `soko.market` to `soko-market-web`.
- Add `api.soko.market` to `soko-market-api`.

## 6. Add Cloudflare DNS Records

Cloudflare is already the DNS provider. Only add or update DNS records.

In Cloudflare:

1. Open the `soko.market` zone.
2. Go to DNS.
3. Go to Records.
4. Remove conflicting records for the same hostnames before adding the Render records.

Remove or replace existing records for:

```text
@
www
api
```

Add these records using the exact targets from Render:

```text
Type    Name    Target
CNAME   @       <frontend target from Render>
CNAME   api     <backend target from Render>
```

If Render gives you a separate `www` target or asks you to configure `www`, add:

```text
Type    Name    Target
CNAME   www     <frontend target from Render>
```

Recommended Cloudflare settings while Render verifies:

- Proxy status: DNS only, gray cloud.
- TTL: Auto.
- No conflicting `A`, `AAAA`, or `CNAME` records for `@`, `www`, or `api`.

Cloudflare supports CNAME flattening at the apex, so using a CNAME for `@` is acceptable in Cloudflare.

## 7. Verify Render Custom Domains

After adding DNS records in Cloudflare:

1. Return to Render.
2. Open `soko-market-web`.
3. Go to Settings > Custom Domains.
4. Click Verify for `soko.market` if needed.
5. Wait until Render shows the domain as Verified.
6. Open `soko-market-api`.
7. Go to Settings > Custom Domains.
8. Click Verify for `api.soko.market` if needed.
9. Wait until Render shows the domain as Verified.

Render will provision TLS certificates after DNS verifies. This can take several minutes.

## 8. Cloudflare SSL Mode

After Render shows the domains as verified and TLS is active:

1. Open Cloudflare.
2. Select `soko.market`.
3. Go to SSL/TLS.
4. Set SSL/TLS encryption mode to Full (strict).

You can keep records DNS only for the first test. After everything works, you may switch `soko.market`, `www`, and `api` to Proxied if desired.

If a proxied record causes errors, switch it back to DNS only and retest.

## 9. Smoke Test

Test the API:

```sh
curl https://api.soko.market/health
```

Expected response shape:

```json
{ "service": "api", "status": "ok", "timestamp": "..." }
```

Test the frontend:

```text
https://soko.market
```

Then verify the frontend can reach the backend:

1. Open `https://soko.market`.
2. Open browser developer tools.
3. Go to the Network tab.
4. Reload the page.
5. Confirm API calls go to `https://api.soko.market`.
6. Confirm there are no CORS errors.

## 10. Troubleshooting

If `soko.market` does not load:

1. Confirm `soko-market-web` is Live in Render.
2. Confirm `soko.market` is attached to `soko-market-web`.
3. Confirm Cloudflare has the correct `@` CNAME target from Render.
4. Remove conflicting `A` or `AAAA` records for `@`.
5. Keep the Cloudflare record DNS only until Render verifies it.

If `api.soko.market/health` does not load:

1. Confirm `soko-market-api` is Live in Render.
2. Confirm the Render health check path is `/health`.
3. Confirm `api.soko.market` is attached to `soko-market-api`.
4. Confirm Cloudflare has the correct `api` CNAME target from Render.
5. Keep the Cloudflare record DNS only until Render verifies it.

If Render fails with `EROFS: read-only file system, unlink '/usr/bin/pnpm'`:

1. Do not use `corepack enable` in Render build commands.
2. Use `COREPACK_HOME=/tmp/corepack corepack pnpm ...` instead.
3. Confirm `render.yaml` has the updated build and start commands.
4. Redeploy both Render services from the latest `main` commit.

If the frontend loads but API calls fail:

1. Confirm `VITE_API_URL=https://api.soko.market` on `soko-market-web`.
2. Redeploy `soko-market-web`.
3. Confirm `WEB_ORIGINS=https://soko.market,https://www.soko.market` on `soko-market-api`.
4. Redeploy `soko-market-api`.
5. Check the browser console for CORS errors.

## 11. Free-Tier Notes

Render free web services can spin down after idle time. The first API request after idle can take about one minute.

The current app store is in-memory. Test data can disappear when the API restarts, redeploys, or spins down. Use this setup for testing until persistent storage is implemented.

## 12. Reference Docs

- Render custom domains: https://render.com/docs/custom-domains
- Render Blueprint YAML: https://render.com/docs/blueprint-spec
- Cloudflare DNS records: https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-dns-records/
- Cloudflare apex records: https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-zone-apex/
- Cloudflare proxy status: https://developers.cloudflare.com/dns/proxy-status/
- Cloudflare Full strict SSL: https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/
