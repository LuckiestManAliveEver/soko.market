# Soko Market Deployment

Soko Market is deployed from this monorepo as one public Render web service. The Node/Fastify
process serves both the API and the built Vite application from `https://soko.market`.

## Production topology

- Repository: `LuckiestManAliveEver/soko.market`
- Branch: `main`
- Public service: `soko-market` (`runtime: node`)
- Public domain: `soko.market`
- Legacy API alias: `api.soko.market` (temporary cached-client compatibility)
- Storefront wildcard: `*.soko.market`
- API metadata: `https://soko.market/api`
- Liveness: `https://soko.market/health/live`
- Readiness: `https://soko.market/health/ready`
- Database health: `https://soko.market/health/db`
- Private OCR worker: `soko-market-ocr-worker`
- Rate-limit cache: `soko-market-rate-limit-cache`

The production frontend is not a separate Render Static Site. `pnpm build:production` builds the
web bundle and API, and Fastify serves `apps/web/dist` with SPA fallback and production cache and
security headers.

## First cutover

1. Push the migration commit to `main` and sync the Render Blueprint.
2. Create or adopt the `soko-market` web service from `render.yaml`.
3. Copy all secret values from the old `soko-market-api` service into the matching `sync: false`
   variables on `soko-market`. Do not generate new authentication, encryption, VAPID, inference,
   or webhook secrets during the move.
   At minimum, preserve `OTP_HMAC_SECRET`, `PASSWORD_HASH_SECRET`, `AUTH_AUDIT_HMAC_SECRET`,
   `PIN_HASH_SECRET`, `AUTH_TOKEN_ENCRYPTION_KEY`, and `SOKO_INFERENCE_SERVICE_TOKEN` exactly.
4. Point `DATABASE_URL` and `DIRECT_DATABASE_URL` at the existing production Neon database. This
   moves the application process, not the merchant data.
5. Confirm `soko-market` can reach `soko-market-ocr-worker` and
   `soko-market-rate-limit-cache` through the Blueprint references.
6. Deploy `soko-market` and wait for `/health/ready` to return `200` before changing DNS.
7. Move the `soko.market`, `api.soko.market`, and `*.soko.market` custom domains to `soko-market`
   in Render.
8. In Cloudflare, point the apex and wildcard records at the DNS target Render shows for
   `soko-market`. Keep records DNS-only while Render verifies certificates.
9. Update the workspace Render webhook endpoint to
   `https://soko.market/internal/render/deploy-webhook` and keep its existing signing secret.
10. Verify the checklist below, then suspend the old `soko-market-api` and `soko-market-web`
    services. Delete them only after logs show no traffic reaching either service.

## Required environment

Non-secret production values are declared in `render.yaml`, including:

```text
NODE_ENV=production
API_HOST=0.0.0.0
VITE_API_BASE_URL=https://soko.market
WEB_ORIGINS=https://soko.market,https://www.soko.market
APP_URL=https://soko.market
AUTH_ALLOWED_REDIRECT_ORIGINS=https://soko.market,https://www.soko.market
WEBAUTHN_RP_ID=soko.market
WEBAUTHN_EXPECTED_ORIGINS=https://soko.market,https://www.soko.market
COOKIE_SECURE=true
COOKIE_SAME_SITE=lax
CP2_STORE=postgres
```

Every `sync: false` value must be supplied in the Render dashboard. Preserve existing values when
moving from the old service, especially database URLs, hash/encryption secrets, VAPID keys,
`SOKO_INFERENCE_SERVICE_TOKEN`, model-storage credentials, provider tokens, and
`RENDER_DEPLOY_WEBHOOK_SECRET`.

Before deploying, verify `SOKO_INFERENCE_SERVICE_TOKEN` has the exact same value in the Vercel
inference project. A mismatch makes every proxied inference request fail authentication.

## Verification

Run these checks after the domain is attached:

```bash
curl --fail https://soko.market/health/live
curl --fail https://soko.market/health/ready
curl --fail https://soko.market/health/db
curl --fail https://soko.market/api
curl --fail --header 'Accept: text/html' https://soko.market/
```

Then verify in a browser:

1. `https://soko.market` loads the application and a nested client route survives refresh.
2. Sign-in and sign-out work with same-origin cookies.
3. API calls target `https://soko.market`, not the retired API subdomain.
4. Passkey registration and authentication use RP ID `soko.market`.
5. A storefront wildcard hostname redirects to its canonical `/agent/soko.<handle>` route.
6. The service worker, manifest, icons, and hashed assets return successfully.
7. A successful Render deploy produces one update notification for service `soko-market`.
8. `https://api.soko.market/health/ready` reaches the API rather than storefront resolution.

Keep the `api.soko.market` alias while installed PWAs or cached bundles still call it. Remove the
alias and its DNS record only after service access logs show no meaningful legacy traffic across a
full client-update window.

## Rollback

Before retiring the old services, rollback is a DNS/custom-domain move: reattach `soko.market` to
the previous frontend and restore its API setting while leaving the shared database untouched.
After the old services are removed, roll back by deploying the previous known-good commit to
`soko-market`. Database migrations must follow their documented rollback procedure; do not point
two writable production API services at the database for an extended period.
