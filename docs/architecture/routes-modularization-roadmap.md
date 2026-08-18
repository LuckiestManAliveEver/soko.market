# Routes modularization roadmap

## Why this exists

`services/api/src/cp2/routes.ts` is the HTTP layer's counterpart to
`services/api/src/cp2/store.ts` (see `domain-modularization-roadmap.md`,
now complete - all 15 business-logic domains extracted into
`services/api/src/cp2/domains/<name>/store.ts`). `routes.ts` itself was
never split: one 9,622-line file, one giant exported function
(`registerCp2Routes`, ~8,500 lines), registering all 307 Fastify routes
inline, even though the store-side logic each route calls into is now
cleanly domain-owned. The HTTP layer is the one place left where the
domain boundaries store.ts now has aren't reflected in the file structure.

This roadmap does the same **in-process modularization** for routes:
split `registerCp2Routes` into a `registerXRoutes(app, store, ...)`
function per domain, living in `services/api/src/cp2/domains/<name>/
routes.ts` next to that domain's existing `store.ts`/`shared.ts`. The
remaining `registerCp2Routes` in `routes.ts` becomes a thin composition
root: call every domain's `registerXRoutes`, plus keep the genuinely
irreducible CORE routes (auth/session/account/business/membership) that
don't belong to any domain.

## The pattern (established by the first slice: Logistics)

`services/api/src/cp2/route-helpers.ts` was split out first, before any
domain route file existed - the same "move-it-out-first" reasoning that
produced `cp2-error.ts`/`text-normalization.ts` on the store.ts side.
It holds the genuinely domain-agnostic request-parsing and error-response
helpers used across nearly every route: `sendCp2Error` (used by ~250 of
307 routes), `parseString`/`parseOptionalString`/`parseNullableString`/
`parseRequestBody`/`parseStringArray`, the numeric parsers
(`parseNumber`/`parseNullableNumber`/`parsePositiveInteger`/
`parseNonNegativeInteger`/`parseOptionalNonNegativeInteger`/
`parseIntegerString`/`parseBoolean`/`parseIsoTimestamp`), and the
`BusinessParams` interface (`{ businessId: string }`, extended by 25+
domain-specific param interfaces). Every future domain route file imports
from `route-helpers.ts`, never from `routes.ts` itself - avoiding a
circular import back into the file being split apart.

`services/api/src/cp2/domains/logistics/routes.ts` is the reference
implementation: a single exported `registerLogisticsRoutes(app, store)`
function containing the domain's 3 route registrations, plus the
domain-local param/body interfaces and body-parsing helpers that only
that domain needs (`LogisticsParams`, `LogisticsBody`,
`LogisticsStatusBody`, `parseFulfillmentMethod`, `parseFulfillmentStatus`).
`registerCp2Routes` calls `registerLogisticsRoutes(app, store)` in place
of the 3 routes that used to be inline. Picked as the first slice for the
same reason it was picked first on the store.ts side: smallest route
footprint, zero cross-domain coupling.

**One real wrinkle already found**: `routes.ts`'s own
`parseSyncMutationPayload` (part of the offline sync-queue mutation-replay
dispatcher, genuinely CORE - it fans out across every domain's body
shape by `mutationType`) had two `case` branches
(`"logistics.create"`/`"logistics.update_status"`) calling
`parseLogisticsBody`/`parseLogisticsStatusBody` directly. Fixed by
exporting those two parsers from `domains/logistics/routes.ts` and
importing them back into `routes.ts` - the same "some helpers stay
genuinely cross-domain, export and re-import rather than duplicate"
lesson the store.ts side hit repeatedly (`otpTtlMs`, `hashOtp`, etc.).
**Expect every future domain extraction with sync-queue support to hit
this same dispatcher** - grep `parseSyncMutationPayload`'s `switch`
before extracting a domain that owns a `*.create`/`*.update_status`-style
sync mutation type.

## Domain route slices, sequenced low-coupling first

