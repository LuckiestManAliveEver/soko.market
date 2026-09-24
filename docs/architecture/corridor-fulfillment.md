# Corridor Fulfillment — Architecture

Status: **Phase 0 and Phases 1a–1c are implemented and merged (PRs #56–#58; see §§11–13).
Phase 2 now includes deterministic policy evaluation, persisted approvals, vehicle/day
reservations, departure, and a transactional fulfillment outbox. Scheduled execution, outbox
delivery, runtime tools, and the driver view remain open. Phase 3 order-channel integration has
not started.**

The owner asked to continue past Phase 0 ("continue and fix any gaps"). Phase 1a therefore
adopts the recommendation of every §9 decision it depends on (D1 = option A, D2, D6, D7, D8,
D10). D3, D4, D5, D9 and D11 are still open; none of them blocks Phase 1a.

This document records what the repository actually contains. The phased prompt ("Soko Corridor
Fulfillment — Phased Agent Prompts v4", Part A) assumes some things that turned out to be wrong.
Where they disagree, this document follows the repository and records the disagreement as a
conflict (§8). It does not bend the repository to fit the prompt.

---

## 0. Executive summary

The most important findings, in order of impact:

1. **There is no Prisma.** Persistence is a hand-written, synchronous, in-memory `Cp2Store`
   (`services/api/src/cp2/store.ts`, about 12k lines, plus domain slices under
   `services/api/src/cp2/domains/*`). It is loaded in full from Postgres at boot and written back
   **asynchronously** by a whole-snapshot writer (`services/api/src/cp2/postgres-store.ts`). The
   raw driver is `pg` (node-postgres). Migrations are hand-written SQL in `infra/db/migrations`,
   applied by `services/api/scripts/migrate-db.mjs`. `infra/db/schema.ts` (Drizzle) is a partial
   declaration and is never imported at runtime.
2. **Part A §A17 cannot be implemented inside the existing in-memory store.** In the Cp2Store
   model, a request mutates JS `Map`s and gets its response before Postgres sees the change. A
   partial unique index, a `SELECT … FOR UPDATE`, or a CHECK constraint on tables the snapshot
   writer manages would only be evaluated later, during the asynchronous flush. If one fails, the
   error arrives after the client already got `200`, and it fails the **global, all-tenant**
   snapshot transaction, which then keeps retrying with backoff
   (`docs/single-instance-store-ceiling.md`). A database-backed invariant has to live in tables
   that are written **synchronously inside the request's own Postgres transaction**. §5 gives a
   recommended design, and decision D1 asks the owner to approve it.
3. **A logistics domain already exists and must be reused, not duplicated.** It has:
   - `LogisticsSummary`: one per invoice, with `method: delivery|pickup` and
     `status: pending|ready|out_for_delivery|completed|cancelled`, a transition validator, and
     `logistics:read/write` permissions;
   - `LocationSummary`, with latitude/longitude range validation;
   - `DeliveryRouteSummary` and `DeliveryRouteStopSummary`, with `geometry: string | null`,
     `distanceMeters`, and statuses `PLANNED|IN_PROGRESS|COMPLETED|CANCELLED`;
   - runtime tools `logistics.update_status`, `route.record` and `route.history`;
   - UI modules `LogisticsSurface`, `LogisticsManagementCard` and `DeliveryRoutesCard`.
4. **The canonical Order is `InvoiceSummary`.** Every sales channel ends in an invoice: POS/owner
   UI, storefront `PublicOrderSummary.invoiceId`, authenticated buyer `BuyOrderSummary.invoiceId`,
   agent `commerce.checkout`, and offline sync `orders.createInvoice`. Invoice status is only
   `draft | confirmed`. **Confirmed invoices are immutable and there is no cancellation.**
   Payment status is derived separately (`InvoicePaymentSummary.status`), so commercial and
   payment state are already distinct.
5. **The sellable unit is `ProductSummary`.** There are no variants, packs, or SKU entities
   (`sku` is a text attribute). **Invoice line quantities are fractional JS `number`s**
   (`isPositiveQuantity` allows `2.5`), which conflicts with integer-gram multiplication (§8
   C4).
6. **The delivery "shop" is `CustomerSummary`.** It is the seller business's customer, and it
   has no location today. The tenant is `BusinessSummary`. "Store" is not a model.
7. **Roles are a fixed `BusinessRole → BusinessPermission` map**
   (`packages/business-core/src/domains/roles.ts`). The roles are
   `owner | manager | sales_agent | cashier | view_only`. There is no dispatcher or driver role,
   and there are no per-membership capability grants.
8. **CI has no PostgreSQL service.** All 7 Postgres-backed test files skip when
   `CP2_POSTGRES_TEST_DATABASE_URL` is unset, and CI does not set it (`.github/workflows/ci.yml`).
9. **An inbound Telegram adapter already exists.** It has an authenticated webhook and
   `sendMessage` (`services/api/src/messaging/channel-gateway.ts`). The claim in Part A that "no
   inbound adapters exist" is false.
10. **MCP does not expose domain tools directly.** It exposes `soko.runtime_turn` and
    `soko.confirm_runtime_action`, and `scripts/check-boundaries.mjs` **fails CI** if
    `services/api/src/mcp/routes.ts` calls store mutations directly. The Phase 2 tools named
    `fulfillment.*` must be runtime-tool-registry entries reached through the runtime turn, not
    new MCP methods (§8 C11).

---

## 1. Evidence matrix (Part A §A2)

| #   | Claim                                                                                             | Evidence path                                                                                                                                      | Symbol / schema / config                                                                                                                                                                                                   | Status         | Notes                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | pnpm monorepo                                                                                     | `pnpm-workspace.yaml`; `package.json`                                                                                                              | `packages: apps/*, services/*, packages/*`; `"packageManager": "pnpm@10.28.2"`                                                                                                                                             | VERIFIED       | Workspaces: `apps/{web,android}`, `services/{api,ai-runtime,computer-runtime,receipt-ocr-service,sync}`, `packages/{business-core,event-core,observability,offline-runtime,resource-control,shared-types,sync-core,tool-core,ui}`.                                                                                                                                                                                           |
| 2   | React PWA frontend                                                                                | `apps/web/src/*.tsx`, `apps/web/package.json`                                                                                                      | `SokoApplication.tsx`, `OwnerWorkspace.tsx`, `StackedModule.tsx`                                                                                                                                                           | VERIFIED       | Served by the same Fastify service as the API (`render.yaml` `soko-market`).                                                                                                                                                                                                                                                                                                                                                 |
| 3   | Node.js/TypeScript backend                                                                        | `services/api/package.json`, `services/api/src/app.ts`                                                                                             | Fastify 5, `"engines": node >=22.19 <23`                                                                                                                                                                                   | VERIFIED       |                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 4   | **Prisma ORM**                                                                                    | repo-wide search: no `schema.prisma`, no `@prisma/client`                                                                                          | —                                                                                                                                                                                                                          | **FALSE**      | Runtime uses `pg` `Pool`/`PoolClient` (`postgres-store.ts`, `db-pool-config.ts`). `drizzle-orm`/`drizzle-kit` are root devDependencies. `infra/db/schema.ts` is partial and never imported at runtime. Migrations are hand-written SQL. `docs/architecture/soko-id-slug-system.md` §1 records the same finding. **Every later phase must replace "Prisma interactive transaction" with a `pg` `PoolClient` `BEGIN…COMMIT`.** |
| 5   | Neon Postgres                                                                                     | `docs/deployment/neon-model-bindings.md:8`; `package.json` `db:verify-neon-production`; `db-pool-config.ts` `.neon.tech` SSL detection             | `DATABASE_URL=…-pooler…`                                                                                                                                                                                                   | VERIFIED       | The runtime uses the Neon **pooler** URL. Migrations use `DIRECT_DATABASE_URL`, which is required in production (`migrate-db.mjs:14-18`).                                                                                                                                                                                                                                                                                    |
| 6   | Backend deployed on Render                                                                        | `render.yaml`                                                                                                                                      | service `soko-market`, `plan: starter`, `db:migrate` inside `buildCommand`                                                                                                                                                 | VERIFIED       | Single instance. `docs/database-operations.md` says migrations run as a `preDeployCommand`, but `render.yaml` actually runs `db:migrate` in `buildCommand`. That doc is stale.                                                                                                                                                                                                                                               |
| 7   | GitHub repo `LuckiestManAliveEver/soko.market`                                                    | git remote; session scope                                                                                                                          | —                                                                                                                                                                                                                          | VERIFIED       |                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 8   | "Everything is an API", modules-not-windows                                                       | `docs/architecture/stacked-owner-modules.md`, `StackedModule.tsx`, `generated-surface-registry.tsx`                                                | —                                                                                                                                                                                                                          | PARTIALLY_TRUE | The module/card pattern is visible and enforced (line budgets in `check-boundaries.mjs`). The phrase "everything is an API" does not appear literally. The practice matches it: every UI operation is an HTTP call via `apps/web/src/lib/api.ts` `apiFetch`.                                                                                                                                                                 |
| 9   | Frontend has zero direct DB access; UI/API/agents/MCP call the same domain operations             | `apps/web/src` imports; `check-boundaries.mjs`; `services/api/src/mcp/routes.ts`                                                                   | `store.createRuntimeTurnForMcp`, `executeRuntimeCapability` only in `agent-runtime/store.ts`                                                                                                                               | VERIFIED       | No `pg` or `services/api` import in `apps/web/src`. The web app does not _import_ the API (comments only mention paths). The boundary script enforces a single `createRuntimeTurn` and a single `runtimeToolRegistry`, and forbids MCP routes from calling `createProduct/updateProduct/deleteProduct/createCustomer/recordPayment`. There is no generic "frontend cannot import DB" rule; it holds by construction.         |
| 10  | `check-boundaries.mjs` enforces boundaries in CI                                                  | `scripts/check-boundaries.mjs`; `package.json` `ci` script                                                                                         | `pnpm check:boundaries` in `pnpm run ci`                                                                                                                                                                                   | VERIFIED       | Enforced rules: business-core may not depend on AI runtime; the chat hook may not use form setters; tool-core may not import React/web; no deep imports of a sibling domain's `store.js`/`shared.js` under `cp2/domains`; no retired fabric terminology; exactly one `createRuntimeTurn` and one registry; MCP must use the runtime turn; the capability dispatcher must not duplicate authorization; per-file line budgets. |
| 11  | CI: typecheck ~10 projects, lint, format, boundaries, Android checks, ~930 tests                  | `.github/workflows/ci.yml`; `package.json` `ci`, `typecheck`                                                                                       | `pnpm run ci` = format + lint + typecheck + test + esm-imports + `android:identity:verify` + `android:legal:verify` + boundaries + shellview-boundary + web-bundle-budgets; then `test:ui-cert` (Playwright)               | PARTIALLY_TRUE | 14 workspace packages declare `typecheck`, not about 10. A static count finds about **1,455** `it(`/`test(` declarations across `tests/`, `packages/`, and `services/`, not about 930 (tests were not run in this phase because dependencies are not installed). The Android checks are release-identity/legal _verification scripts_, not Gradle builds. **There is no Postgres service in CI.**                            |
| 12  | Agent Execution Fabric retired                                                                    | `infra/db/migrations/065_retire_execution_fabric.sql:271-273`; `scripts/check-retired-runtime-references.mjs`; `check-boundaries.mjs` fabric sweep | `drop table cp2_runtime_model_installations / cp2_runtime_hosts / cp2_model_preferences`                                                                                                                                   | VERIFIED       | Only `cp2/retired-execution-fabric-tables.ts` may name it.                                                                                                                                                                                                                                                                                                                                                                   |
| 13  | Runtime binding tables `agents, models, agent_model_bindings, runtime_instances, execution_hosts` | `infra/db/migrations/063_native_runtime_bindings.sql`; `076_drop_legacy_agent_model_bindings.sql:42`; `083_runtime_handoff_protocol.sql:135`       | `cp2_native_runtime_agents`, `cp2_native_runtime_models`, `cp2_native_execution_hosts`, `cp2_native_model_installations`, `cp2_native_runtime_bindings`, `cp2_native_runtime_binding_models`, `cp2_runtime_task_instances` | PARTIALLY_TRUE | The concepts exist under different names. `cp2_agent_model_bindings` was **dropped** (076). "runtime_instances" is adapted as `cp2_runtime_task_instances`. Fulfillment does not depend on any of this.                                                                                                                                                                                                                      |
| 14  | `MessageChannel` **enum** in shared types incl. Soko, SMS, WhatsApp, Telegram…                    | `packages/shared-types/src/index.ts:419`                                                                                                           | `export type MessageChannel = "soko" \| "sms" \| "mms" \| "rcs_business" \| "whatsapp_business" \| "telegram" \| "facebook_messenger" \| "instagram_messaging" \| "tiktok_business" \| "x_dm" \| "native_sms" \| "email"`  | PARTIALLY_TRUE | It is a **string-literal union**, not a TS `enum`. The literals are `whatsapp_business`, `tiktok_business` and `instagram_messaging`, not `WHATSAPP`/`TIKTOK`/`INSTAGRAM`. `providerToMessageChannel()` (`channel-gateway.ts:436`) maps `ChannelProvider → MessageChannel`.                                                                                                                                                  |
| 15  | No inbound external channel adapters                                                              | `services/api/src/messaging/channel-gateway.ts:475-560`; `docs/architecture/omnichannel-messaging-gateway.md`                                      | `class TelegramChannelAdapter` (webhook secret header `x-telegram-bot-api-secret-token`, `sendMessage`), `ingestChannelWebhook`, `ingestProviderMessage`; `createNativeSmsChannelAdapter`, `createEmailChannelAdapter`     | **FALSE**      | Telegram inbound/outbound is **implemented**, and so are Android native SMS and a connected email mailbox. WhatsApp, Messenger, Instagram, TikTok, X and server SMS are `disabledAdapter(...)` placeholders with explicit requirements. Phase 3 must **extend** these adapters, not create them.                                                                                                                             |
| 16  | Stores have immutable ULID/UUID identifiers                                                       | `services/api/src/cp2/store.ts` (`randomUUID()` throughout); `002_cp5_business_core_records.sql` `id uuid PRIMARY KEY`                             | `BusinessSummary.id`                                                                                                                                                                                                       | PARTIALLY_TRUE | UUID v4 (`node:crypto randomUUID`), **not ULID**. The entity is `Business`; there is no `Store` model. IDs are immutable. Envelope tables use `entity_id text`.                                                                                                                                                                                                                                                              |
| 17  | Slugs resolved via `resolveStoreBySlug()`                                                         | `services/api/src/cp2/store.ts:11146-11150`; `docs/architecture/soko-id-slug-system.md`                                                            | `resolveBusinessBySokoId(sokoId): SokoIdResolution \| null`                                                                                                                                                                | PARTIALLY_TRUE | The abstraction exists under the name `resolveBusinessBySokoId`, with `sokoId` handles such as `soko.<handle>` and history/cooldown. `resolveStoreBySlug` does not exist.                                                                                                                                                                                                                                                    |
| 18  | UI supports English, Swahili and Sheng                                                            | `packages/shared-types/src/index.ts:209`; `apps/web/src/owner-app-bootstrap.ts:56`; `apps/web/src/soko-application-shared.ts:1814`                 | `SupportedLanguage = "en" \| "sw"`                                                                                                                                                                                         | PARTIALLY_TRUE | Only `en` and `sw` are supported languages. "Sheng" appears only as an agent tone hint in a prompt string. New fulfillment UI copy needs `en`/`sw`. Sheng is not a locale.                                                                                                                                                                                                                                                   |

### Additional facts discovered (not in A2, but material)

| Fact                                                                                                                                                                                                                 | Evidence                                                                                                                                                                                                                                   | Consequence                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The authoritative store is in-memory, single-instance, async-persisted                                                                                                                                               | `docs/single-instance-store-ceiling.md`; `postgres-store.ts` `normalizedCollections`, the `mutatingMethodNames` Proxy (`:1127`), `saveNormalizedSnapshot` (`:2314`)                                                                        | §5; C1                                                                                                                                                                                                       |
| The snapshot writer deletes rows it does not hold in memory (`delete from invoices where not (id = any($1))`) and delete-and-reinserts `invoice_items` on every save                                                 | `postgres-store.ts:4035-4085`                                                                                                                                                                                                              | New tables **must not** hold FKs into snapshot-managed tables with `RESTRICT`, and must never be written by the snapshot writer and by fulfillment at the same time                                          |
| Snapshot records are compared and persisted with `JSON.stringify`                                                                                                                                                    | `postgres-store.ts` `collectionUnchanged`                                                                                                                                                                                                  | A JS `bigint` stored in any in-memory record would throw `TypeError`. **In-memory gram values must be decimal strings** (C5)                                                                                 |
| `pg` returns `int8`/`BIGINT` as JS `string` by default (no `setTypeParser` anywhere)                                                                                                                                 | repo-wide search for `setTypeParser`: none                                                                                                                                                                                                 | Matches the A22 decimal-string wire format. Domain code must `BigInt(row.x)` explicitly                                                                                                                      |
| No `SELECT … FOR UPDATE` anywhere; the only DB locks are **session-level** `pg_advisory_lock(hashtext('soko.cp2.normalized_store'))` in the snapshot writer and `hashtext('soko.schema_migrations')` in the migrator | `postgres-store.ts:2324, 2620`; `migrate-db.mjs`                                                                                                                                                                                           | §6. Pre-existing risk, noted but not fixed: a session advisory lock on the Neon **pooler** URL is unsafe if the pooler is in transaction mode (the lock and unlock can land on different server connections) |
| A precedent exists for per-request async Postgres storage outside the snapshot                                                                                                                                       | `services/api/src/cp2/account-ai-asset-store.ts` (`AccountAiAssetStore` with memory and Postgres implementations, own pool `model_artifact_store` in `services/api/src/index.ts:92`)                                                       | Basis for the recommended D1 option                                                                                                                                                                          |
| A precedent exists for partial unique indexes on JSONB-envelope tables                                                                                                                                               | `078_commercial_history.sql` `cp2_purchase_price_one_current_idx … where record->>'effectiveTo' is null`                                                                                                                                   | They are checked only at async flush. **Not** acceptable as the A17 allocation invariant (C1)                                                                                                                |
| Idempotency exists in three narrow, in-memory forms                                                                                                                                                                  | `RuntimeHandoffDomain.withIdempotency` → `cp2_runtime_operation_dedup`; `UnifiedCheckoutSummary.idempotencyKey`; message `idempotencyKey`; `externalSourceId` on routes/purchases/sales; `idempotency-key` request header via `readHeader` | None stores a request hash or rejects "same key, different body". None is transactional with Postgres. A23 is `NEW` for fulfillment, reusing the header convention                                           |
| No outbox. Events are the in-memory `appendBusinessEvent` → `auditEvents` → `cp2_audit_events`                                                                                                                       | `store.ts:11015`; `packages/event-core/src/index.ts` `createEvent`                                                                                                                                                                         | Phase 1: structured logs. Phase 2: a narrow outbox (only possible transactionally under D1 option A)                                                                                                         |
| No business timezone anywhere                                                                                                                                                                                        | `BusinessSummary` (`shared-types:232`); no `timezone` column in migrations                                                                                                                                                                 | A11 `NEW`                                                                                                                                                                                                    |
| No `Vehicle` model                                                                                                                                                                                                   | repo-wide search                                                                                                                                                                                                                           | A7 `NEW`. `SupplierContactRole "DRIVER"` is a _supplier's_ contact role, not a fleet driver                                                                                                                  |
| No order source or creating actor on invoices                                                                                                                                                                        | `InvoiceSummary`, `invoices` table                                                                                                                                                                                                         | 1c `NEW` (`source`, `createdByUserId`, both nullable for history)                                                                                                                                            |
| Offline replay of invoice operations                                                                                                                                                                                 | `store.ts:6194-6279` (`orders.createInvoice / updateInvoice / confirmInvoice` via the sync queue)                                                                                                                                          | Confirmation can happen through offline replay, so fulfillment intake must hook the domain operation, not the HTTP route                                                                                     |
| Migration file numbering has duplicate prefixes (`087_*` ×2, `088_*` ×2), ordered lexically                                                                                                                          | `infra/db/migrations`                                                                                                                                                                                                                      | The next free prefix is `089_`                                                                                                                                                                               |
| Rollbacks are `infra/db/rollbacks/NNN_name.down.sql`, run by `db:rollback` (`ALLOW_DB_ROLLBACK=true`, `DB_ROLLBACK_STEPS=n`)                                                                                         | `services/api/scripts/rollback-db.mjs`                                                                                                                                                                                                     | Every new migration ships a `.down.sql`                                                                                                                                                                      |
| API startup refuses to run without a required migration                                                                                                                                                              | `postgres-store.ts:514` `requiredMigrationFilename`; `assertDatabaseMigrated`                                                                                                                                                              | Fulfillment should bump or add a required-migration check                                                                                                                                                    |

---

## 2. Existing model inventory

The tenant key is `businessId` everywhere. Authorization for every business-scoped mutation is
`Cp2Store.requireAuthorizedActor(sessionId, businessId, permission)`
(`store.ts:~9250`). It checks the session (PIN-verified), rejects accounts pending deletion,
rejects missing or quarantined businesses, requires a membership, and checks
`roleCan(membership.role, permission)`. On failure it throws `Cp2Error(403, "permission_denied")`,
or `404 business_not_found` / `410 business_quarantined`.

| Model                                      | Type / file                                                                  | Key fields                                                                                                                                               | Status enums                                                                                                         | Tenant key                   | Service layer                                                                                 | Relational table                                  |
| ------------------------------------------ | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Business (= "store", seller, tenant)       | `BusinessSummary` `shared-types:232`                                         | `id, name, language, sokoId`                                                                                                                             | —                                                                                                                    | self                         | `Cp2Store`                                                                                    | `businesses` (+ `cp2_businesses`)                 |
| Membership                                 | `MembershipSummary` `shared-types:291`                                       | `businessId, userId, role`                                                                                                                               | `BusinessRole = owner\|manager\|sales_agent\|cashier\|view_only`                                                     | `businessId`                 | `requireMembership`                                                                           | `business_memberships`                            |
| Product (= sellable unit)                  | `ProductSummary` `shared-types:1317`                                         | `id, businessId, name, sku?, unit:string, quantity:number (stock), buyingPrice, sellingPrice, fieldValues`                                               | —                                                                                                                    | `businessId`                 | `SalesDomain` `domains/sales/store.ts`                                                        | `products` (`quantity numeric`)                   |
| Customer (= delivery shop)                 | `CustomerSummary` `shared-types:1478`                                        | `id, businessId, name, phone, email, linkedAccountId, notes`                                                                                             | —                                                                                                                    | `businessId`                 | `SalesDomain.createCustomer/updateCustomer/createGuestCustomer`                               | `customers`                                       |
| Invoice (= canonical Order)                | `InvoiceSummary` `shared-types:2184`                                         | `id, businessId, invoiceNumber, status, customerId?, customerName?, items[], subtotal, taxRate, taxTotal, total, confirmedAt`                            | `InvoiceStatus = draft\|confirmed` (no cancel)                                                                       | `businessId`                 | `SalesDomain.createInvoice/updateInvoice (draft only)/confirmInvoice`                         | `invoices`                                        |
| Invoice line                               | `InvoiceItemSummary` `shared-types:2167`                                     | `id, invoiceId, productId, productName, quantity:number, unitPrice, lineTotal`                                                                           | —                                                                                                                    | via invoice                  | —                                                                                             | `invoice_items` (`quantity numeric`)              |
| Payment                                    | `PaymentSummary`, `InvoicePaymentSummary`                                    | `method, amount`; derived `paidTotal, balanceDue, status`                                                                                                | `InvoicePaymentStatus = unpaid\|partially_paid\|paid`                                                                | `businessId`                 | `SalesDomain.recordPayment`                                                                   | `payments`                                        |
| Logistics (= per-order fulfillment status) | `LogisticsSummary` `shared-types:2241`                                       | `invoiceId (1:1), method, status, destination:string?, note`                                                                                             | `FulfillmentMethod = delivery\|pickup`; `FulfillmentStatus = pending\|ready\|out_for_delivery\|completed\|cancelled` | `businessId`                 | `LogisticsDomain` `domains/logistics/store.ts`; rules in `business-core/domains/logistics.ts` | `cp2_logistics` (JSONB envelope)                  |
| Location                                   | `LocationSummary` `shared-types:2299`                                        | `label, address, latitude?, longitude?, region, country, providerPlaceId`                                                                                | —                                                                                                                    | `businessId`                 | `CommercialRecordsDomain.createLocation` (private, route-owned)                               | `cp2_locations` (envelope)                        |
| Delivery route                             | `DeliveryRouteSummary` / `DeliveryRouteStopSummary` `shared-types:2313-2340` | `originLocationId, destinationLocationId, provider, distanceMeters?, geometry:string?, stops[{sequence, locationId, contactId, arrivalAt, deliveredAt}]` | `PLANNED\|IN_PROGRESS\|COMPLETED\|CANCELLED`                                                                         | `businessId`                 | `CommercialRecordsDomain.createRoute/updateRoute/listRouteHistory`                            | `cp2_delivery_routes`, `cp2_delivery_route_stops` |
| Sale record                                | `SaleRecordSummary`                                                          | `invoiceId, routeId?, customerContactId?`                                                                                                                | —                                                                                                                    | `businessId`                 | commercial-records                                                                            | `cp2_sale_records`                                |
| Storefront / buyer orders                  | `PublicOrderSummary`, `BuyOrderSummary`, `UnifiedCheckoutSummary`            | each carries an `invoiceId`                                                                                                                              | `HandoffOrderStatus = requested\|accepted\|rejected\|completed\|cancelled`                                           | `businessId` / buyer account | `SalesDomain.createPublicOrder`, `CommerceDomain`                                             | envelope tables                                   |
| Sales agent                                | `SalesAgentSummary`                                                          | a **supplier's** sales rep (receipt OCR matching)                                                                                                        | —                                                                                                                    | `businessId`                 | `SupplierDomain`                                                                              | `sales_agents`                                    |
| Channel identity                           | `PlatformIdentitySummary`, `ConversationChannelSummary`                      | provider identity → customer                                                                                                                             | —                                                                                                                    | `businessId`                 | `MessagingDomain`, `ChannelGateway`                                                           | `platform_identities`, `conversation_channels`    |

Note on field salespeople: `sales_agent` is a `BusinessRole` for the seller's own staff (it has
`invoice:write`, `customer:write` and `logistics:write`). `SalesAgentSummary` is a different
thing: a supplier's representative. Field sales should use the `sales_agent` membership role.

---

## 3. Decision mapping (A4–A23)

Legend: **REUSE** = use as is. **EXTEND** = add fields or behavior to an existing abstraction.
**NEW** = nothing suitable exists. **CONFLICT** = the spec contradicts the repository (see §8).

| Ref                                    | Decision                                                                | Mapping                                                                                                                                                                                                                                                                                                      | Evidence / target                                                                                                                                                                                                            |
| -------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A3.1                                   | No parallel architecture                                                | Fulfillment becomes one more domain beside `sales`, `logistics` and `commercial-records`: `services/api/src/cp2/domains/fulfillment/` plus pure rules in `packages/business-core/src/domains/fulfillment*.ts`, types in `shared-types`, and runtime tools in `packages/tool-core/src/domains/fulfillment.ts` | Domain modularization roadmap                                                                                                                                                                                                |
| A4                                     | `unitWeightGrams` on the sellable unit                                  | **EXTEND** `ProductSummary` / `products`                                                                                                                                                                                                                                                                     | Add `unitWeightGrams: string \| null` in memory (C5) and `unit_weight_grams bigint null check (> 0)` in the table                                                                                                            |
| A4                                     | Line snapshot `unitWeightGramsSnapshot, totalWeightGrams, weightStatus` | **EXTEND** `InvoiceItemSummary` / `invoice_items`; snapshot taken in `SalesDomain.confirmInvoice`                                                                                                                                                                                                            | Confirmed invoices are already immutable, so snapshots cannot drift                                                                                                                                                          |
| A4                                     | Fractional quantity × integer grams                                     | **CONFLICT C4**                                                                                                                                                                                                                                                                                              | `isPositiveQuantity` allows non-integers                                                                                                                                                                                     |
| A5                                     | `calculateOrderFulfillmentWeight`                                       | **NEW**, pure, in `business-core`                                                                                                                                                                                                                                                                            | Operates on line snapshots and returns a discriminated union. Called by the domain, never by the UI                                                                                                                          |
| A3.8                                   | Commercial / payment / fulfillment separation                           | **REUSE**                                                                                                                                                                                                                                                                                                    | `InvoiceStatus` (commercial), `InvoicePaymentStatus` (derived payment), `LogisticsSummary.status` (fulfillment) are already separate. Fulfillment eligibility must never read `InvoicePaymentSummary`                        |
| A6                                     | Shop current location + history + status                                | **NEW**, keyed to `CustomerSummary`                                                                                                                                                                                                                                                                          | `LocationSummary` is a route-owned place record with no customer link, no history, no capture metadata. Reuse its lat/lng validation (`validCoordinate`) and field naming. Storage per D1                                    |
| A6                                     | Coordinate privacy                                                      | **NEW** permission gate                                                                                                                                                                                                                                                                                      | No existing coordinate-visibility rule. Route/location reads use `logistics:read`, which `cashier` and `sales_agent` also hold                                                                                               |
| A7                                     | `Vehicle`                                                               | **NEW**                                                                                                                                                                                                                                                                                                      | Nothing exists                                                                                                                                                                                                               |
| A8                                     | Permissions                                                             | **EXTEND** `BusinessPermission` + `rolePermissions`; **CONFLICT C8** for Dispatcher/Driver                                                                                                                                                                                                                   | There are only 5 fixed roles and no capability grants                                                                                                                                                                        |
| A9                                     | `DispatchPolicy` (versioned)                                            | **NEW**                                                                                                                                                                                                                                                                                                      |                                                                                                                                                                                                                              |
| A10                                    | Minimum-load semantics                                                  | **NEW** (pure, business-core)                                                                                                                                                                                                                                                                                |                                                                                                                                                                                                                              |
| A11                                    | Business timezone                                                       | **NEW** `BusinessSummary.timezone: string \| null` + `businesses.timezone text null`                                                                                                                                                                                                                         | Absent today. Owner's business set via data (§7), never a code default                                                                                                                                                       |
| A12                                    | Order lifecycle interaction                                             | **CONFLICT C6**                                                                                                                                                                                                                                                                                              | Confirmed invoices cannot be edited and there is no cancellation                                                                                                                                                             |
| A13                                    | Computed readiness, flags                                               | **NEW** (pure)                                                                                                                                                                                                                                                                                               |                                                                                                                                                                                                                              |
| A14                                    | Corridor geometry (GeoJSON `LineString` jsonb)                          | **NEW** `Corridor`                                                                                                                                                                                                                                                                                           | `DeliveryRouteSummary.geometry` is an unstructured `string` describing a _trip_, not an established corridor. Do not overload it                                                                                             |
| A15                                    | Deterministic matching                                                  | **NEW** pure module                                                                                                                                                                                                                                                                                          |                                                                                                                                                                                                                              |
| A16                                    | Provenance + staleness                                                  | **NEW**, append-only                                                                                                                                                                                                                                                                                         |                                                                                                                                                                                                                              |
| A17                                    | Transactions, `FOR UPDATE`, partial unique index, lock order            | **CONFLICT C1/C2**. Achievable only in synchronously-written tables                                                                                                                                                                                                                                          | §5–§6                                                                                                                                                                                                                        |
| A18                                    | Real PostgreSQL tests                                                   | **EXTEND** CI                                                                                                                                                                                                                                                                                                | Existing pattern: `describePostgres` gated on `CP2_POSTGRES_TEST_DATABASE_URL`. CI has no service container                                                                                                                  |
| A19                                    | Events: reuse outbox, else logs, then narrow outbox                     | Phase 1: structured `console.info(JSON.stringify({event…}))` / `request.log` (existing idiom) plus existing `recordAuditEvent`/`appendBusinessEvent`. Phase 2: **NEW** narrow outbox                                                                                                                         | No outbox exists                                                                                                                                                                                                             |
| A20                                    | Boundaries                                                              | **EXTEND** `scripts/check-boundaries.mjs`                                                                                                                                                                                                                                                                    | Add rules listed in §6.5                                                                                                                                                                                                     |
| A21                                    | Allocation rules                                                        | **NEW** (pure walk in business-core; transactional application in the service)                                                                                                                                                                                                                               |                                                                                                                                                                                                                              |
| A22                                    | BIGINT wire format                                                      | **NEW** shared serializer/parser in `shared-types` + kg display helper                                                                                                                                                                                                                                       | No `bigint` JSON handling exists. The in-memory snapshot also needs strings (C5)                                                                                                                                             |
| A23                                    | Idempotency                                                             | **NEW** narrow table; **REUSE** the `idempotency-key` header convention (`readHeader`)                                                                                                                                                                                                                       | Existing mechanisms lack request-hash conflict detection and DB transactionality                                                                                                                                             |
| Manifest vs DeliveryRoute              |                                                                         | **CONFLICT C9** (overlap)                                                                                                                                                                                                                                                                                    | Recommendation: Manifest is **NEW** (operational plan with capacity and allocation constraints). A departed or completed manifest may _project into_ `DeliveryRouteSummary` for commercial history, rather than replacing it |
| Canonical per-order fulfillment status |                                                                         | **REUSE/EXTEND** `LogisticsSummary`; **CONFLICT C10** on transitions                                                                                                                                                                                                                                         |                                                                                                                                                                                                                              |

---

## 4. Current transaction and locking reality (the ten audit questions)

1. **Are Prisma interactive transactions used?** No Prisma. The raw `pg` transactions that exist
   are: the snapshot writer (`BEGIN` / many upserts / `COMMIT` on one `PoolClient`, under a
   session advisory lock), passkey ceremony persistence, the account sync journal, the migrator,
   and rollback. **No business-logic request ever opens a DB transaction.** All business
   mutations are synchronous JS against `Map`s.
2. **Is the Neon application connection pooled?** It uses the **Neon pooler** (`-pooler` host,
   `docs/deployment/neon-model-bindings.md`). Neon's pooler is PgBouncer in **transaction mode**.
   The repository cannot confirm the pooler mode, so treat it as transaction mode. The app pool
   is `pg.Pool` with `max = DB_POOL_MAX` (5), 15 s `statement_timeout`/`query_timeout`
   (`db-pool-config.ts`).
3. **Which connection runs migrations?** `DIRECT_DATABASE_URL` (required in production);
   `DATABASE_URL` otherwise (`migrate-db.mjs`). Each migration runs in its own transaction under
   a session advisory lock.
4. **Is `SELECT … FOR UPDATE` used anywhere?** **No.**
5. **Does a transaction with row locks stay pinned to one connection?** With `pg`, yes, when
   every statement runs on the same checked-out `PoolClient` between `BEGIN` and
   `COMMIT`/`ROLLBACK`. PgBouncer transaction mode also pins one server connection for the life
   of a transaction, so `FOR UPDATE` and `pg_advisory_xact_lock` are safe. **Session-level**
   advisory locks, prepared statements across transactions, and `SET` (without `LOCAL`) are
   **not** safe. The rule for fulfillment is: always `const client = await pool.connect()`, run
   `BEGIN`…`COMMIT` on `client`, and never use `pool.query` inside a transaction.
6. **Is there a transaction retry / deadlock convention?** No DB-level convention exists.
   `@soko/resource-control` has a generic `retry` helper (`packages/resource-control/src/retry.ts`)
   and a circuit breaker. The snapshot writer retries whole saves with exponential backoff
   (`DB_PERSISTENCE_RETRY_*`). Fulfillment needs a **NEW** bounded retry wrapper for SQLSTATE
   `40001` (serialization failure), `40P01` (deadlock) and the A17 lock-then-recheck mismatch.
   Default: 3 attempts, configured through `positiveIntegerFromEnv`. It may reuse `retry` from
   `resource-control` if its semantics fit.
7. **Does an existing idempotency implementation handle concurrent inserts?** No. The existing
   ones are in-memory `Map` checks, which are race-free only because Node is single-threaded and
   the methods are synchronous. There is no DB uniqueness and no request-hash conflict detection.
8. **Is there a vehicle/resource-booking abstraction with DB-level collision protection?** No.
9. **Is locking the `Corridor` row compatible with the persistence architecture?** **Only if the
   `corridors` table is written synchronously by fulfillment transactions and never by the
   snapshot writer** (D1 option A). If `Corridor` were an in-memory Cp2Store collection, a
   `FOR UPDATE` on its envelope row would serialize nothing, because the authoritative state is
   the JS `Map`.
10. **Is the A17 global lock order compatible with existing locking in order and payment
    flows?** Yes, trivially. Order and payment flows take **no** DB row locks. The only existing
    DB lock is the snapshot writer's session advisory lock, which fulfillment transactions must
    never take and which only guards snapshot-managed tables. If fulfillment tables are disjoint
    from snapshot-managed tables, no lock cycle between the two is possible.

---

## 5. Recommended architecture (subject to D1)

### 5.1 The core problem

The prompt's concurrency invariants (A17: one active allocation per order, capacity never
exceeded, serialized pool state, idempotency under races) must be **database-backed**. The
repository's business state is **memory-authoritative and persisted after the response**. The two
can be reconciled in only three ways:

