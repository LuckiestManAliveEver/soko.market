# Domain modularization roadmap

## Why this exists

`services/api/src/cp2/store.ts` is a single class (`Cp2Store`) backing 128
entity `Map`s (102 remaining after the commerce, compliance, logistics,
suppliers/sales-agents/receipts, and document-imports extractions below)
behind one shared auth gate, one generic in-memory snapshot/restore cycle,
one generic
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
`cp2-error.ts` (the `Cp2Error` class, later joined by the `assertValid`
helper the compliance slice needed) and `text-normalization.ts` (two
generic string validators) - both pulled out of `store.ts` first, since a
domain module throwing/validating with them would otherwise need a
circular value-import back into `store.ts`. Both are re-exported from
`store.ts` for existing external consumers (routes.ts, tests), so nothing
outside this refactor needed to change. Any future domain extraction that
needs another store.ts-local helper should follow the same move-it-out-
first pattern rather than importing back into store.ts - check
`cp2-error.ts` first, since generic validation/error helpers belong there
now, not duplicated per domain.

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

**Correction from the second slice (Compliance/Beta/Launch, done):** this
table's coupling estimates were written from a signature-level grep, not
from reading the method bodies. Domain 1 turned out to have much higher
coupling than "Low" - `buildComplianceReport`/`buildBetaReadinessReport`/
`buildLaunchReadinessReport` (the readiness-dashboard builders) reach into
invoices, payments, sync queue, offline cache, products, customers,
logistics, data exports, and account-deletion requests to compute
readiness gates. The fix was a narrower domain boundary, not abandoning
the slice: `ComplianceDomain` (`services/api/src/cp2/domains/compliance/`)
owns the eleven Maps and every CRUD/validation/event method that reads or
writes them directly, plus public `getOrCreate*`/`*ForBusiness` accessors
for its own records. The three readiness-report builders and
`auditEventsForBusiness` stayed on `Cp2Store` since they are cross-cutting
report-engine logic that happens to read this domain's records, not
domain logic itself - moving them would have just relocated the ambient
coupling instead of removing it. **Read the method bodies, not just the
Map names, before estimating a future row's coupling** - a Map that looks
self-contained can still be read by a report builder that isn't.

| Order | Domain | Maps | Coupling | Notes |
|---|---|---|---|---|
| 1 | **Compliance/Beta/Launch** ✅ done | `verificationTiers`, `taxConfigs`, `deviceTrust`, `betaAccess`, `betaFeatureFlags`, `betaDeviceTests`, `betaSupportTickets`, `betaTelemetryEvents`, `launchSettings`, `launchChecklist`, `launchIncidents` | Medium (see correction above) | `services/api/src/cp2/domains/compliance/`. Readiness-report builders and `auditEventsForBusiness` deliberately stayed on `Cp2Store` - see the correction note above for why. Verified: full suite unchanged (657/15/1), live-Postgres persistence re-verified for all 11 tables in `tests/cp2-postgres-store.test.ts`. |
| 2a | **Logistics** ✅ done | `logistics`, `logisticsByInvoice` | Low (confirmed against method bodies) | `services/api/src/cp2/domains/logistics/`. Deps: `requireAuthorizedSession`, `appendBusinessEvent`, `requireInvoice`. `logisticsByInvoice` is a derived invoice-id -> logistics-id index, never a `Cp2Snapshot` field - rebuilt per-item during `hydrateSnapshot` and via a dedicated `rebuildLogisticsByInvoiceIndex()` method for the account-purge derived-index rebuild path. `summarizeLogistics` moved to the domain's `shared.ts` and is imported back into `store.ts` for the two report builders (`buildRuntimeContext`, `buildBusinessReport`) that still need it. Verified: full suite unchanged (657/16/1, +1 skipped from the new postgres test), live-Postgres persistence re-verified including the derived-index rebuild (a second `POST /logistics` for the same invoice must still 409 after a restart). |
| 2b/3 | **Suppliers, sales agents, and purchase receipts/receipt OCR** ✅ done | `suppliers`, `salesAgents`, `supplierContactLinks`, `purchaseReceipts`, `receiptLineItems`, `receiptOCRJobs` | High (confirmed) | `services/api/src/cp2/domains/suppliers/`. Extracted as one combined domain, not two - `createReceiptOCRJob`/`confirmReceiptOCRJob` call `matchSupplier`/`requireSupplier`/`createSupplier`/`matchSalesAgent`/`requireSalesAgent`/`createSalesAgent`, while `supplierBusinessCard`/`salesAgentCard` call back into `purchaseReceiptsForSupplier`/`purchaseReceiptsForSalesAgent` - splitting them would have recreated the same cross-module circular-dependency problem `cp2-error.ts`/`text-normalization.ts`/`money.ts` were pulled out to avoid. Needs `networkNodes`/`networkSources` (phonebook contact-matching) injected as raw Map references, same as `CommerceDomainDeps` did for `networkNodes`; `sanitizeNetworkNode` injected as a function since it's also used by the not-yet-extracted network-graph domain. Two more supporting extractions this slice needed: `money.ts` (`roundMoney`, used by the receipt-parsing block and 20+ other call sites) and moving `normalizeDestination` into `phone-identity.ts` (it belongs there conceptually and was already store.ts-exported for `tests/phone-identity.test.ts`). Verified: full suite unchanged (657/17/1), live-Postgres persistence re-verified for suppliers/sales-agents/purchase-receipts including the receipt-OCR-confirm flow and the derived `salesAgentCount`/`purchaseReceiptCount` card fields surviving a restart. |
| 4 | **Document imports** ✅ done | `documentImports`, `documentImportSources` | Medium (confirmed) | `services/api/src/cp2/domains/document-imports/`. `confirmSupplierImport`/`confirmProductImport` call back up into `Cp2Store.createSupplier`/`Cp2Store.createProduct` (still real methods there, not yet extracted) via injected deps functions - same "call back up" pattern `LogisticsDomainDeps.requireInvoice` uses. The binary-upload-pipeline note was previously imprecise: that dependency lives entirely in `routes.ts` (constructed from `registerCp2Routes` options), never in `store.ts` - the domain only ever receives an already-extracted `DocumentImportSourceInput`, so it needed zero pipeline wiring. Verified: full suite unchanged (657/18/1), live-Postgres persistence re-verified for the supplier-CSV-import-to-confirm flow. |
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
