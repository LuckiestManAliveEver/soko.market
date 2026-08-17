# Domain modularization roadmap

## Why this exists

`services/api/src/cp2/store.ts` is a single class (`Cp2Store`) backing 128
entity `Map`s (123 remaining after the first extraction below) behind one
shared auth gate, one generic in-memory snapshot/restore cycle, one generic
Postgres persistence sweep (`postgres-store.ts`'s `normalizedCollections`),
and one account-deletion/GDPR-purge sweep. At ~27,000 lines it is the
single largest deviation from a one-concern-per-directory architecture in
this codebase, and the same is true in a smaller way of
`apps/web/src/SokoApplication.tsx` (~22,900 lines) on the frontend.

**True multi-service separation (independent deploy unit, independent
persistence) is not what this roadmap proposes.** That would require
re-architecting the shared persistence and auth layer first - a
foundational rewrite touching all 123 remaining entity types, with a
regression blast radius covering the entire product. This roadmap is
instead **in-process domain modularization**: splitting `store.ts` into
per-domain classes composed together inside the same `Cp2Store`, each
owning its own `Map`s and business logic, with explicit constructor-
injected dependencies instead of ambient `this.*` reach into the rest of
the store. This delivers the real value CLAUDE.md's services-first
principle is after - sharp per-concern boundaries, a file you can actually
review and reason about, less risk of two changes in different domains
colliding - without pretending the persistence/auth coupling isn't there.

## The pattern (established by the first slice)

See `services/api/src/cp2/domains/commerce/` for the reference
implementation: `store.ts` (a `CommerceDomain` class owning
`product_capture_jobs`/`status_broadcasts`/`buy_orders`/`status_orders`/
`unified_checkouts`), `shared.ts` (domain-local pure helpers), and a
`CommerceDomainDeps` interface listing every cross-domain dependency
explicitly (auth checks, product/business/network/customer/user lookups,
invoice building). `Cp2Store` constructs it once and delegates its public
methods to it with identical signatures - a zero-behavior-change
extraction, verified by the full test suite (in-memory) and the live-
Postgres restart-persistence test (`tests/cp2-postgres-store.test.ts`)
staying green before and after.

Two small supporting extractions made this safe rather than circular:
`cp2-error.ts` (the `Cp2Error` class) and `text-normalization.ts` (two
generic string validators) - both pulled out of `store.ts` first, since a
domain module throwing/validating with them would otherwise need a
circular value-import back into `store.ts`. Both are re-exported from
`store.ts` for existing external consumers (routes.ts, tests), so nothing
outside this refactor needed to change. Any future domain extraction that
needs another store.ts-local helper should follow the same move-it-out-
first pattern rather than importing back into store.ts.

Every extraction should also touch the same four generic sweep sites in
`store.ts` for its own Maps: `Cp2Snapshot` (add fields), `snapshot()`
(serialize), `hydrateSnapshot()` (clear + repopulate - **the first slice
found and fixed a real bug here**: `statusBroadcasts`/`buyOrders`/
`statusOrders`/`unifiedCheckouts` were missing from the clear step before
this roadmap's own first pass caught it, meaning a live resync could have
left stale entries behind), and the account-deletion sweep
(`deleteScopedMapRecords` calls). Also check `postgres-store.ts`'s
`normalizedCollections`/`emptySnapshot()`/column-mapping candidate lists
(`firstText(...)` calls) and `scripts/purge-all-users.sql`'s table
classification - all of which the commerce slice needed and are easy to
forget, per this session's own experience fixing exactly this class of gap
for the same five tables after the fact.

## Candidate domains, sequenced low-coupling first

Coupling here means "how many Maps/methods outside the domain does it need
to read or call" - roughly what `CommerceDomainDeps` would look like for
each. Higher-coupling domains are listed later not because they matter
less, but because extracting them safely requires the pattern to be
proven on easier cases first.

| Order | Domain | Maps | Coupling | Notes |
|---|---|---|---|---|
| 1 | **Compliance/Beta/Launch** | `verificationTiers`, `taxConfigs`, `deviceTrust`, `betaAccess`, `betaFeatureFlags`, `betaDeviceTests`, `betaSupportTickets`, `betaTelemetryEvents`, `launchSettings`, `launchChecklist`, `launchIncidents` | Low | Mostly self-contained business-scoped config/reporting; only needs auth + `businesses`. Best first real slice to prove the pattern on unfamiliar (not self-written) code. |
| 2 | **Logistics & receipts** | `logistics`, `logisticsByInvoice`, `purchaseReceipts`, `receiptLineItems`, `receiptOCRJobs` | Low-medium | Needs `invoices`, `suppliers` lookups; receipt OCR has its own provider abstraction already (`receipt-ocr-provider.ts`) that's a good template for further sub-splitting. |
| 3 | **Suppliers & sales agents** | `suppliers`, `salesAgents`, `supplierContactLinks` | Medium | Needs `networkNodes`/phonebook lookups (same pattern the commerce slice already solved for contacts) plus `purchaseReceipts`. |
| 4 | **Document imports** | `documentImports`, `documentImportSources` | Medium | Needs `products`/`suppliers` write access for confirmed imports; has its own binary-upload-pipeline dependency already abstracted. |
| 5 | **Notifications** | `notifications`, `notificationByRuleKey` | Medium | Read-heavy from almost every other domain (it's a notification *sink*) - needs an event/observer boundary more than a dependency list, worth designing deliberately rather than copying the deps-object pattern verbatim. |
| 6 | **Network/contacts graph** | `networkNodes`, `networkEdges`, `networkSources`, `networkPermissions`, `networkRoutes`, `contactHashes`, `contactHashIdByValue`, `externalIdentities`, `externalIdentityIdBySubject`, `sokoIdentityLinks` | High | The commerce domain (and likely suppliers, notifications) already depend heavily on this one - extract it *after* its consumers so their deps interfaces are stable, not before. |
| 7 | **Messaging & channels** | `conversations`, `conversationParticipants`, `conversationMessages`, `platformIdentities`, `conversationChannels`, `providerUpdateReceipts`, `channelIdentityLinkGrants`, `nativeSmsDevices`, `nativeSmsDeviceCommands`, `connectedMailboxes`, `connectedMailboxOAuthSessions`, `messageDeliveryAttempts`, `messageNotificationDeliveries`, `e2eeDevices`, `conversationTyping`, `messageByClientId`, `messageByIdempotencyKey` | High | Large and already has its own `channel-gateway.ts`/adapter abstraction to build on; E2EE rules (`validateConversationEncryption`) are load-bearing and easy to regress - the commerce slice's status-broadcast bug (an earlier version tried to push a plaintext message into an E2EE-required conversation) is exactly the kind of mistake to guard against here with extra test coverage before extracting. |
| 8 | **Agent/AI runtime** | `activeAiModels`, `agentProfiles`, `agentRuntimeVersions`, `agentContextSources`, `agentEvaluationEvents`, `agentOwnerCorrections`, `installedAgentModels`, `agentModelAssignments`, `browserInferenceAssignments`, `agentModelBindings`, `runtimeSessions`, `runtimeTurns`, `pendingRuntimeActions` | High | Also touches `mcpAccessTokens`/`mcpTokenIdByHash` and the model-runtime adapters in `services/api/src/inference/`; this is the domain the new AI eval harness (`services/api/scripts/run-ai-eval.ts`) exercises, so extracting it should keep that harness green as an extra check. |
| 9 | **Core auth/identity/session** | `accounts`, `users`, `sessions`, `passkeys`, `oauthSessions`, `accountPinHashes`, `mfaFactors`, `deviceTrust`-adjacent identity tables, etc. (~25 Maps) | Highest - do last | Everything else depends on `requireAuthorizedSession`/`requirePinVerifiedSession`, which live here. This isn't really a "domain" so much as the kernel every other domain calls into - it may never make sense to extract in the same way, and deserves its own dedicated design discussion rather than following this table mechanically. |

Invoicing/payments/products/customers (`invoices`, `payments`, `products`,
`productMedia`, `productFieldSchemas`, `customers`, `inventoryMovements`,
`publicOrders`, `publicStorefrontMessages`, `publicCustomerCareRequests`,
`nextInvoiceNumberByBusiness`) are deliberately not slotted above - the
commerce domain already depends on `createProduct`/`updateProduct`/
`buildStoredInvoice`/`requireProduct`, so extracting *this* cluster next
would immediately need to either duplicate that logic or have two domains
depend on each other. It should be tackled together with or immediately
after supplier/logistics (which also touch invoices), as one deliberately
scoped effort, not slotted into the low-to-high queue above.

## Ground rule for every future slice

One domain per PR. Full test suite must stay at the same pass/skip/fail
count before and after (currently 657 passed / 15 skipped / 1 pre-existing
unrelated failure - the migration-051 checksum test). Re-run the live-
Postgres persistence test for that domain's tables specifically, the same
way this slice did, before calling it done - the in-memory test suite
alone will not catch a missed `normalizedCollections`/`emptySnapshot()`/
purge-script entry, all three of which are silent failures that only show
up against a real database or a real account-deletion request.