| Option              | Description                                                                                                                                                                                                                                                                                                                                                                           | A17 invariants DB-backed?                                                                                                                                                                                                           | Cost / risk                                                                                                                                                                                                                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A (recommended)** | **Fulfillment-owned tables are Postgres-authoritative** and queried per request. They are written only inside fulfillment `pg` transactions and never appear in `normalizedCollections`. Catalogue, invoices, customers and logistics stay in the Cp2Store. Fulfillment copies what it needs (the weight result, the customer reference) into its own rows at a defined intake point. | **Yes**: corridor `FOR UPDATE`, order-row `FOR UPDATE`, partial unique index, CHECKs, idempotency uniqueness, all evaluated before the response                                                                                     | Two persistence styles coexist. This is the documented direction (`single-instance-store-ceiling.md` "Recommended path" §3: move collections one at a time to "queried from Postgres per request"), and `AccountAiAssetStore` is a working precedent. It needs an intake handoff and a reconciler (§5.3). Memory-mode dev/test needs a decision (D2). |
| B                   | Fulfillment is a normal in-memory Cp2Store domain with JSONB envelope tables and partial unique indexes on `record->>` expressions (precedent: `cp2_purchase_price_one_current_idx`)                                                                                                                                                                                                  | **No.** Serialization comes from Node's single thread. Indexes are checked only at async flush. A violation fails the all-tenant snapshot, which retries forever. Real-PG concurrency tests would prove nothing about the live path | Cheapest and consistent with most of the codebase. It violates the A17 requirement that invariants are database-backed and that tests are not the invariant.                                                                                                                                                                                          |
| C                   | First move invoices/customers/products off the in-memory layer, then build fulfillment fully relational                                                                                                                                                                                                                                                                               | Yes                                                                                                                                                                                                                                 | A multi-week rewrite of auth, payments and inventory, explicitly deferred in `single-instance-store-ceiling.md`. Out of scope.                                                                                                                                                                                                                        |

