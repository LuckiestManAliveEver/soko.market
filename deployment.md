# Soko Market Deployment

This is the deployment runbook for testing Soko Market with:

- GitHub for source code
- Render for the frontend and backend
- Cloudflare for DNS
- MongoDB Atlas for test persistence
- Web domain: `soko.market`
- API domain: `api.soko.market`

Cloudflare is already registered and active for `soko.market`. Do not repeat domain registration or nameserver setup. The remaining work is to connect Render to GitHub, deploy both Render services, add the DNS records Render asks for in Cloudflare, and prepare Atlas for database-backed persistence.

Atlas is feasible for this project as the test database. The current API still uses an in-memory store, so setting `MONGODB_URI` prepares the environment but does not persist app data until a Mongo-backed store adapter is implemented.

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
APP_URL=https://soko.market
AUTH_ALLOWED_REDIRECT_ORIGINS=https://soko.market,https://www.soko.market
```

Set a stable encryption secret and both credentials for every OAuth provider you want to enable:

```text
AUTH_TOKEN_ENCRYPTION_KEY=<generated random secret>
OAUTH_GOOGLE_CLIENT_ID=<Google client ID>
OAUTH_GOOGLE_CLIENT_SECRET=<Google client secret>
OAUTH_FACEBOOK_CLIENT_ID=<Facebook app ID>
OAUTH_FACEBOOK_CLIENT_SECRET=<Facebook app secret>
```

Use the equivalent `OAUTH_<PROVIDER>_CLIENT_ID` and
`OAUTH_<PROVIDER>_CLIENT_SECRET` variables declared in `render.yaml` for TikTok, Apple, GitHub,
Microsoft, LinkedIn, or X. Register this exact web callback with each enabled provider:

```text
https://soko.market/auth/oauth/callback
```

OAuth remains disabled for a provider until both its client ID and client secret are present.

Set these when the Twilio Verify trial is ready:

```text
TWILIO_VERIFY_ENABLED=true
TWILIO_ACCOUNT_SID=<Twilio account SID>
TWILIO_AUTH_TOKEN=<Twilio auth token>
TWILIO_VERIFY_SERVICE_SID=<Twilio Verify service SID>
```

Set this when the Atlas cluster is ready:

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

## 4. Add MongoDB Atlas For Test Persistence

Use Atlas Free/M0 for test persistence while the app is on Render free tier.

1. Log in to MongoDB Atlas.
2. Create or open an Atlas project for Soko Market.
3. Create a Free/M0 cluster.
4. Choose a region close to the Render region if available.
5. Create a database user with a generated password.
6. Copy the Atlas connection string.
7. Replace the username and password placeholders in the connection string.
8. In Render, open `soko-market-api`.
9. Go to Environment.
10. Set `MONGODB_URI` to the Atlas connection string.
11. Redeploy `soko-market-api`.

For Render free-tier testing, Atlas network access needs special attention:

- Render free services do not provide one stable outbound IP for Atlas allowlisting.
- For a short test, use broad Atlas network access only if you understand the exposure.
- Keep the database user password strong and unique.
- Restrict Atlas network access before any real merchant data is stored.

Persistence status:

- `MONGODB_URI` is already present in `render.yaml`.
- The deployment environment can receive the Atlas connection string now.
- App data is still in-memory until the backend store is changed to use MongoDB.
- Do not rely on Atlas for saved users, businesses, invoices, payments, launch state, or audit events until the Mongo-backed store adapter is implemented and tested.

Recommended implementation order:

1. Add the official MongoDB Node driver to `@soko/api`.
2. Add a persistence interface behind the current CP2 store.
3. Keep the in-memory store for fast tests.
4. Add a Mongo-backed store for deployed environments.
5. Start with auth, sessions, businesses, memberships, products, customers, invoices, and audit events.
6. Then add payments, logistics, notifications, runtime turns, beta readiness, and launch readiness.
7. Add indexes for `businessId`, `userId`, `sessionId`, timestamps, and high-volume list endpoints.

## 5. Add Twilio Verify Free Trial For Phone OTP

Use Twilio Verify for hosted phone OTP while testing. This uses Twilio's trial/free account path, not a permanently free SMS product.

1. Create or open a Twilio account.
2. Open the Twilio Console.
3. Copy the Account SID.
4. Copy the Auth Token.
5. Go to Verify.
6. Create a Verify Service for Soko Market.
7. Copy the Verify Service SID, which starts with `VA`.
8. If the account is a Twilio trial account, verify every recipient phone number you want to test with.
9. In Render, open `soko-market-api`.
10. Go to Environment.
11. Set `TWILIO_VERIFY_ENABLED=true`.
12. Set `TWILIO_ACCOUNT_SID`.
13. Set `TWILIO_AUTH_TOKEN`.
14. Set `TWILIO_VERIFY_SERVICE_SID`.
15. Redeploy `soko-market-api`.

Runtime behavior:

- If all three Twilio env vars are set, phone OTP requests use Twilio Verify SMS.
- `TWILIO_VERIFY_ENABLED` must be `true`; otherwise the API keeps local OTP behavior.
- If Twilio env vars are missing, the API keeps the local dev OTP behavior.
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

If Atlas is configured, also verify the backend has the environment variable:

1. Open `soko-market-api` in Render.
2. Go to Environment.
3. Confirm `MONGODB_URI` is set.
4. Check backend logs for database connection errors after redeploy.

Remember: `MONGODB_URI` being set does not prove persistence is active until the Mongo-backed store adapter exists.

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
2. Confirm `TWILIO_ACCOUNT_SID` is set on `soko-market-api`.
3. Confirm `TWILIO_AUTH_TOKEN` is set on `soko-market-api`.
4. Confirm `TWILIO_VERIFY_SERVICE_SID` is set on `soko-market-api`.
5. Confirm the service SID starts with `VA`.
6. If using a Twilio trial account, confirm the recipient phone number is verified in Twilio.
7. Confirm the phone number is in E.164 format, for example `+254700000000`.
8. Check Render logs for `otp_provider_failed`.

If Atlas connection fails after the Mongo adapter is implemented:

1. Confirm `MONGODB_URI` is set on `soko-market-api`.
2. Confirm the Atlas database user still exists.
3. Confirm the Atlas password in Render matches the database user password.
4. Confirm Atlas Network Access allows Render outbound traffic.
5. Check Render logs for MongoDB authentication or network timeout errors.

## 13. Free-Tier Notes

Render free web services can spin down after idle time. The first API request after idle can take about one minute.

The current app store is in-memory. Test data can disappear when the API restarts, redeploys, or spins down. Use this setup for testing until persistent storage is implemented.

Atlas Free/M0 is appropriate for test data and proof-of-concept usage. Do not treat it as production-ready storage for real merchant data.

Twilio's trial path is appropriate for verifying the integration, not for permanent free production SMS.

## 14. Reference Docs

- Render custom domains: https://render.com/docs/custom-domains
- Render Blueprint YAML: https://render.com/docs/blueprint-spec
- Render outbound IPs: https://render.com/docs/outbound-ip-addresses
- MongoDB Atlas free cluster: https://www.mongodb.com/docs/atlas/tutorial/deploy-free-tier-cluster/
- MongoDB Atlas free/shared limits: https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/
- Twilio Verify verifications: https://www.twilio.com/docs/verify/api/verification
- Twilio Verify checks: https://www.twilio.com/docs/verify/api/verification-check
- Twilio Verify pricing: https://www.twilio.com/en-us/verify/pricing
- Cloudflare DNS records: https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-dns-records/
- Cloudflare apex records: https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-zone-apex/
- Cloudflare proxy status: https://developers.cloudflare.com/dns/proxy-status/
- Cloudflare Full strict SSL: https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/
