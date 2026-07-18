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
Apple, GitHub, Microsoft, LinkedIn, or X client credentials to Render. Firebase and SMS-provider
variables are not required: phone account access is PIN-based and first-shop phone capture is not
SMS-verified.

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
   `latestMigration` is `030_phone_pin_recovery_code.sql`.

The Blueprint currently uses Render's free Postgres plan for testing. Render free databases expire
after 30 days and are not appropriate for production merchant data. Change the database plan to a
paid Render Postgres instance before production use.

## 5. Confirm Owner Phone Identity

Phone numbers are required identity and support attributes. They are not SMS-verified during shop
registration.

1. Apply migration `029_owner_phone_identity.sql`.
2. Apply migration `030_phone_pin_recovery_code.sql`.
3. Confirm the web and API services are deployed from the same commit.
4. Create a phone-plus-PIN account or sign in through email.
5. Open first-shop registration and save a valid phone number.
6. Confirm the browser sends no SMS request and proceeds to shop details.
7. Confirm the public storefront response contains no owner phone fields.

Runtime behavior:

- Phone OTP request and verification routes return `403`.
- Phone signup and normal phone login use an owner PIN.
- Phone signup shows a high-entropy recovery code once and persists only its hash.
- Successful recovery resets the PIN, revokes older sessions, and rotates the recovery code.
- Email signup and recovery continue to use email verification.
- First-shop registration stores the normalized owner phone as `unverified`.
- Settings updates require a recently authenticated session.
- Public phone display defaults to off.

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

Test owner phone capture:

1. Sign in to an account without a saved owner phone and choose **Sell**.
2. Confirm **Add your phone number** appears without OTP controls.
3. Enter a local or international number and continue.
4. Confirm shop creation succeeds and settings show the number as private and unverified.
5. Confirm public storefront responses do not contain the number.

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

If owner phone capture fails:

1. Confirm migration `029_owner_phone_identity.sql` is applied.
2. Confirm the country and number form a plausible phone number.
3. Confirm the session was authenticated recently.
4. Check for a `PHONE_ALREADY_IN_USE` conflict without attempting to identify the other account.
5. Confirm API logs contain only masked phone values.

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
- Cloudflare DNS records: https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-dns-records/
- Cloudflare apex records: https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-zone-apex/
- Cloudflare proxy status: https://developers.cloudflare.com/dns/proxy-status/
- Cloudflare Full strict SSL: https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/