**Recommendation: Option A.** The rest of this section assumes it. If the owner picks B, §5.3,
§6 and the 1c concurrency tests must be rewritten to rely on single-thread serialization, and the
A17 "database-backed" language must be formally waived.

### 5.2 Ownership split under option A

| Data                                                                                                                                                                       | Authoritative home                                                                      | Why                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `products.unit_weight_grams`                                                                                                                                               | Cp2Store (in-memory `ProductSummary.unitWeightGrams: string\|null` + relational column) | Catalogue data. Edited through the existing `updateProduct` path. Not concurrency-sensitive for allocation, because allocation uses the order snapshot                                       |
| Invoice line weight snapshot                                                                                                                                               | Cp2Store (`InvoiceItemSummary` + `invoice_items` columns)                               | Taken inside the synchronous `confirmInvoice`, so it is atomic with confirmation. Immutable thereafter                                                                                       |
| `businesses.timezone`                                                                                                                                                      | Cp2Store (`BusinessSummary.timezone`)                                                   | A business attribute. Passed into fulfillment calls as a validated argument                                                                                                                  |
| Shop (customer) delivery locations + history                                                                                                                               | **Fulfillment tables**                                                                  | Staleness (A16) must be checked under lock in `createManifest`, so the current location must be read in the same transaction                                                                 |
| Corridors, geometry versions, policies (versioned), vehicles                                                                                                               | **Fulfillment tables**                                                                  | Lock targets and manifest snapshot sources                                                                                                                                                   |
| Fulfillment order record: one per confirmed delivery invoice, holding copied weight result, customer id, `confirmed_at`, fulfillment eligibility state, cancellation state | **Fulfillment tables**                                                                  | This is the A17 "order row" that gets `FOR UPDATE`. Invoice rows cannot be locked meaningfully, because the in-memory copy is authoritative and the snapshot writer rewrites `invoice_items` |
| Corridor resolutions (append-only provenance)                                                                                                                              | **Fulfillment tables**                                                                  | A16                                                                                                                                                                                          |
| Manifests, manifest stops, idempotency records, (Phase 2) vehicle reservations, approvals, outbox                                                                          | **Fulfillment tables**                                                                  | A17/A19/A23                                                                                                                                                                                  |
| Customer-facing per-order fulfillment status                                                                                                                               | Cp2Store `LogisticsSummary` (projection)                                                | Existing UI, reports and `logistics.update_status` depend on it. Fulfillment updates it through `LogisticsDomain` after its own transaction commits (§5.3 step 4)                            |

