# Soko conversation-first frontend: architecture and migration roadmap

Status: roadmap adopted, Phase 1 implemented
Date: 2026-08-19
Design contract: three mockups reviewed as one product system —
`soko-shell-mockup.html`, `soko-sell-status-mockup.html`,
`soko-buy-unified-cart-mockup.html` (not committed to the repo; treat this
document plus the running Buy/Sell implementation as the durable record of
their content).
Decision: **full shell replacement** — home becomes the session list and
Soko's permanent UI is reduced to
`SokoShell → SessionList → ConversationSession → Composer → GeneratedSurface`,
with every other business view (products, customers, invoices, payments,
suppliers, network, sync, runtime history, imports, logistics, compliance,
beta, launch, reports, notifications) migrated one at a time into
generated-in-conversation surfaces, done incrementally with the existing
view staying live until its replacement genuinely works — never a
big-bang cutover.

## The governing principle

> Conversation is the app. Buy/Sell is a mode, not a page.

Soko is not an e-commerce site with chat added. It is a conversation
runtime in which commerce interfaces are rendered. The mockups' shell
explicitly rejects Catalogue and Orders tabs; the session list is the
entire home screen; everything past it — product cards, confirmations,
status posts, cart, checkout — is tool output the agent places into the
thread, not a hard-coded page.

That distinction is an architectural constraint here, not a styling
decision: **a capability's primary frontend representation is a
generated conversation surface, not a permanent page**, unless a concrete
reason says otherwise (see "When a permanent page is still correct"
below).

## Audit: what already matches the mockups

This is the most important finding of the audit. A large fraction of the
Buy/Sell mockups' content already exists in the repository, built during
earlier work on the same underlying product vision, before these specific
HTML files were reviewed together as a system. Nothing here needed to be
invented from scratch.

### Sell flow (`soko-sell-status-mockup.html`) — already built

