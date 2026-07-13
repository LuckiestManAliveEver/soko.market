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
CP2_STORE=postgres
DATABASE_URL=<linked from soko-market-db>
DIRECT_DATABASE_URL=<linked from soko-market-db>
```

Social OAuth login is disabled in both the frontend and API. Do not add Google, Facebook, TikTok,
Apple, GitHub, Microsoft, LinkedIn, or X client credentials to Render.

Set these when the Twilio Verify service is ready:

```text
TWILIO_VERIFY_ENABLED=true
WHATSAPP_OTP_ENABLED=true
TWILIO_ACCOUNT_SID=<Twilio account SID>
TWILIO_AUTH_TOKEN=<Twilio auth token>
TWILIO_VERIFY_SERVICE_SID=<Twilio Verify service SID>
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

## 5. Add Twilio Verify For SMS And WhatsApp OTP

Use Twilio Verify for hosted phone OTP while testing. This uses Twilio's trial/free account path, not a permanently free SMS product.

1. Create or open a Twilio account.
2. Open the Twilio Console.
3. Copy the Account SID.
4. Copy the Auth Token.
5. Go to Verify.
6. Create a Verify Service for Soko Market.
7. Copy the Verify Service SID, which starts with `VA`.
8. Enable the WhatsApp verification channel for that Verify Service and complete any Twilio/Meta
   sender approval required by the Console.
9. If the account is a Twilio trial account, verify every recipient phone number you want to test.
10. In Render, open `soko-market-api` and go to Environment.
11. Set `TWILIO_VERIFY_ENABLED=true`.
12. Set `WHATSAPP_OTP_ENABLED=true`.
13. Set `TWILIO_ACCOUNT_SID`.
14. Set `TWILIO_AUTH_TOKEN`.
15. Set `TWILIO_VERIFY_SERVICE_SID`.
16. Redeploy `soko-market-api`.

Runtime behavior:

- Normal phone OTP requests use Twilio Verify SMS.
- WhatsApp OTP requests use the same Verify Service with Twilio's `whatsapp` channel.
- The Twilio credentials identify the Soko service, not individual users. Do not add one set per user.
- If either OTP feature is enabled while a required Twilio secret is missing, the API refuses to
  start instead of silently using local OTP behavior.
- Email OTP still uses the local dev OTP path until an email OTP provider is added.
- The frontend will no longer auto-fill the OTP when Twilio handles the request.

Twilio trial caveats:

- Trial accounts are for testing and are temporary.
- Trial accounts require verified recipient numbers for SMS, voice, and WhatsApp OTP.
- Real production SMS verification is paid after the trial.
- Keep Twilio credentials only in Render environment variables, never in Git.

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

If Twilio is configured, test phone OTP:

1. Use a phone number verified in the Twilio trial console.
2. Request an OTP from `https://soko.market`.
3. Confirm the code arrives by SMS.
4. Enter the received code manually.
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

If Twilio OTP does not send:

1. Confirm `TWILIO_VERIFY_ENABLED=true` is set on `soko-market-api`.
2. For WhatsApp, confirm `WHATSAPP_OTP_ENABLED=true` and that the WhatsApp channel/sender is
   approved in the Twilio Verify Console.
3. Confirm `TWILIO_ACCOUNT_SID` is set on `soko-market-api`.
4. Confirm `TWILIO_AUTH_TOKEN` is set on `soko-market-api`.
5. Confirm `TWILIO_VERIFY_SERVICE_SID` is set on `soko-market-api`.
6. Confirm the service SID starts with `VA`.
7. If using a Twilio trial account, confirm the recipient phone number is verified in Twilio.
8. Confirm the phone number is in E.164 format, for example `+254700000000`.
9. Check Render logs for `whatsapp_otp_unconfigured` or `otp_provider_failed`.

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

Twilio's trial path is appropriate for verifying the integration, not for permanent free production SMS.

## 14. Reference Docs

- Render custom domains: https://render.com/docs/custom-domains
- Render Blueprint YAML: https://render.com/docs/blueprint-spec
- Render outbound IPs: https://render.com/docs/outbound-ip-addresses
- Render Postgres: https://render.com/docs/postgresql
- Render free service limits: https://render.com/docs/free
- Twilio Verify verifications: https://www.twilio.com/docs/verify/api/verification
- Twilio Verify checks: https://www.twilio.com/docs/verify/api/verification-check
- Twilio Verify pricing: https://www.twilio.com/en-us/verify/pricing
- Cloudflare DNS records: https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-dns-records/
- Cloudflare apex records: https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-zone-apex/
- Cloudflare proxy status: https://developers.cloudflare.com/dns/proxy-status/
- Cloudflare Full strict SSL: https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/