Rules:

- Fulfillment tables have **no FK into snapshot-managed tables** (`invoices`, `customers`,
  `products`, `businesses`). The snapshot writer hard-deletes rows missing from memory (shop and
  account purge), and a `RESTRICT` FK would poison the global flush. Tenant integrity is enforced
  by `business_id` on every row, by composite FKs _within_ fulfillment tables (for example
  `(business_id, corridor_id)` → `corridors(business_id, id)`), and by validating referenced ids
  against the Cp2Store before insert.
- Shop and account purge (`services/api/scripts/purge-shop-deletions.mjs`,
  `cp2/account-deletion-processors.ts`) must be extended to delete fulfillment rows for purged
  businesses.
- Fulfillment tables are **never** added to `normalizedCollections` or `mutatingMethodNames`.
  Fulfillment services are **not** methods on the `Cp2Store` Proxy. They are an async
  `FulfillmentService` constructed in `services/api/src/index.ts` with its own instrumented
  `pg.Pool` (like `model_artifact_store`), and they receive narrow read-only dependencies from
  the Cp2Store (actor authorization, product, invoice, customer and business lookups).
- Authorization reuses `requireAuthorizedActor(sessionId, businessId, permission)`, exposed to
  the service through a dependency interface. It is re-checked before the transaction starts.
  Membership changes happen in memory, so a revocation that lands during the transaction takes
  effect from the next request. This matches every other domain.

### 5.3 Order intake: the bridge from Cp2Store to fulfillment

1. `SalesDomain.confirmInvoice` (synchronous, in-memory) snapshots
   `unitWeightGramsSnapshot`/`totalWeightGrams`/`weightStatus` per line, using product weight at
   that instant. Every confirmation path passes through it (online, offline replay, agent,
   storefront acceptance).
2. After the store call returns, the confirming entry point (route handler, sync replay handler,
   runtime capability) calls `fulfillment.intakeConfirmedOrder({ businessId, invoiceId })`.
   **Only invoices with a delivery intent are taken in (see D4).**
3. `intakeConfirmedOrder` is idempotent (`UNIQUE (business_id, invoice_id)` with
   `ON CONFLICT DO NOTHING`). It stores the `calculateOrderFulfillmentWeight` result and the
   customer id, then attempts corridor resolution (1b). If there is no customer, no location, or
   no weight, the order stays **unresolved and visible**, never zero and never dropped.
4. A **reconciler** (an `interval-runner.ts` pattern job, as for the other `*-runner.ts` files)
   periodically takes in every confirmed delivery invoice with no fulfillment row. This covers a
   crash or failure between steps 1 and 3. The operations view shows a `pendingIntakeCount`, so
   an order in that gap is visible, not missing.
5. The in-memory confirmation itself is async-persisted (the existing ceiling). A crash can lose
   a confirmed invoice that the fulfillment side has already taken in. The reconciler must
   therefore also flag fulfillment rows whose invoice no longer exists (`ORPHANED`). It **never
   silently deletes them**.

---

## 6. Proposed transaction sequences (Phase 1c)

Common rules for all sequences:

- `client = await pool.connect()`, `BEGIN` (default `READ COMMITTED`), all statements on
  `client`, `COMMIT`, `client.release()`. On any error: `ROLLBACK`, then release.
- `SET LOCAL lock_timeout = '<configured>'` at the start of each transaction, so a stuck lock
  fails fast into the bounded retry.
- Tenant: every `SELECT … FOR UPDATE` includes `AND business_id = $businessId`. Zero rows means
  `404`, and cross-tenant existence is never revealed.
- Idempotency (A23): `INSERT INTO fulfillment_idempotency_records (business_id, operation, key,
request_hash, state) VALUES (…, 'PENDING') ON CONFLICT (business_id, operation, key) DO
NOTHING RETURNING …`. On conflict, read the existing row. Same hash and completed: return the
  stored `response_snapshot`. Same hash and still pending (a concurrent in-flight twin): the
  unique index blocks the second inserter until the first commits, and after that it sees the
  completed row. Different hash: `409 IDEMPOTENCY_KEY_REUSED`. The record insert is taken **after
  the corridor lock**, so twins for the same corridor are already serialized.
- Retry: the whole transaction is retried at most N times on `40001`, `40P01` or
  `RESOLUTION_CHANGED` (the recheck mismatch), with the same
  `businessId/operation/key/requestHash`. Domain errors (`CAPACITY_EXCEEDED`, `STALE_RESOLUTION`,
  `INVALID_SELECTION`, `permission_denied`) are never retried.

### 6.1 Global lock order (confirmed compatible; see §4 Q10)

1. `corridors` rows (ascending id when more than one)
2. `vehicles` / (Phase 2) `vehicle_reservations`
3. `delivery_manifests` row
4. `fulfillment_orders` rows (ascending id, or A21 candidate order in `createManifest`)
5. `manifest_stops` / dependent rows

### 6.2 `createManifest` (automatic selection)

