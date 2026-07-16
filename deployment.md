# Soko Market Deployment

This is the deployment runbook for testing Soko Market with:

- GitHub for source code
- Render for the frontend and backend
- Cloudflare for DNS
- Render Postgres for persistent application data
- Web domain: `soko.market`
- API domain: `api.soko.market`

Cloudflare is already registered and active for `soko.market`. Do not repeat domain registration
or nameserver setup. The Render Blueprint provisions the API, frontend, and `soko-market-db`
Postgres database and connects them over Render's private network.

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
- `soko-market-db`: Render Postgres for persistent application data.

## 2. Connect Render To GitHub

1. Log in to Render.
2. Click New.
3. Select Blueprint.
4. Connect your GitHub account if Render is not already connected.
5. Choose the repo `LuckiestManAliveEver/soko.market`.
6. Select branch `main`.
7. Confirm Render detects `render.yaml`.
8. Create the Blueprint.

Render should create two services and one database:

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

3. `soko-market-db`
   - Type: Render Postgres
   - Region: Oregon
   - Database: `soko_market`
   - `DATABASE_URL` and `DIRECT_DATABASE_URL` are injected into the API and database jobs.

## 3. Confirm Render Environment Variables

Open Render service `soko-market-api`, then go to Environment.

Confirm these values:

```text
NODE_ENV=production
NODE_VERSION=20.19.0
API_HOST=0.0.0.0
WEB_ORIGINS=https://soko.market,https://www.soko.market
APP_URL=https://soko.market
AUTH_ALLOWED_REDIRECT_ORIGINS=https://soko.market,https://www.soko.market
WEBAUTHN_RP_ID=soko.market
CP2_STORE=postgres
DATABASE_URL=<linked from soko-market-db>
DIRECT_DATABASE_URL=<linked from soko-market-db>
```

Social OAuth login is disabled in both the frontend and API. Do not add Google, Facebook, TikTok,
Apple, GitHub, Microsoft, LinkedIn, or X client credentials to Render.

Set these when Firebase phone auth is ready:

```text
VITE_FIREBASE_API_KEY=<Firebase web API key>
VITE_FIREBASE_AUTH_DOMAIN=<Firebase auth domain>
VITE_FIREBASE_PROJECT_ID=<Firebase project ID>
VITE_FIREBASE_APP_ID=<Firebase app ID>
VITE_FIREBASE_MESSAGING_SENDER_ID=<Firebase sender ID>
FIREBASE_PROJECT_ID=<Firebase project ID>
```

Open Render service `soko-market-web`, then go to Environment.

Confirm:

```text
NODE_VERSION=20.19.0
VITE_API_URL=https://api.soko.market
```

If you change any frontend environment variable, redeploy `soko-market-web` because Vite reads env vars at build time.

## 4. Activate Render Postgres

1. Open the Soko Market Blueprint in Render.
2. Click **Sync Blueprint** after the latest `render.yaml` reaches `main`.
3. Confirm Render creates `soko-market-db` and its status becomes **Available**.
4. Confirm the API environment shows `DATABASE_URL` and `DIRECT_DATABASE_URL` linked from that
   database. Do not enter these values manually.
5. Deploy `soko-market-api`.
6. The API start command runs all SQL migrations before starting the server. This is intentionally
   part of the start command because Render pre-deploy commands are unavailable on free web
   services.
7. Open `https://api.soko.market/health/db` and confirm `database.status` is `ok` and
   `latestMigration` is `019_cp23_mcp_access_tokens.sql`.

The Blueprint currently uses Render's free Postgres plan for testing. Render free databases expire
after 30 days and are not appropriate for production merchant data. Change the database plan to a
paid Render Postgres instance before production use.

## 5. Add Firebase Phone Auth

Use Firebase Phone Authentication for hosted phone OTP. The browser sends the SMS, then the API
verifies the Firebase ID token and turns it into the normal CP2 session.

1. Create or open a Firebase project.
2. Add the production web domains and any preview domains under Firebase Authentication settings.
3. Enable the Phone provider in Firebase Authentication.
4. Create a web app in Firebase and copy the web config values into the `VITE_FIREBASE_*`
   environment variables on `soko-market-web`.
5. Set `FIREBASE_PROJECT_ID` on `soko-market-api`.
6. Redeploy both Render services.

Runtime behavior:

- Normal phone OTP requests use Firebase SMS in the browser.
- The browser confirms the SMS code, then sends a Firebase ID token to the API.
- The API verifies the token with Firebase public certificates and creates the CP2 session.
- Email OTP still uses the local dev OTP path until an email OTP provider is added.
- The frontend no longer exposes WhatsApp OTP.

Phone numbers must be in E.164 format, for example `+254700000000`.

