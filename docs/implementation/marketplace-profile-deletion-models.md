# Implementation map

## Existing architecture reused

- React/Vite shell: `apps/web/src/main.tsx`, `apps/web/src/app-shell.ts`, `apps/web/src/styles.css`
- Fastify routes and domain store: `services/api/src/cp2/routes.ts`, `services/api/src/cp2/store.ts`
- PostgreSQL compatibility persistence: `services/api/src/cp2/postgres-store.ts`
- Shared contracts: `packages/shared-types/src/index.ts`
- Render services and cron jobs: `render.yaml`

No parallel application or authentication service is introduced.

## Auth flow

The initial no-shop/no-owner state no longer sets `shouldShowSignup`. Marketplace remains visible.
Selecting Sell opens the existing setup surface in this order:

1. Phone number and Firebase SMS verification.
2. Four-digit owner PIN creation (or recognition of an existing PIN account).
3. Business name and language.
4. Existing `POST /businesses` creation and seller-mode activation.

The account icon opens PIN login. Normal login calls `POST /auth/pin/login` directly. OTP controls
only appear inside first-shop registration or PIN recovery.

## Marketplace and agent profile

The intro card is inserted after the stable welcome message. Anonymous completion uses a versioned
local marker; authenticated completion is mirrored through:

- `GET /v1/marketplace-intro`
- `POST /v1/marketplace-intro/complete`

The state is included in `Cp2Snapshot` and PostgreSQL normalized persistence. The chat agent name is
a native button and routes to the existing `AgentProfileSurface`.

## AI models

The curated server registry is exposed by `GET /v1/ai-models`. Business selection uses:

- `GET /businesses/:businessId/ai-model`
- `PUT /businesses/:businessId/ai-model`

Activation requires `membership:manage`, validates availability, records an audit event, persists
in snapshots, and overrides the browser-supplied runtime profile model for subsequent turns.
Hosted profiles remain unavailable until `OPENAI_API_KEY` is configured.

## Deletion and restore

Deletion routes are:

- `GET /businesses/:businessId/shop-deletion/preview`
- `POST /businesses/:businessId/shop-deletion/request`
- `POST /businesses/:businessId/shop-deletion/:requestId/finalize`
- `POST /businesses/:businessId/shop-deletion/:requestId/restore`

Finalize verifies the owner PIN and places the tenant in `QUARANTINED` for 30 days. Quarantined
shops are excluded from account shop lists and business authorization returns HTTP 410. Restore
removes that guard before expiry. `pnpm db:purge-shops` permanently removes expired tenant data;
Render runs it daily as `soko-market-shop-purge`.

Migration `020_marketplace_deletion_models.sql` adds normalized persistence tables and the deletion
archive manifest table. PostgreSQL startup now requires migration 020.

## Deployment

1. Apply migrations with `pnpm db:migrate`.
2. Confirm the API has `FIREBASE_PROJECT_ID` and the web service has all `VITE_FIREBASE_*` values.
3. Deploy API and web from the same commit.
4. Confirm the `soko-market-shop-purge` cron has both database URLs.
5. Smoke test anonymous Marketplace, first Sell, Firebase OTP, PIN login, model activation,
   quarantine, and restore.