```
authorize (Cp2Store): fulfillment:dispatch on businessId; validate vehicle id shape
BEGIN
  SET LOCAL lock_timeout
  SELECT id, geometry_version, policy_id FROM corridors
    WHERE id=$c AND business_id=$b AND active FOR UPDATE              -- lock 1
  idempotency insert/lookup (above)                                   -- may short-circuit
  load effective policy version (corridor override ?? business default)
  SELECT … FROM vehicles WHERE id=$v AND business_id=$b AND active    -- (Phase 2: FOR UPDATE + reservation)
  SELECT o.* FROM fulfillment_orders o
    JOIN LATERAL (current resolution for o) r ON true
    JOIN shop current location l
   WHERE o.business_id=$b AND r.corridor_id=$c
     AND o.state='POOLED' AND o.weight_status='RESOLVED'
     AND NOT EXISTS (active stop for o)
     AND r.corridor_geometry_version = corridor.geometry_version      -- non-stale
     AND r.shop_location_id = l.current_location_id                   -- non-stale
   ORDER BY o.confirmed_at ASC, o.id ASC
   FOR UPDATE OF o                                                    -- lock 4
  walk candidates (pure A21 function): fit → allocate; else skip; single > capacity → REQUIRES_PLANNING flag
  INSERT delivery_manifests (… corridor_geometry_version, policy_version, vehicle_id,
         vehicle_capacity_grams_snapshot, total_weight_grams, status='OPEN')
  INSERT manifest_stops (… sequence by distance_along_meters, snapshots, allocation_active=true)
  -- DB CHECK: total_weight_grams <= vehicle_capacity_grams_snapshot
  -- DB partial unique index: manifest_stops(order_id) WHERE allocation_active
  UPDATE fulfillment_orders SET state='ALLOCATED' WHERE id = ANY(allocated)
  UPDATE idempotency record → COMPLETED, response_snapshot (A22 strings)
COMMIT
after commit: structured logs; LogisticsDomain projection (pending→ready) via Cp2Store
```

### 6.3 `createManifest` (explicit `orderIds`)

The sequence matches §6.2 up to the policy and vehicle load, then:

```
  SELECT … FROM fulfillment_orders WHERE business_id=$b AND id = ANY($ids)
    ORDER BY id FOR UPDATE                                           -- lock 4, all requested rows
  re-read resolution/location/active-stop for each locked row
  validate ALL: exists in tenant; state POOLED; weight RESOLVED; resolution corridor = $c;
    not stale; no active stop; Σ weight <= capacity
  any failure → ROLLBACK; 422 INVALID_SELECTION { offending: [{orderId, reason}] }
  INSERT manifest + stops; UPDATE orders; idempotency COMPLETED
COMMIT
```

### 6.4 Pool-membership mutations (cancellation, re-resolution, manual reassignment)

```
read (no lock): order's current corridor_id(s) and active stop/manifest id
BEGIN
  SET LOCAL lock_timeout
  SELECT … FROM corridors WHERE id = ANY($corridors ordered asc) AND business_id=$b FOR UPDATE
  if order has active stop: SELECT … FROM delivery_manifests WHERE id=$m FOR UPDATE
  SELECT … FROM fulfillment_orders WHERE id=$o AND business_id=$b FOR UPDATE
  re-read corridor/allocation; if different from the pre-read → ROLLBACK, retry (bounded)
  apply A12 rule by manifest status:
    none/unallocated → cancel: state='CANCELLED' | re-resolve/reassign: append resolution row
    OPEN             → cancel: stop.allocation_active=false, recompute manifest total
                       reassign/re-resolve: reject (remove from manifest first)
    CLOSED/DEPARTED  → reject; operational SKIPPED via dispatcher/driver flow
COMMIT
after commit: Cp2Store-side commercial effect (for example invoice/logistics cancellation), then logs
```

For cancellation, the fulfillment transaction runs **first**. It is the side that can refuse
(CLOSED/DEPARTED). The commercial cancellation in memory follows. If the in-memory step fails
after commit, the reconciler detects `fulfillment=CANCELLED` while the invoice is not cancelled
and surfaces it. It never auto-reverts.

Weight-changing edits: **not applicable today**, because confirmed invoices are immutable (C6).
If an "amend confirmed order" feature is ever added, it follows §6.4 with the A12 rules.

### 6.5 Boundary additions (A20)

To be added to `scripts/check-boundaries.mjs` in 1a/1b:

- `apps/web/src/**` may not import `pg`, `services/api/**`, or
  `packages/business-core/src/domains/fulfillment*` internals (the web app uses `shared-types`
  and `apiFetch` only).
- `packages/business-core/src/domains/fulfillment-geometry.ts` may import nothing except
  `shared-types` types: no `pg`, `node:*` network modules, React, `services/`, or `event-core`.
- `services/api/src/mcp/**`, `services/api/src/messaging/**` and route files may call fulfillment
  only through `FulfillmentService` public methods, never its SQL module.
- Only `packages/shared-types/src/grams.ts` (the A22 serializer) may call `BigInt(`/`.toString()`
  on gram fields at JSON boundaries. Enforcing this is a heuristic, applied as a grep for
  `JSON.stringify` of `*Grams` inside fulfillment routes.

---

## 7. Migration plan (Phases 1a–1c)

The next free prefix is `089_`. Each migration has a matching `infra/db/rollbacks/*.down.sql`.
No migration invents historical weight, location, source, or actor.

### Phase 1a

| File                                  | Content                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Backfill                                                                                                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `089_fulfillment_weight_timezone.sql` | `alter table products add column unit_weight_grams bigint null check (unit_weight_grams > 0)`; `alter table invoice_items add column unit_weight_grams_snapshot bigint null, add column total_weight_grams bigint null check (total_weight_grams >= 0), add column weight_status text null check (weight_status in ('RESOLVED','UNRESOLVED'))`; `alter table businesses add column timezone text null`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | All NULL. Historical confirmed lines keep `weight_status = NULL` ("not snapshotted, pre-feature"), which differs from `UNRESOLVED`. **Decision D5** covers how pre-feature orders are treated |
| `090_fulfillment_foundation.sql`      | `vehicles(id uuid pk, business_id uuid not null, name, registration, capacity_grams bigint not null check (>0), active, created_at, updated_at, unique(business_id,id))`; `dispatch_policies(id, business_id, version int, target_load_grams bigint check (>0), minimum_dispatch_load_grams bigint null check (>0), check (minimum <= target), max_diversion_meters int check(>0), cutoff_local_time time, max_wait_hours int, fulfillment_lead_days int, under_threshold_fallback text[], overflow_strategy text, active, is_business_default, created_at; unique(business_id, id); partial unique one active default per business)` (immutable rows; editing appends a version); `customer_delivery_locations(id, business_id, customer_id text, latitude numeric(9,6) check range, longitude numeric(9,6) check range, accuracy_meters int null, captured_at, captured_by_user_id, superseded_at null; partial unique current per (business_id, customer_id) where superseded_at is null)`; `fulfillment_idempotency_records(business_id, operation, key, request_hash, state, response_snapshot jsonb, created_at, completed_at; primary key(business_id, operation, key))` | No rows. `locationStatus` is computed as the presence of a current row                                                                                                                        |

`businesses.timezone` and `invoice_items`/`products` columns are written by the snapshot writer.
`saveRelationalCoreRecords`/`saveInvoicesAndItems` and the product upsert must be extended, and
hydration must read them back. **The phase1 parity checksum (`health().phase1Parity`) must be
checked for the changed collections.**

Owner business seed (A7/1a "Owner business seed data"): the repository contains **no
authoritative way to identify the owner's business id**. There are no tenant fixtures and no
config mapping. Per the prompt, this document records the configuration rather than guessing an
id. After 1a, apply it through the new policy API or a one-off operator script run with an
explicit `--business-id` flag:
`timezone=Africa/Nairobi, targetLoadGrams=6000000, maxDiversionMeters=2000, cutoffLocalTime=18:00,
maxWaitHours=72, fulfillmentLeadDays=1, overflowStrategy=NEXT_MANIFEST, minimumDispatchLoadGrams=NULL`.

### Phase 1b

| File                                     | Content                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `091_corridors.sql`                      | `corridors(id, business_id, name, origin_label, origin_point jsonb, destination_label, destination_point jsonb, route_geometry jsonb not null, distance_meters bigint check(>0), geometry_version int not null default 1, priority int not null default 100, policy_override_id uuid null → dispatch_policies(business_id,id), active, created_at, updated_at, unique(business_id,id))`; `corridor_geometry_versions(corridor_id, version, route_geometry, distance_meters, created_at, created_by; pk(corridor_id, version))`, which keeps old geometry interpretable                                                                                                                                                                                               |
| `092_fulfillment_orders_resolutions.sql` | `fulfillment_orders(id, business_id, invoice_id text not null, customer_id text null, confirmed_at, weight_status, total_weight_grams bigint null check(>=0), unresolved_line_ids text[], state text check in (POOLED, ALLOCATED, DELIVERED, CANCELLED, ORPHANED, REQUIRES_PLANNING), created_at; unique(business_id, invoice_id))` (created in 1b so resolution can reference it; intake wiring in 1c); `corridor_resolutions(id, business_id, fulfillment_order_id, corridor_id, corridor_geometry_version, shop_location_id, diversion_meters numeric, distance_along_meters numeric, segment_index int, method text check in (AUTO, MANUAL), resolved_at, resolved_by; append-only)` plus a partial "current" pointer (`superseded_at is null` unique per order) |

Backfill: none. Historical confirmed invoices get **no** fulfillment rows automatically.
Decision D5 covers whether the reconciler should take in pre-feature confirmed, undelivered
invoices (they would enter as `UNRESOLVED` weight).

### Phase 1c

| File                                      | Content                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `093_order_source_actor.sql`              | `alter table invoices add column source text null check (source in ('FIELD_SALES','RETAIL_SALES','SOKO_CHAT','WHATSAPP','TELEGRAM','TIKTOK','INSTAGRAM','PHONE','MANUAL','API')), add column source_message_channel text null, add column created_by_user_id uuid null`, extended in the snapshot writer. Historical rows stay NULL ("unknown"), and nothing is inferred                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `094_manifests.sql`                       | `delivery_manifests(id, business_id, corridor_id, corridor_geometry_version, policy_id, policy_version, vehicle_id, vehicle_capacity_grams_snapshot bigint, status check in (DRAFT, OPEN, CLOSED, DEPARTED, COMPLETED, CANCELLED), total_weight_grams bigint not null check (>=0), check (total_weight_grams <= vehicle_capacity_grams_snapshot), planned_departure_at, closed_at, created_by, created_at, updated_at)`; `manifest_stops(id, business_id, manifest_id, fulfillment_order_id, customer_id, sequence int, distance_along_meters, diversion_meters, latitude, longitude, order_weight_grams bigint check(>=0), allocation_active bool, delivery_status check in (PENDING, ARRIVED, DELIVERED, FAILED, SKIPPED), …)`; **`create unique index manifest_stops_one_active_allocation on manifest_stops (fulfillment_order_id) where allocation_active`** |
| (optional) `095_invoice_cancellation.sql` | only if D3 introduces commercial cancellation on `InvoiceSummary`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

Every migration runs against a database that already holds historical products, invoices,
customers and businesses (A12 safe migrations). Tests: up, then down, then up, all on real
Postgres.

---

## 8. Conflicts