Passkeys use `WEBAUTHN_RP_ID` as their stable relying-party identity. Keep it set to
`soko.market` for both `https://soko.market` and `https://www.soko.market`; changing it later makes
previously registered passkeys unavailable.

## 6. Deploy Both Render Services

In Render:

1. Open `soko-market-api`.
2. Start or wait for the latest deploy.
3. Confirm the deploy status is Live.
4. Open `soko-market-web`.
5. Start or wait for the latest deploy.
6. Confirm the deploy status is Live.

Do not configure Cloudflare records until Render gives you the DNS targets for the custom domains.

If Render deploy logs show an older commit, stop and redeploy the latest `main` commit first. For example, a deploy log that checks out `d6f4a90` is stale; it predates the Render Corepack fix. Use the latest commit from GitHub instead.

## 7. Get Render DNS Targets

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

## 8. Add Cloudflare DNS Records

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

## 9. Verify Render Custom Domains

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

## 10. Cloudflare SSL Mode

After Render shows the domains as verified and TLS is active:

1. Open Cloudflare.
2. Select `soko.market`.
3. Go to SSL/TLS.
4. Set SSL/TLS encryption mode to Full (strict).

You can keep records DNS only for the first test. After everything works, you may switch `soko.market`, `www`, and `api` to Proxied if desired.

If a proxied record causes errors, switch it back to DNS only and retest.

## 11. Smoke Test

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

If Firebase is configured, test phone OTP:

1. Use a phone number allowed by your Firebase Authentication phone test setup.
2. Request an OTP from `https://soko.market`.
3. Confirm the code arrives by SMS.
4. Enter the received code in the browser prompt.
5. Confirm login succeeds.

Verify Postgres persistence:

1. Open `https://api.soko.market/health/db`.
2. Confirm `database.status` is `ok`.
3. Create a test account or shop, redeploy the API, and confirm the record remains available.

## 12. Troubleshooting

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
4. Confirm Render is deploying the latest `main` commit, not an older commit.
5. If the Render service still shows the old command, open the Render Blueprint and sync it from the latest `main`, or manually update the service build command in Render.
6. Redeploy both Render services from the latest `main` commit.

If Render selects Node 26:

1. Confirm the latest commit includes `.node-version`.
2. Confirm root `package.json` has `"node": ">=20.19.0 <21.0.0"` under `engines`.
3. Confirm each Render service has `NODE_VERSION=20.19.0`.
4. Redeploy from the latest `main` commit.

If the frontend loads but API calls fail:

1. Confirm `VITE_API_URL=https://api.soko.market` on `soko-market-web`.
2. Redeploy `soko-market-web`.
3. Confirm `WEB_ORIGINS=https://soko.market,https://www.soko.market` on `soko-market-api`.
4. Redeploy `soko-market-api`.
5. Check the browser console for CORS errors.

If Firebase OTP does not send:

1. Confirm the Firebase phone provider is enabled in the Firebase console.
2. Confirm `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, and
   `VITE_FIREBASE_APP_ID` are set on `soko-market-web`.
3. Confirm `FIREBASE_PROJECT_ID` is set on `soko-market-api`.
4. Confirm the production domain is authorized in Firebase Authentication settings.
5. Confirm the phone number is in E.164 format, for example `+254700000000`.
6. Check the browser console and Render logs for Firebase auth errors.

If Postgres does not activate:

1. Sync the Blueprint and confirm `soko-market-db` exists in the Oregon region.
2. Confirm the database status is **Available**, not **Suspended** or **Expired**.
3. Confirm `DATABASE_URL` is linked from `soko-market-db` on the API service.
4. Check the API deploy logs for `Database migrations are up to date.`
5. Open `/health/db` and check `latestMigration` and connection latency.

## 13. Free-Tier Notes

Render free web services can spin down after idle time. The first API request after idle can take about one minute.

The deployed API uses Postgres when `CP2_STORE=postgres`; it does not fall back to memory if the
database is missing. Render free Postgres is appropriate only for short-lived testing because it
expires after 30 days and has no managed backups.

## 14. Reference Docs

- Render custom domains: https://render.com/docs/custom-domains
- Render Blueprint YAML: https://render.com/docs/blueprint-spec
- Render outbound IPs: https://render.com/docs/outbound-ip-addresses
- Render Postgres: https://render.com/docs/postgresql
- Render free service limits: https://render.com/docs/free
- Firebase web phone auth: https://firebase.google.com/docs/auth/web/phone-auth
- Firebase ID token verification: https://firebase.google.com/docs/auth/admin/verify-id-tokens
- Cloudflare DNS records: https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-dns-records/
- Cloudflare apex records: https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-zone-apex/
- Cloudflare proxy status: https://developers.cloudflare.com/dns/proxy-status/
- Cloudflare Full strict SSL: https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/