| Mockup step                         | Existing implementation                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Attach photo                        | Existing product-capture upload pipeline (reused, not duplicated)                                                                                                                                                                                                                                                                                                                                                                       |
| Vision detects items, pins on photo | `packages/shared-types/src/index.ts` `ProductCaptureItemSummary.boundingBox` (normalized `{x,y,width,height}` in `[0,1]`, exactly the mockup's coordinate convention). `detectionAvailable` is honestly `false` today — no real vision model is wired in — and the frontend renders that fact ("Detection isn't available yet — review manually") rather than fabricating pins, per `apps/web/src/ProductCaptureItemsCard.tsx:103-107`. |
| Seller reviews/edits per item       | `ProductCaptureItemsCard.tsx` — confirm/reject per item through `/product-captures/.../items/.../confirm`, never a direct catalogue write                                                                                                                                                                                                                                                                                               |
| Contact picker, never select-all    | `apps/web/src/StatusBroadcastComposer.tsx:28-36` — explicit comment: "Never default to select-all: only pre-check contacts who are both a matched Soko account and an existing customer of this business"                                                                                                                                                                                                                               |
| Status posted, tracked              | `apps/web/src/StatusBroadcastCard.tsx` + `StatusBroadcastSummary` (`viewCount`/`replyCount`/`resultingOrderIds`) — a real trackable object, not a plain message                                                                                                                                                                                                                                                                         |

One deliberate deviation from the mockup: its step-3 contact list checks
Pastor Njoroge (labeled "In phonebook", not "Regular customer") by
default, which is inconsistent with its own "contacts-only by default,
trust model" note. The existing, already-tested backend rule
(`defaultSelected` only when `isExistingCustomer && isSokoUser`) is more
precisely specified and is what the implementation follows — the mockup's
example checkbox state was not copied literally.

### Buy flow (`soko-buy-unified-cart-mockup.html`) — already built

| Mockup step                                                   | Existing implementation                                                                                                                                                                                                                                   |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One query, fan-out, no source picked first                    | `services/api/src/cp2/domains/commerce/store.ts:933-997` `searchBuyFeed` — merges `listPublicStorefronts` and `listStatusBroadcastsReceivedByViewer` server-side                                                                                          |
| Contacts rank above marketplace at comparable price/relevance | Same function, line 989: `buyTextRelevanceScore(...) + (sourceKind === "contact" ? 50 : 0)` — a flat bonus, not unconditional priority; a much stronger catalogue match still outranks a barely-relevant contact result                                   |
| Marketplace connectors                                        | `BuyResultSourceKind = "contact" \| "catalogue" \| "marketplace_connector"` exists in the type system; `marketplaceConnectorAvailable` is always `false` — never fabricated (matches `ProductCaptureItemSummary.detectionAvailable`'s honesty convention) |
| Distinct result rendering by source                           | `apps/web/src/StatusResultCard.tsx` — `buy-source-badge buy-source-${sourceKind}`                                                                                                                                                                         |
| Cart grouped, not merged                                      | `apps/web/src/UnifiedCartSummary.tsx` — grouped by `${sourceKind}:${sourceId}`, one combined total, source label per group                                                                                                                                |
| Checkout: one action, N fulfilment handoffs                   | `services/api/src/cp2/domains/commerce/store.ts:999-1112` `createUnifiedCheckout` — one order per distinct source (draft invoice per business, no-invoice peer order per contact status); failures surfaced, never silently dropped                       |
| Order tracking shows the split                                | `apps/web/src/FulfilmentSplitCard.tsx` — "N contact pickups + M shop orders," independent status per handoff                                                                                                                                              |
| Settlement decision                                           | Recorded explicitly in `documentation/COMMERCE_SETTLEMENT_DECISION.md` — no payment capture today (no live rail exists), recommended direction for when one does                                                                                          |

Both flows are wired into the live conversation renderer already —
`apps/web/src/ChatSurface.tsx:781-804` renders `ProductCaptureItemsCard`
/ `StatusBroadcastCard` / `FulfilmentSplitCard` per-message off structured
metadata, lazy-loaded, not as separate app sections.

### Generated surface protocol — already correctly typed at the wire level, not at the render level

`ConversationMessageContent` (`packages/shared-types/src/index.ts:445-460`)
is already a proper discriminated union by `type`: `text`, `product-card`,
`encrypted`, `storefront`, `owner-controls`, `confirmation`,
`product-capture-progress`, `status-broadcast`, `unified-checkout`. The
server constructs these; nothing renders raw model HTML or executes
model-generated code anywhere in the repository.

The gap was entirely on the frontend rendering path. `mapConversationMessage`
(`apps/web/src/chat-message-plumbing.ts:48-108`) already switches on
`message.content.type` correctly, but then **flattens** each variant into
a growing bag of optional fields on the frontend's own `ChatMessage` type
(`businessCards`, `productCaptureJobId`, `statusBroadcastId`,
`unifiedCheckoutId`, ...), and `ChatSurface.tsx` checked each field with
its own `message.field !== undefined ? <SpecificCard /> : null` block.
Every new surface type meant one more optional field plus one more
if-block, growing without bound — exactly the anti-pattern Stage 4 of the
design brief calls out, just arrived at through field-flattening rather
than phrase-matching. **This is fixed in Phase 1, below.**

### Buy/Sell mode — genuinely not per-session yet, and non-trivial to make so

This is the one place where the mockups describe something the repository
does not yet have, and where "just move a variable" would be wrong.

- `apps/web/src/hooks/useNavigationState.ts` holds `mode: SokoMode`
  (`"marketplace" | "seller"`) as a single piece of state for the whole
  app — not a property of any individual conversation.
- The server has an equivalent concept, `SokoSessionContext`
  (`packages/shared-types/src/index.ts:1108-1133`), but it is stored
  **one row per account** (`services/api/src/cp2/store.ts:6060-6093`,
  keyed by `session.account.id`, not by conversation), and it already
  gates real authorization: `createConversationMessage` throws
  `seller_context_required` when `context.mode !== "seller"` for an
  owner-controls message (`services/api/src/cp2/domains/messaging/store.ts:2442-2448`).
  Moving `mode` to be per-conversation is therefore not a pure frontend
  change — it changes an authorization input.
- Conversations are already genuinely multi-instance per account (the
  inbox lists `personal` / `storefront` / `order` conversations), but the
  owner's own agent chat is a **singleton**:
  `ensurePersonalAccountConversation` (`services/api/src/cp2/domains/messaging/store.ts:3512-3533`)
  finds or creates exactly one `kind: "personal", activeShopId: null`
  conversation per account. The mockup's session list shows several
  independently-titled owner-agent sessions ("Restock maize", "Chicken
  feed", "School laptop") each with their own mode — today's data model
  supports exactly one.

Making Buy/Sell genuinely per-session therefore requires, in order:
(1) allowing an account to have more than one personal agent conversation,
(2) moving mode (and the authorization check that reads it) from
account-scoped to conversation-scoped, (3) the frontend session-list UI
that lets a user create/open/rename these. This is sequenced as Phase 3
below, after the safer, purely-additive Phase 1 and Phase 2 work, and it
gets a dedicated audit of every `context.mode` read site before any code
changes, per the same discipline used everywhere else in this codebase's
modularization work — trace every call site, don't guess.

### The 15 conventional top-level views

`apps/web/src/app-shell.ts`'s `ShellView` union has 17 entries: `home`,
`chat`, and 15 business views (`products`, `suppliers`, `customers`,
`invoices`, `network`, `sync`, `runtime`, `payments`, `imports`,
`logistics`, `compliance`, `beta`, `launch`, `reports`, `notifications`).
`SokoApplication.tsx`'s `renderActiveWorkspace()` is a single switch
statement rendering one `*Surface` component per view.

The good news for migration risk: every one of these 15 views is already
a clean, self-contained, prop-driven component
(`ProductSurface`, `CustomerSurface`, `InvoiceSurface`, ...), each backed
by its own already-extracted domain hook (`useProductsState`,
`useCustomersState`, `useInvoicesState`, `usePaymentsState`,
`useSuppliersState`, `useNetworkState`, `useSyncState`,
`useRuntimeHistoryState`, `useImportsState`, `useLogisticsState`,
`useReadinessState` for compliance/beta/launch, `useReportsState`,
`useStorefrontCareState`/`useNotificationsState`) from the earlier
OwnerApp state-decomposition effort. None of these components are
entangled with routing. Migrating a view to a generated surface is a
presentation-layer change — reuse the existing Surface component and its
hook unchanged, change how it is _reached_ (a conversation action instead
of permanent top-level navigation), not a business-logic rewrite.

## Target architecture

```text
                    SOKO SHELL
                        │
              ┌─────────┴─────────┐
              │                   │
          Sessions            New Session
              │
              ▼
      Conversation Session
              │
       ┌──────┴──────┐
       │             │
      BUY           SELL
       │             │
       └──────┬──────┘
              │
           Agent
              │
        Tool / capability calls
              │
              ▼
       Generated Surfaces
              │
    ┌─────────┼──────────┐
  Search     Cards      Domain view
  results   /status    (products, invoices, ...)
```

`SokoShell → SessionList → ConversationSession → Composer → GeneratedSurface`
are the only permanent frontend concepts. Catalogue, orders, checkout,
status, product management, search results, and the other 15 business
views do not get top-level navigation because implementing them as
conventional pages was easier — that is exactly the shortcut the mockups'
own design notes reject.

### When a permanent page is still correct

Not never. A view stays a permanent, directly-navigable page when:

- it is a settings/identity/security surface with no natural conversation
  phrasing (device sessions, passkeys, MFA, business compliance
  paperwork) — `IdentitySecurityPanel`/`ComplianceSurface` are candidates
  to remain reachable from a menu rather than forced into a chat turn;
- it is accessed far more often via deep link/notification than via a
  fresh conversation (e.g. opening a specific invoice from a payment
  reminder push);
- forcing it through conversation would require inventing a fake natural-
  language phrasing for something that is inherently a form review, not a
  request (bulk CSV import row correction is a plausible example).

Each of the 15 views gets this judgment call made explicitly during its
own migration phase (below), not decided in bulk here. Default assumption
going in: it becomes a generated surface unless a phase's own audit finds
a concrete reason it shouldn't.

## The generated-surface protocol (Phase 1 — implemented)

`ConversationMessageContent` (wire, already correct) is now carried
through to the frontend without flattening. `ChatMessage.content?:
ConversationMessageContent` replaces the five ad hoc optional fields
(`businessCards`, `productCaptureJobId`, `statusBroadcastId`,
`unifiedCheckoutId`, `confirmationToken` stays separate since it is read
independently of card rendering for the confirm-action flow).

`apps/web/src/generated-surface-registry.tsx` is the renderer registry:

```ts
type GeneratedSurfaceRenderer = (props: {
  content: ConversationMessageContent;
  businessId: string | null;
}) => ReactNode | null;

const generatedSurfaceRegistry: Partial<
  Record<ConversationMessageContent["type"], GeneratedSurfaceRenderer>
> = {
  "product-capture-progress": (...) => <ProductCaptureItemsCard ... />,
  "status-broadcast": (...) => <StatusBroadcastCard ... />,
  "unified-checkout": (...) => <FulfilmentSplitCard ... />,
  "owner-controls": (...) => <AccountBackendControls ... />
};

export function renderGeneratedSurface(...): ReactNode | null {
  const renderer = generatedSurfaceRegistry[content.type];
  return renderer === undefined ? null : renderer({ content, businessId });
}
```

An unrecognized `content.type` (a future server addition the client
hasn't shipped a renderer for yet) returns `null` and the message still
renders its `body` text — it degrades safely instead of crashing the
thread. This is the exact behavior required by "unknown surface types
must degrade safely."

Adding a new capability's generated card going forward is: add the
variant to `ConversationMessageContent`, add one registry entry. It does
not require touching `ChatSurface.tsx`'s render body again.

## Roadmap

| Phase | Scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Status                                                                                                                                          |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Generated-surface protocol: typed content carried through, renderer registry, safe unknown-type fallback                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | **Implemented** (this change)                                                                                                                   |
| 2     | Session-list-as-home foundation: audit every `SokoSessionContext`/`context.mode` read site; design the per-conversation mode + multi-session data model change; land it behind the existing conversation/session infrastructure without changing today's single-session behavior yet                                                                                                                                                                                                                                                                                                                  | Sequenced next                                                                                                                                  |
| 3     | Multi-session UI: session list becomes the home screen (`ConversationInboxItem` already has the shape - title/preview/time/unread); `New session` creates a real personal agent conversation; Buy/Sell toggle persists per-session once Phase 2's data model lands                                                                                                                                                                                                                                                                                                                                    | Sequenced after Phase 2                                                                                                                         |
| 4a–4o | One phase per remaining `ShellView` (products, suppliers, customers, invoices, network, sync, runtime, payments, imports, logistics, compliance, beta, launch, reports, notifications): give each domain a chat-invokable capability/tool that renders its existing `*Surface` (or a new focused generated card) inline in a session, then remove its permanent top-level nav entry once the generated path is proven equivalent. Order: highest chat-relevance first (products, customers, invoices, payments), settings/compliance-style surfaces last per "When a permanent page is still correct" | Not started - each phase gets its own audit + roadmap entry when it begins, mirroring `domain-modularization-roadmap.md`'s per-phase discipline |
| 5     | Architectural enforcement: import-boundary guard preventing a new permanent `ShellView` from being added without an explicit documented exception; regression tests asserting the generated-surface registry, not a growing if-chain, is the only way `ChatSurface.tsx` picks a card component                                                                                                                                                                                                                                                                                                        | Sequenced after the view migrations that would otherwise regress it                                                                             |

Legacy pages are removed only after their generated-surface replacement
is proven working — never a big-bang cutover. A catalogue page may
disappear while catalogue APIs and their domain hook remain untouched; an
orders page may disappear while order state remains essential. The
distinction is which layer serves conversation vs. permanent navigation,
not whether the underlying capability exists.

## Non-goals (carried forward from the original decomposition discipline)

Do not: create microservices; introduce a second agent runtime, MCP
implementation, or context runtime; inject model-generated HTML or
execute model-generated code; fabricate marketplace connector results;
fabricate contacts access; fabricate payment/settlement success for an
unsupported path; auto-publish AI-extracted listings without seller
confirmation; move business authorization to the client; remove a
permanent view before its generated-surface replacement exists and is
tested.