| #      | Conflict                                                                                                                                                                                                                                                  | Affected phases | Smallest compatible resolution (not implemented)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C1** | A17/A18 assume DB-authoritative writes (Prisma transactions, `FOR UPDATE`, partial unique index as final defense). The repo's business state is in memory and async-persisted.                                                                            | 1a–2            | Option A (§5): fulfillment-owned, Postgres-authoritative tables written only in request transactions. **Owner decision D1.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **C2** | "Prisma interactive transaction `$transaction(async tx => …)`" / "`tx.$queryRaw`"                                                                                                                                                                         | 1a–2            | Use a `pg` `PoolClient` with explicit `BEGIN/COMMIT`, plus a small `withFulfillmentTransaction(pool, fn)` helper (bounded retry, `SET LOCAL lock_timeout`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| C3     | "SKU/variant/pack" sellable unit                                                                                                                                                                                                                          | 1a              | `ProductSummary` is the only sellable unit. Packs (sack, carton, bale) are separate products, each with its own `unitWeightGrams`, which matches A4 ("each is represented as a sellable unit"). There is no pack-composition model, so pack weight is never derived.                                                                                                                                                                                                                                                                                                                                                             |
| **C4** | Integer grams × **fractional** line quantity                                                                                                                                                                                                              | 1a              | Recommendation: compute `unitWeightGrams × quantity` with exact decimal arithmetic on the quantity's shortest decimal representation. If the result is not a whole number of grams, the line is `UNRESOLVED` (reason `NON_INTEGRAL_WEIGHT`). No rounding, no floats. **Owner decision D6.**                                                                                                                                                                                                                                                                                                                                      |
| C5     | A22 says "domain works in `bigint` internally". Cp2Store records are `JSON.stringify`'d for snapshot, diff, `structuredClone` and sync                                                                                                                    | 1a              | In-memory Cp2Store fields (`ProductSummary.unitWeightGrams`, line snapshots) are **decimal strings**. Fulfillment service and domain arithmetic convert to `bigint` via the shared parser. `pg` already returns `int8` as a string.                                                                                                                                                                                                                                                                                                                                                                                              |
| **C6** | A12 assumes confirmed orders can be edited or cancelled. Confirmed invoices are **immutable** (`updateInvoice` rejects non-draft), and there is **no cancellation** on `InvoiceSummary` (only on the `PublicOrder/BuyOrder` wrapper `HandoffOrderStatus`) | 1c              | Keep immutability, so weight-changing edits of pooled orders cannot occur. Introduce **fulfillment cancellation** (and optionally commercial cancellation) as a new operation per §6.4. **Owner decision D3** covers the commercial semantics (restock inventory? payments already recorded?).                                                                                                                                                                                                                                                                                                                                   |
| C7     | "`MessageChannel` enum" with `WHATSAPP`, `TIKTOK`, `INSTAGRAM`                                                                                                                                                                                            | 1c, 3           | `OrderSource` is a new union. When the source is a messaging channel, store the existing `MessageChannel` literal (`whatsapp_business`, `telegram`, …) alongside it. Do not rename `MessageChannel`.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **C8** | Dispatcher / Driver roles; "prefer scoped capabilities"                                                                                                                                                                                                   | 1a–2            | Membership has exactly one `BusinessRole` with no capability grants. Smallest resolution: add permissions `fulfillment:read`, `fulfillment:dispatch`, `fulfillment:manage`, `shop_location:write`, `shop_location:read_precise`, `delivery:record`. Map owner→all, manager→all except `fulfillment:manage`, sales_agent→`fulfillment:read` (limited pool view), `shop_location:write`. Add one new business-scoped role `driver` (`delivery:record` plus reading assigned manifests only). Roles are per-business membership values, not global strings. **Owner decision D7** (new role vs. mapping dispatcher onto `manager`). |
| C9     | Manifest vs existing `DeliveryRouteSummary`                                                                                                                                                                                                               | 1c, 2           | Manifest is new, because it needs capacity, allocation and DB constraints. On `DEPARTED` or `COMPLETED`, project into `DeliveryRouteSummary` and `SaleRecordSummary.routeId` so commercial-history reports keep working. `DeliveryRoute` stays the historical record.                                                                                                                                                                                                                                                                                                                                                            |
| C10    | Delivery outcomes vs `FulfillmentStatus` transitions: `out_for_delivery → pending` is not allowed, so a `FAILED` or `SKIPPED` stop cannot return the order to the pool                                                                                    | 1c, 2           | Extend `validateLogisticsStatusTransition` with an explicit `out_for_delivery → ready` "returned to pool" transition for fulfillment-driven updates only. Also: `LogisticsSummary` is created manually today (`createLogistics`). Fulfillment intake should create it (method `delivery`) when absent, or D4 decides that the logistics record _is_ the delivery-intent signal.                                                                                                                                                                                                                                                  |
| C11    | Phase 2 "expose `fulfillment.*` through the MCP gateway"                                                                                                                                                                                                  | 2               | Register them in `packages/tool-core/src/domains/fulfillment.ts` → `runtimeToolRegistry`, dispatched by the existing capability layer and reached from MCP via `soko.runtime_turn` / `soko.confirm_runtime_action`. Direct MCP methods would fail `check-boundaries.mjs`. A read-only `soko.get_corridor_load` alongside `soko.query_catalogue` is possible if the owner wants it.                                                                                                                                                                                                                                               |
| C12    | "No inbound channel adapters exist"                                                                                                                                                                                                                       | 3               | The Telegram adapter exists. Phase 3 extends `TelegramChannelAdapter` and the canonical conversation-to-invoice flow (`createProviderConversation`, `commerce.checkout` capability) and adds nothing parallel.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| C13    | A18 "add PG service container"                                                                                                                                                                                                                            | 1a              | CI has none. Adding `services: postgres:16` and setting `CP2_POSTGRES_TEST_DATABASE_URL` will **also un-skip 7 existing Postgres test files** that have never run in CI. Recommendation: enable in 1a, and fix any pre-existing failures in the same phase without weakening tests. Otherwise, gate fulfillment PG tests on a separate `FULFILLMENT_POSTGRES_TEST_DATABASE_URL` (see D8).                                                                                                                                                                                                                                        |
| C14    | Memory-mode store (`CP2_STORE=memory`, used by most tests and local dev) has no Postgres                                                                                                                                                                  | 1a–2            | See D2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| C15    | "Swahili and Sheng" UI                                                                                                                                                                                                                                    | 1c, 2           | Only `en`/`sw` locales exist. Provide copy for both, and do not add a Sheng locale.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

Pre-existing issues noticed (outside scope, not fixed):

- The snapshot writer takes a **session-level** `pg_advisory_lock` over the Neon **pooler** URL.
  Under PgBouncer transaction mode, lock and unlock may run on different server connections.
- `docs/database-operations.md` says migrations run as `preDeployCommand`, but `render.yaml`
  runs them in `buildCommand`.

---

## 9. Open questions requiring owner decision

| ID     | Question                                                                                                                                                                                                                                                                              | Recommendation                                                                                                                                                        |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1** | Where is fulfillment state authoritative: Option A (fulfillment-owned Postgres-authoritative tables, per-request transactions), B (in-memory Cp2Store domain; A17 "database-backed" waived), or C (rewrite core first)?                                                               | **A**                                                                                                                                                                 |
| D2     | In `CP2_STORE=memory` mode, should fulfillment (a) require Postgres and return `503 fulfillment_requires_postgres`, or (b) ship a memory adapter? The pure rules are shared either way, but a memory adapter duplicates the transactional shell.                                      | (a) for mutations, with all pure logic unit-tested without a DB, and the transactional layer tested only on real PG                                                   |
| D3     | Commercial cancellation of a confirmed invoice: add it, and if so, does it restock inventory and how does it treat recorded payments? Or is only _fulfillment_ cancellation needed?                                                                                                   | Add fulfillment cancellation in 1c. Treat commercial cancellation as a separate, explicitly scoped change                                                             |
| D4     | What marks an order as needing delivery (entering intake)? Options: `LogisticsSummary.method = delivery` exists; order source `FIELD_SALES`; any confirmed invoice with a customer; or an explicit flag at confirmation. Walk-in retail (`customerId = null`) should not enter pools. | An explicit `fulfillmentMethod` chosen at confirmation (default `delivery` for `FIELD_SALES`, `pickup` for `RETAIL_SALES`), which also creates the `LogisticsSummary` |
| D5     | Should pre-feature confirmed, not-yet-delivered invoices be taken in (as `UNRESOLVED` weight), or only invoices confirmed after 1c?                                                                                                                                                   | Only invoices confirmed after 1c. Older ones can be added manually                                                                                                    |
| D6     | Fractional quantities: exact-decimal rule (`NON_INTEGRAL_WEIGHT` → `UNRESOLVED`), or require integer quantities for weighted products?                                                                                                                                                | Exact-decimal rule                                                                                                                                                    |
| D7     | Dispatcher/Driver: new `driver` role plus permissions on existing roles, or a new capability-grant table on memberships? Is Dispatcher = `manager`?                                                                                                                                   | New permissions, `manager` acts as dispatcher, new business-scoped `driver` role                                                                                      |
| D8     | CI Postgres: enable the existing 7 PG test files too (and fix what breaks), or isolate fulfillment PG tests behind a new env var?                                                                                                                                                     | Enable all. It raises real coverage                                                                                                                                   |
| D9     | Owner's business id for seed configuration (not discoverable from the repo)                                                                                                                                                                                                           | Provide it at 1a apply time. Apply via API or an operator script, never hard-coded                                                                                    |
| D10    | Location storage precision and retention: `numeric(9,6)` (about 0.1 m), and is location history retained indefinitely or purged with the customer?                                                                                                                                    | `numeric(9,6)`, purged with the business or customer                                                                                                                  |
| D11    | Vehicle trips per service day (Phase 2 reservation model): one departure per day, or several non-overlapping trips?                                                                                                                                                                   | One per day first (`UNIQUE (vehicle_id, service_date) WHERE active`)                                                                                                  |

---

## 10. Numeric and geometry notes for Phase 1b (pre-decided in A14/A15)

- Coordinates in GeoJSON are `[lng, lat]`. Validate `-180 ≤ lng ≤ 180`, `-90 ≤ lat ≤ 90`, at
  least 2 points, and non-zero length (the sum of segment lengths must be > 0 m).
- Segment projection: a local equirectangular plane centred on the segment midpoint latitude,
  with R = 6,371,008.8 m. Clamp the projection parameter to [0, 1] per segment.
  `distanceAlongMeters` is the cumulative length of prior segments plus the projected offset.
- The pure module lives in `packages/business-core/src/domains/fulfillment-geometry.ts`. It uses
  plain `number` math (sub-metre float error is acceptable for geometry and is not a physical
  quantity). The tolerance comparison is `diversionMeters <= maxDiversionMeters` (inclusive).
  Ties use exact equality after rounding to millimetres, then `priority`, then lexical id.
- Persisted diversion and along-distance values: `numeric(12,3)` metres.

---

## 11. Phase 1a implementation record

### 11.1 Decisions applied

| ID  | Applied as                                                                                                                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Option A. Fulfillment-owned tables are Postgres-authoritative, written only inside `FulfillmentService` transactions, and absent from `normalizedCollections`. Catalogue, invoice and business fields stay in the Cp2Store. |
| D2  | In memory mode (`CP2_STORE=memory`) every fulfillment route answers `503 fulfillment_requires_postgres`. The pure rules run everywhere; the transactional layer is tested only on real Postgres.                            |
| D6  | Exact-decimal line weight. `quantity x unitWeightGrams` is computed from the quantity's shortest decimal representation. A result that is not whole grams is `UNRESOLVED` (`NON_INTEGRAL_WEIGHT`), never rounded.           |
| D7  | New permissions (§11.3). `manager` is the dispatcher. New business-scoped role `driver`.                                                                                                                                    |
| D8  | CI runs PostgreSQL 16 and every Postgres-gated test file, serially.                                                                                                                                                         |
| D10 | Coordinates are stored as `numeric(9,6)` (about 0.1 m). A purged business's fulfillment rows are deleted with it.                                                                                                           |

### 11.2 What was built