Route counts, approximate line footprint, and coupling assessment come
from a structural research pass over the whole file (307 total route
registrations: 110 GET, 147 POST, 7 PUT, 25 PATCH, 18 DELETE) that
matched every route's `store.<method>(...)` call against the domain each
method belongs to. That mapping is ~95% mechanical (most `Cp2Store`
public methods are one-line delegators to a domain, e.g.
`return this.xxxDomain.method(...args)`) but not 100% - a handful of
`Cp2Store` methods aggregate across domains or make an incidental
side-effect call into another domain's map. Re-check the store method
body directly before trusting a route's domain assignment, the same
"read the method bodies, not just the names" lesson the store.ts roadmap
learned the hard way on its own first slice.

| Order | Domain | Routes | Coupling | Notes |
|---|---|---|---|---|
| 1 | **Logistics** ✅ done | 3 | Low (confirmed - zero cross-domain calls) | `services/api/src/cp2/domains/logistics/routes.ts`. The reference implementation - see "The pattern" above. `parseLogisticsBody`/`parseLogisticsStatusBody` exported for `routes.ts`'s sync-mutation-replay dispatcher. |
| 2 | **Notifications** | 2 | Low (expected - smallest surface after logistics) | `GET/PATCH /businesses/:businessId/notifications*`. Even smaller than logistics but a thinner slice, less representative as a template - good second warm-up regardless. |
| 3 | **Passkeys** | 8 | Low-Medium | Needs the `passkeyRelyingParty` closure (routes.ts:1134 as of the research pass, will drift - re-grep before extracting), which is passkey-specific and moves with the domain. |
| 4 | **Network** | 11 | Low-Medium | Self-contained per the research pass - re-verify, since the store-side network domain had real reverse coupling into core-kernel Maps that a route-level pass might not have surfaced. |
| 5 | **Suppliers** | 16 | Medium | Receipt-OCR-confirm route (`POST /businesses/:businessId/receipt-ocr/jobs`) is one of the 9 genuinely cross-domain routes (also calls `document-imports`'s `assertDocumentImportWriteAccess` guard) - decide whether that guard moves with document-imports and gets imported, or gets duplicated. |
| 6 | **Document imports** | 10 | Medium | Shares `prepareDocumentUpload` (a mid-body closure inside `registerCp2Routes`, not module-level) with the commerce product-captures route - same cross-domain-closure question as suppliers' receipt-OCR route. Also owns `assertDocumentImportWriteAccess`, needed by both suppliers and commerce routes above/below. |
| 7 | **OAuth** | 20 | Medium | Needs `oauthRedirectUriForRequest`, `enabledAuthProviders`, `startOAuthSession`, `completeOAuthSession` closures (all oauth-specific, clean to move) - re-verify against the current file before extracting, closures may have shifted. |
| 8 | **Compliance** | 20 | Low-Medium | verification/tax-config/device-trust/beta/launch routes - large single-use body-parser cluster (`parseVerificationTierBody` through `parseBetaTelemetryMetadata`) moves wholesale, no cross-domain routes found. |
| 9 | **Commerce** | 17 | Medium | `POST /businesses/:businessId/product-captures` is cross-domain (calls `document-imports`'s `assertDocumentImportWriteAccess`) - same guard-sharing question as suppliers/document-imports above. Sequence after document-imports so the guard's home is already decided. |
| 10 | **Sales** | 27 | Medium-High | Products/customers/invoices/payments/purchase-receipts/storefront-orders. `GET /public/storefronts` is checked by literal-string assertion in `tests/frontend-user-guidance.test.ts:401` (`apiRoutes` variable, raw `readFileSync` of `routes.ts`) - **that test's read target must be repointed to this domain's new route file when this row is extracted**, confirmed the only such literal-string breakage among the 4 read-sites in that test. |
| 11 | **Agent-runtime** | 37 | Medium-High | Large single-use body-parser cluster (ai-models, agent-profile, agent-model/browser-inference assignment bodies) moves wholesale; check for cross-references into `mcp-tokens` before extracting (mcp-tokens has 0 routes of its own - issuance lives in the separate `services/api/src/mcp/routes.ts` file, not this one - so no actual coupling expected, just verify). |
| 12 | **Messaging** | 42 | High | Biggest slice by route count - conversations, e2ee, push, mailboxes, native-sms, channels, webhooks, handoffs, typing. `updateSokoSessionContext` (CORE, stays put) calls `messagingDomain.requireAccountConversation(...)` for a real authorization check - confirm that store-level call survives untouched (it's on the store side, not routes, so likely unaffected, but verify the route handler for `PATCH /v1/session/context` doesn't need anything messaging-specific moved with it). |
| — | **OTP** | 10 pure + 5 shared with CORE | High (shared-closure entanglement, not route-body complexity) | `requestOtpForBody`/`verifyOtpForBody` closures (routes.ts:1191/1225 as of the research pass) are called from CORE signup/recovery/merge routes (`/auth/email/verification/start`, `/auth/identity/email/start`, `/auth/recovery/start`, `/auth/recovery/verify`, `/auth/identity/email/merge/verify`) as well as the pure `/auth/otp/*` routes. Extracting this domain means deciding whether those two closures move to `domains/otp/routes.ts` and get imported back into the CORE routes that need them, or stay as CORE closures that the otp route file also imports - mirrors the store-side `otpChallengesMap` escape-hatch decision, just one layer up. |
| — | **Device bootstrap** | 3 pure + 3 shared with CORE | Medium (shared-closure entanglement) | `/auth/continue`, `/auth/device/recover`, `/auth/identity/merge/pin` all also call `prepareDeviceSession`(CORE)/`readDeviceSessionMetadata`. Same "does the CORE closure move or does the domain import it back" question as OTP, smaller surface. |
| — | **Irreducible CORE** (not a row) | 69 pure + 9 shared with otp/device-bootstrap | N/A | Auth/session/account/business/membership routes, plus `enforceAuthIpRate`, `requireAuthFeature`, `readIdentifier`, `normalizeAuthPhone`, `handleSessionRefresh`, `setAuthSessionCookies`, `parseAuthChannel`, `parseSyncMutationPayload` and its dispatcher siblings, `businessPermissions`/`parseOptionalPermission`. Whether this shrinks further once OTP/device-bootstrap are extracted (by moving their shared closures out) is a decision for those two rows, not assumed here. |

**mcp-tokens has no row** - it has 0 HTTP routes in this file; token
issuance lives entirely in the separate `services/api/src/mcp/routes.ts`
file, already its own module.

## Ground rule for every future slice

One domain per PR, same as the store.ts side. Full test suite must stay
at the same pass/skip/fail count before and after (baseline at the time
this doc was created: 657 passed / 27 skipped / 1 pre-existing unrelated
failure - the migration-051 checksum test - unchanged by any routes-layer
work, since it's a pure HTTP-registration refactor with no persistence
surface of its own). Typecheck (`pnpm --filter @soko/api typecheck`) and
lint (`pnpm exec eslint . --max-warnings=0`) are the two reliable gates
for this kind of extraction - a clean typecheck after the mechanical move
is the real proof of completeness, not a re-read of the diff. Grep
`tests/frontend-user-guidance.test.ts` for literal route-path/string
assertions against `routes.ts`'s raw source text before extracting any
domain - `/public/storefronts` (sales) is the one confirmed hit so far,
but re-check per-row since new hits could exist for domains not yet
extracted.

No live-Postgres re-verification is needed per row here (unlike the
store.ts roadmap) - this refactor only moves HTTP route registration and
request parsing, never touches `Cp2Snapshot`, `snapshot()`,
`hydrateSnapshot()`, or any persistence sweep. The regular test suite
(which exercises routes end-to-end via `app.inject(...)`) is the correct
and sufficient gate.