| Concern                                   | Where                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A22 gram serializer and kg display        | `packages/shared-types/src/grams.ts`: `parseGrams`/`parsePositiveGrams`/`formatGrams`/`formatKilogramsForDisplay`. Only canonical digit strings are accepted, up to the BIGINT maximum; JSON numbers are rejected.                                                                                                                            |
| Wire types                                | `packages/shared-types/src/fulfillment.ts`. `ProductSummary.unitWeightGrams`, the `InvoiceItemSummary` weight snapshot fields and `BusinessSummary.timezone` are all optional, so historical records stay valid.                                                                                                                              |
| Pure rules (A4, A5, A6, A7, A9, A10, A11) | `packages/business-core/src/domains/fulfillment.ts`: `calculateLineWeight`, `snapshotInvoiceLineWeight`, **`calculateOrderFulfillmentWeight`** (the one canonical order weight), `validateVehicleInput`, `validateDispatchPolicyInput`, `validateCoordinates`, `isValidIanaTimeZone`.                                                         |
| Product weight                            | `ProductInput.unitWeightGrams` on create/update. Omitting it keeps the existing value; `null` clears it back to unknown.                                                                                                                                                                                                                      |
| Line snapshot                             | `SalesDomain.confirmInvoice` snapshots each line from the catalogue at confirmation. Every confirmation path (online, offline replay, agent, storefront) goes through it.                                                                                                                                                                     |
| Canonical order weight read               | `GET /businesses/:businessId/invoices/:invoiceId/fulfillment-weight` (`invoice:read`)                                                                                                                                                                                                                                                         |
| Business timezone (A11)                   | `GET`/`PATCH /businesses/:businessId/fulfillment/settings`. Reading needs `fulfillment:read`; writing needs `fulfillment:manage` and a valid IANA zone.                                                                                                                                                                                       |
| Vehicles (A7)                             | `/fulfillment/vehicles` (list, create, patch), table `fulfillment_vehicles`                                                                                                                                                                                                                                                                   |
| Policies (A9/A10)                         | `/fulfillment/policies`, `/policies/:policyId/revisions`, `/fulfillment/default-policy`. Tables `fulfillment_dispatch_policies` (one immutable row per version) and `fulfillment_business_settings` (points at the default policy lineage; its active version is the effective default).                                                      |
| Shop locations (A6)                       | `/fulfillment/shops/:customerId/location` (`GET`, `PUT` to capture) and `/location/history`. Table `fulfillment_shop_locations` is append-only with one current row per shop. Callers without `shop_location:read_precise` get `coordinatesRedacted: true`, and coordinates are never logged.                                                 |
| Idempotency (A23)                         | Table `fulfillment_idempotency_records`, via `runIdempotent` in `domains/fulfillment/transaction.ts`, driven by the `Idempotency-Key` header. Retention is set by `FULFILLMENT_IDEMPOTENCY_RETENTION_HOURS` (24 h minimum); an interval runner in `index.ts` purges old records.                                                              |
| Transaction shell (A17)                   | `withFulfillmentTransaction`: one `PoolClient`, `SET LOCAL lock_timeout`, and bounded retry on `40001`/`40P01`/`55P03`/recheck conflicts. Domain errors are never retried.                                                                                                                                                                    |
| Store bridge                              | `Cp2Store.authorizeBusinessPermission`, `hasBusinessPermission` and `requireBusinessCustomer` (read-only, never trigger a snapshot save), plus `updateBusinessTimezone` (mutating) and `getOrderFulfillmentWeight`.                                                                                                                           |
| Migrations                                | `089_fulfillment_weight_timezone.sql` and `090_fulfillment_foundation.sql`, each with a `.down.sql`. Nothing is backfilled.                                                                                                                                                                                                                   |
| Boundaries (A20)                          | `scripts/check-boundaries.mjs`: the web app may not import `pg`, `services/api` or fulfillment internals, and may not call `BigInt(`; pure fulfillment rules may import only `shared-types`/`tool-core`; nothing outside the fulfillment domain may import `fulfillment/transaction`; the fulfillment domain may not call `BigInt(` directly. |
| Schema verification                       | `db:verify-schema` checks the columns added by 089/090. It checks columns only, because fulfillment tables deliberately have no foreign keys (§5.2).                                                                                                                                                                                          |
| CI                                        | A `postgres:16-alpine` service, then `pnpm db:migrate`, then `pnpm test:postgres` (`scripts/run-postgres-tests.mjs` finds every file gated on `CP2_POSTGRES_TEST_DATABASE_URL` and runs them serially).                                                                                                                                       |

### 11.3 Permissions (A8)

| Permission                   | owner | manager (dispatcher) | sales_agent | driver | cashier / view_only |
| ---------------------------- | ----- | -------------------- | ----------- | ------ | ------------------- |
| `fulfillment:read`           | ✓     | ✓                    | ✓ (limited) |        |                     |
| `fulfillment:dispatch`       | ✓     | ✓                    |             |        |                     |
| `fulfillment:manage`         | ✓     |                      |             |        |                     |
| `shop_location:write`        | ✓     | ✓                    | ✓           |        |                     |
| `shop_location:read_precise` | ✓     | ✓                    |             |        |                     |
| `delivery:record`            | ✓     | ✓                    |             | ✓      |                     |

"Limited" means Phase 1c must narrow what a salesperson sees in pools. Scoping a driver to their
assigned manifests is Phase 1c/2 work.

### 11.4 Deviations from the plan, and why

- **Table names carry a `fulfillment_` prefix** (for example `fulfillment_vehicles`) so their
  ownership is obvious next to the snapshot-managed tables.
- **The default policy is a pointer table** (`fulfillment_business_settings`), not an
  `is_business_default` column. Changing the default must not rewrite an immutable policy
  version.
- **Stable lock targets.** The first implementation locked "the active policy version" and "the
  current shop location" with `FOR UPDATE`. The concurrency tests showed this is wrong under READ
  COMMITTED: a waiter re-checks its `WHERE` clause after the winner commits, no longer matches,
  and sees no row, which produced a spurious 404 and a duplicate current location. The fixes:
  - Policy revisions lock the lineage's **version-1 row**, which is never modified.
  - Shop-location captures use a transaction-scoped `pg_advisory_xact_lock`. No row can serve
    here, because a shop's first capture has no row at all. The key is a 64-bit hash of
    `soko.fulfillment.shop_location:<business>:<customer>`. A collision can only make two
    unrelated captures wait for each other; it cannot cross tenants, because every statement
    still filters by `business_id`. The partial unique index remains the backstop.

  **The same trap applies to Phase 1c.** `createManifest` must lock the corridor row and
  candidate rows by stable predicates (`id`), then re-read state in a fresh statement.

- **Idempotent replay of a location capture** replays the _mutation_ once, but re-renders the
  response for the current caller, because coordinate redaction depends on the caller's
  permission. Every other operation returns the stored response unchanged.

### 11.5 Gaps found and fixed along the way

- **Product `fieldValues` were lost on every restart** (pre-existing). Relational hydration of
  `products` replaced the whole record, so business-defined catalogue field values silently
  vanished after a deploy. Relational hydration now starts from the compatibility record and
  overrides only the relational columns. A Postgres restart test covers it.
- **Postgres tests had rotted unnoticed** (pre-existing, because CI never ran them). The Vercel
  inference mock in `tests/cp2-postgres-store.test.ts` returned a fixed `requestId`, but the
  client now requires the result to echo the request's id. The mock now echoes it, and the test
  asserts the exact id: equally strict, with the correct protocol. Two other Postgres files
  failed only when run in parallel against one database, which is why they now run serially.
  With these fixes, all 8 Postgres files (70 tests) pass.

### 11.6 Known gaps carried forward

- **There is no staff-invitation flow.** Memberships other than the business creator's owner
  role can only be created in tests (`hydrateSnapshot`). Until a membership-management API
  exists, only owners can use fulfillment in production. Field salespeople, dispatchers and
  drivers need this before Phase 1c's field-sales flow is usable. It is a separate, auth-
  sensitive change.
- **Owner seed configuration (D9)** has not been applied; the owner's business id is still
  unknown. Once it is known, apply the §7 values through the API (`PATCH /fulfillment/settings`
  with `Africa/Nairobi`, then `POST /fulfillment/policies` with `makeBusinessDefault: true`,
  `targetLoadGrams "6000000"`, `maxDiversionMeters 2000`, `cutoffLocalTime "18:00"`,
  `maxWaitHours 72`, `fulfillmentLeadDays 1`, `overflowStrategy "NEXT_MANIFEST"`).
- **No UI yet.** Phase 1a is API-only. The field-sales and operations UI is Phase 1c scope.
- **The Chromium integration test** (`tests/computer-runtime-browser.integration.test.ts`) fails
  in environments whose Playwright headless-shell build is missing. It fails identically on the
  untouched baseline, and CI installs Chromium itself.

---

## 12. Phase 1b implementation record

### 12.1 What was built

| Concern                   | Where                                                                                                                                                                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pure geometry (A14/A15)   | `packages/business-core/src/domains/fulfillment-geometry.ts`: `validateCorridorGeometry`, `corridorLengthMeters`, `projectPointOntoCorridor`, `resolveCorridor`. It has no imports, and `check-boundaries.mjs` enforces that.                                                                          |
| Corridors                 | Table `fulfillment_corridors`. Geometry is a GeoJSON `LineString` stored as jsonb; the length is computed by the server; `priority` defaults to 100 in the schema; `policy_override_id` names a policy lineage. Routes: `GET`/`POST /fulfillment/corridors`, `GET`/`PATCH /corridors/:id`.             |
| Geometry versioning (A16) | `PUT /corridors/:id/geometry` increments `geometry_version` and inserts a row in `fulfillment_corridor_geometry_versions`; `GET .../geometry-versions` lists every version. `PATCH` rejects geometry, so no edit can skip versioning.                                                                  |
| Match without persisting  | `GET /fulfillment/shops/:customerId/corridor-match` implements `resolveCorridorForShop` (needs `fulfillment:read`).                                                                                                                                                                                    |
| Fulfillment order row     | Table `fulfillment_orders`: the stable, lockable row for one confirmed invoice, created on first resolution (`UNIQUE (business_id, invoice_id)`). Phase 1c adds intake, weight and pool state.                                                                                                         |
| Provenance (A16)          | Table `fulfillment_corridor_resolutions` records corridor, geometry version, shop location, diversion, distance along, segment, tolerance, `AUTO`/`MANUAL`, who and when. It is append-only: only `superseded_at` is ever stamped on an old record, and there is at most one current record per order. |
| Resolution writes         | `POST /fulfillment/orders/:invoiceId/corridor/resolve` (AUTO) and `.../corridor/assign` (MANUAL, qualifying corridors only). Both need `fulfillment:dispatch` and accept an `Idempotency-Key`.                                                                                                         |
| Staleness (A16)           | `GET /fulfillment/orders/:invoiceId/corridor` returns the current record, `stale` and `staleReasons` (`GEOMETRY_CHANGED`, `LOCATION_CHANGED`), and the full history. Staleness is computed, never repaired silently.                                                                                   |
| Database invariants       | Composite tenant FKs from resolutions to orders, corridors, geometry versions and shop locations; one current record per order; `CHECK (diversion_meters <= max_diversion_meters)`, so an off-corridor record cannot be stored.                                                                        |
| Migrations                | `091_fulfillment_corridors.sql` and `092_fulfillment_orders_resolutions.sql`, each with a `.down.sql`. Business purge and `db:verify-schema` cover the new tables.                                                                                                                                     |

### 12.2 Numeric tolerances (A15, documented)

- Each segment is projected into a local equirectangular plane centred on its midpoint latitude,
  with R = 6,371,008.8 m, and the projection parameter is clamped to [0, 1]. Longitude
  differences are normalized to [-180, 180).
- Measured against a great-circle (haversine) reference on a 44 km Thika Road polyline, route
  length is within 1e-4 relative error and distance-along at a vertex is within 2 m
  (`tests/fulfillment-geometry.test.ts`).
- Eligibility is inclusive (`diversion <= maxDiversionMeters`). Ties compare diversion rounded
  to the millimetre, then lower `priority`, then lexical corridor id. Within one corridor,
  equal-distance segments resolve to the lower segment index.
- Persisted distances are `numeric(12,3)` (millimetres). API values are rounded to the stored
  precision.

### 12.3 Decisions and deviations

- **Unresolved reasons.** The reasons are `NO_LOCATION`, `NO_ACTIVE_CORRIDOR`,
  `OUTSIDE_TOLERANCE` and `INVALID_GEOMETRY`, plus **`NO_DISPATCH_POLICY`**. The extra reason
  covers a corridor that exists but has no effective policy (neither an override nor a business
  default), because its tolerance is then unknown. `NO_LOCATION` takes precedence, since a shop
  without a delivery point cannot be matched whatever corridors exist. An unresolved outcome
  persists nothing and leaves any previous resolution untouched.
- **Order without a shop.** An invoice with no customer resolves as `NO_LOCATION`: there is no
  delivery point.
- **The recheck is "locks still cover it", not "nothing changed".** The first version retried
  whenever a newer resolution had been appended during lock acquisition. Five concurrent
  re-resolutions of one order then exhausted the bounded retry and one request got a 409. The
  recheck now requires only that the post-lock current record's corridor is one this
  transaction has locked. That is exactly A17's source-and-target rule. The chosen corridor's
  geometry version, its active flag and the shop's current location must still be unchanged.
- **Lock order in practice:** corridors (ascending id) → `fulfillment_orders` row. A geometry
  edit locks its corridor row, so a resolution can never be recorded against a geometry version
  being replaced (proven by a concurrency test).

### 12.4 Gaps found and fixed

- **Migration test ordering.** The Phase 1a migration test rolled back 090 on its own. Once 092
  holds a foreign key into `fulfillment_shop_locations`, that no longer works. The test now
  unwinds 092 → 089 in reverse, exactly as `db:rollback` does, and re-applies the full stack.
- **A pre-existing Postgres test was not re-runnable.** `progressive-identity-postgres` used a
  fixed phone number, so on any reused database the merge target collected every earlier run's
  conversations, and its exact count assertion failed from the second run on. It passed in CI
  only because CI uses a fresh database. It now uses a phone number unique to each run and keeps
  the exact assertion. The whole Postgres suite passes twice in a row on the same database.

### 12.5 Carried forward to Phase 1c

- Nothing calls `resolveCorridorForOrder` automatically yet. Phase 1c wires it into order
  confirmation and intake.
- Allocation must refuse stale orders. The staleness computation built here is what it uses.
- The §11.6 gaps (staff invitation, owner seed configuration, UI) still stand.

---

## 13. Phase 1c implementation record

### 13.1 What was built

| Concern                   | Where                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Order source (A3.1)       | Migration 093 adds `invoices.source` (CHECK over the ten sources), `source_message_channel` and `created_by_user_id`. New invoices default to `MANUAL` and record the creating user. Storefront and marketplace checkout record `SOKO_CHAT` / `soko`. Historical rows stay NULL, meaning unknown, and nothing is inferred. `updateInvoice` preserves provenance.    |
| Delivery intent (D4)      | `POST /invoices/:id/confirm` accepts an optional `fulfillmentMethod` (`delivery` or `pickup`). It checks `logistics:write` before confirming, then creates the canonical `LogisticsSummary`. An order enters fulfillment only when a delivery logistics record exists; confirming without one never blocks.                                                         |
| Intake                    | The sales and logistics domains call `onInvoiceConfirmed` / `onLogisticsCreated`. `Cp2Store` forwards these to the fulfillment intake listener on a microtask, so confirmation never waits on Postgres. Intake upserts `fulfillment_orders` with the weight snapshot and runs automatic corridor resolution.                                                        |
| Reconciler                | `fulfillmentIntakeReconcileRunner` runs every `FULFILLMENT_INTAKE_RECONCILE_INTERVAL_MS` (default 5 min). It takes in delivery orders whose intake never ran. It marks rows whose invoice has gone from the store `ORPHANED`, and never deletes them.                                                                                                               |
| Pools and readiness (A13) | `GET /fulfillment/pools` returns per-corridor totals, readiness, percent filled, cutoff countdown in the business timezone (DST-safe), oldest waiting age, and stale / unknown-weight counts. It also returns an **unassigned** bucket (no GPS, off every corridor, pending intake, orphaned), so no order is hidden. `GET /pools/:corridorId` adds the order list. |
| Manifests (A21)           | Migration 094: `fulfillment_manifests` and `fulfillment_manifest_stops`. Each manifest snapshots geometry version, policy version, vehicle capacity, each stop's coordinates, distance along, diversion and weight. `POST /fulfillment/manifests` without `orderIds` is skip-and-continue; with `orderIds` it is all-or-nothing, with `details.rejections`.         |
| Lifecycle (A12)           | Remove (OPEN only), close (OPEN → CLOSED, needs at least one active stop), order cancel (releases an OPEN stop and recomputes the total; refused with 409 `order_dispatched` once CLOSED), and delivery outcomes `ARRIVED` / `DELIVERED` / `FAILED` / `SKIPPED`. Failed and skipped need a note and return the order to the pool with its original age.             |
| Logistics projection      | Canonical logistics status follows fulfillment: allocation → `ready`, delivered → `completed`, cancelled → `cancelled`. `Cp2Store.applyFulfillmentLogisticsStatus` validates each transition and audits it as `logistics.status_projected`.                                                                                                                         |
| Database invariants       | `CHECK (total_weight_grams <= vehicle_capacity_grams)`; the partial unique index `fulfillment_manifest_stops_one_active_allocation_idx` (at most one active allocation per order); `UNIQUE (manifest_id, sequence)`; release-reason consistency; composite tenant FKs. The concurrency tests prove each by direct insert.                                           |
| UI                        | `ShopLocationCard` (GPS capture in the customer editor, showing the server's corridor decision) and `CorridorDispatchCard` (pools, create manifest, close, remove, record delivery), mounted in the existing Customers and Logistics surfaces. Copy is in English and Swahili, following the browser language (`fulfillment-copy.ts`).                              |

### 13.2 Permissions

| Operation                                                      | Permission             |
| -------------------------------------------------------------- | ---------------------- |
| Pools summary, order fulfillment status, manifest list/detail  | `fulfillment:read`     |
| Pool order list, create/close manifest, remove, cancel, intake | `fulfillment:dispatch` |
| Record a delivery outcome                                      | `delivery:record`      |

A `sales_agent` can see the pools summary but not the order list or manifests' write routes. A
`driver` can record deliveries but cannot create manifests.

### 13.3 Decisions and deviations

- **Table names** are `fulfillment_manifests` / `fulfillment_manifest_stops`, not the §7 draft's
  `delivery_manifests` / `manifest_stops`, so every fulfillment-owned table shares one prefix
  (D1 option A). Intake, weight and state columns live on `fulfillment_orders` (093), not on
  `invoices`.
- **Readiness uses allocatable weight.** A stale order still counts in
  `eligibleTotalWeightGrams` and is flagged, but not in `allocatableWeightGrams`, which drives
  readiness. So a map edit can never make a pool look ready with orders that cannot be loaded.
- **Cancellation is fulfillment-only.** No commercial invoice cancellation exists (D3), so the
  optional 095 migration was not needed. `POST /fulfillment/orders/:id/cancel` withdraws the
  order from delivery and projects the logistics record to `cancelled`.
- **An allocated order cannot be re-resolved or reassigned** (409 `order_allocated`). It must
  leave its manifest first, so a stop can never point at a corridor it is not on.
- **Automatic intake is fire-and-forget.** The in-memory store is synchronous, and a Postgres
  failure must not fail a sale. The reconciler is the safety net, and the unassigned bucket's
  `pendingIntakeCount` makes any backlog visible.

### 13.4 Gaps found and fixed

- **Migration tests with dependent FKs.** Each phase's migration test now unwinds every later
  migration in reverse (`withMigrationsReversed`) before rolling back its own, then re-applies
  them all. This keeps the 089/091 tests valid as 093/094 add FKs into their tables.
- **The Postgres snapshot dropped new invoice provenance.** `source`,
  `source_message_channel` and `created_by_user_id` are now written and hydrated, so provenance
  survives a restart.
- **Business purge would have failed once a manifest existed.** Stops hold an FK to
  `fulfillment_orders`, and the purge deleted orders first. The purge now deletes stops, then
  manifests, then the Phase 1b tables. The D10 purge test now includes a manifest and stop, and
  it reproduced the FK violation before the fix. `db:verify-schema` now also checks the 093/094
  columns.

### 13.5 Tests

- `tests/fulfillment-dispatch.test.ts` (pure): the readiness matrix, the A21 cases, and cutoff
  across Nairobi, Lagos and a New York DST gap and overlap.
- `tests/fulfillment-dispatch-postgres.test.ts` (22, real Postgres), covering:
  - intake on confirm, pickup, no intent and a later logistics record;
  - reconciler and orphans;
  - pooling with unpaid, part-paid, unknown-weight, cancelled, stale and reassigned orders;
  - readiness at target − 1 g, target, and the minimum boundaries;
  - every A21 capacity case;
  - snapshots that later edits do not change;
  - the full lifecycle;
  - cross-tenant and role permissions;
  - the races: concurrent automatic creation, overlapping explicit selections, membership races with cancel and reassign, and an idempotency race;
  - database-level invariants;
  - migrations 093/094 down and up;
  - **the 14-step Phase 1 end-to-end Definition of Done.**
- `tests/corridor-fulfillment-cards.test.tsx` (jsdom): the cards render server readiness and
  exact kilograms, create manifests only on an explicit click, require a reason for failed
  deliveries, and capture GPS. It also checks that the Swahili copy covers every string.

### 13.6 Known gaps carried forward

- **Staff invitation (§11.6)** still does not exist. Non-owner roles (sales agent, dispatcher,
  driver) are exercised in tests but cannot yet be granted in production.
- **Owner seed configuration (D9)** still waits on the business id.
- **Departure** (`CLOSED → DEPARTED`) is not exposed. Delivery recording accepts `CLOSED` or
  `DEPARTED`, so drivers are not blocked. Phase 2 owns the departure decision.

---

## 14. Phase 2 implementation record

### 14.1 Implemented

- `evaluateDispatchPolicy` is a pure, clock-independent policy evaluator. It distinguishes ready,
  wait, deterministic fallback recommendation and approval-required outcomes; observes configured
  fallback order; and selects vehicles by smallest fitting capacity then lexical id.
- `canTransitionManifest` is the central manifest state-machine validator for
  `DRAFT → OPEN → CLOSED → DEPARTED → COMPLETED`, with cancellation limited to pre-departure
  states.
- Focused unit tests cover target/max-wait boundaries, fallback ordering, deterministic vehicle and
  compatible-corridor selection, approval escalation and invalid manifest transitions.
- Migration 098 adds one idempotent evaluation per corridor/business day, approval records, one
  active vehicle reservation per vehicle/business-local service day, `departed_at`, and a narrow
  transactional fulfillment outbox with event-key deduplication.
- HTTP/service operations evaluate a corridor, list and decide approvals, and move a closed
  manifest to `DEPARTED`. An open approval takes precedence over load readiness in pool responses.
- Planned manifests reserve their vehicle inside manifest creation. Unscheduled manifests reserve
  it inside departure. Both paths lock the vehicle first and rely on the partial unique index as
  the final concurrency invariant.
- Manifest created/closed/departed, approval required, threshold reached, and delivery outcomes
  append outbox rows in the same transaction as their state mutation. Gram values in payloads are
  decimal strings.
- Real PostgreSQL tests exercise daily evaluation deduplication, approval precedence and decision,
  same-day booking collision, departure, outbox atomic visibility, and the reservation unique index.

### 14.2 Still required before Phase 2 is complete

- A scheduler that invokes the business-local, per-day evaluator after cutoff. The evaluator itself
  is persisted and idempotent; only periodic orchestration remains.
- Manifest cancellation and reservation release. Departure and automatic completion are present.
- Asynchronous outbox delivery and retry processing. Transactional writes and deduplication are
  present.
- Driver-focused manifest UI and permission-scoped assignment.
- Fulfillment operations in the runtime tool registry (not direct MCP methods), including mutation
  confirmation, permission checks and idempotency.
- Threshold-crossing detection and the remaining Phase 2 integration/end-to-end tests.

### 14.3 Phase 3 status

The repository already has an authenticated Telegram webhook and outbound `sendMessage`, but no
adapter translates a Telegram identity/conversation into the canonical invoice/order flow. That
adapter, official WhatsApp Business integration, and outbox-driven customer notifications remain
Phase 3 work. No channel-specific order model should be introduced.
