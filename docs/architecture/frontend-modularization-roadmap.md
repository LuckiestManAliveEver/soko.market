# Frontend modularization roadmap

## Why this exists

`apps/web/src/SokoApplication.tsx` is 22,869 lines - the frontend
counterpart to the now-fully-modularized `services/api/src/cp2/store.ts`
and `routes.ts`. Unlike those two, it has never been split at all.

The file has three parts:

1. **Import block + shared types/constants** (lines 1-2183): 56 npm/local
   imports, then 107 interfaces, 33 type aliases, and 51 consts
   (including ~10 `lazy()`-loaded component references) used across
   almost everything below.
2. **`OwnerApp`** (lines 2211-8354, ~6,143 lines): one giant stateful
   root component - all the app's `useState`/`useEffect`/event-handler
   logic lives here as closures. This is the single hardest part of the
   file to decompose safely (extracting its state would mean introducing
   custom hooks or context, a real architecture decision with UI-visible
   risk) and is explicitly **out of scope for this roadmap** - a
   separate, later effort once this phase's approach is proven out.
3. **~34 presentational components** (lines 8354-22869, ~14,500 lines):
   already-separate top-level function components taking typed props
   (`ProductSurface`, `ChatSurface`, `AgentProfileSurface`,
   `InvoiceSurface`, etc.), each rendered by `OwnerApp` by name.
   **This is the scope of this roadmap.**

Confirmed via a full structural research pass (every boundary
line-verified against the live file): none of the 34 components are
nested inside one another or inside `OwnerApp` - every one is a
top-level sibling declaration. That makes this mechanically similar to
the backend's domain extraction (find the boundary, move it, wire
imports) but with one added wrinkle the backend never had: **~150
shared identifiers** (formatters, API helpers, bootstrap functions, the
merchant-command NLU engine, etc.) currently live as free functions
*after* the components, in a ~3,000-line tail (lines 19852-22869),
interleaved with 6 of the 34 components themselves.

## The circular-import trap this roadmap exists to avoid

If shared helpers stay in `SokoApplication.tsx` and each extracted
component just imports them from `"./SokoApplication.tsx"`, that creates
a real module-level circular import: `SokoApplication.tsx` imports the
19 components it renders from their new files, and those files import
shared helpers back from `SokoApplication.tsx`. This is fragile with
bundlers/lazy-loading even where it technically resolves.

**The fix, mirroring the backend's `route-helpers.ts` precedent**: pull
every genuinely shared piece into its own neutral file *before* moving
any component, so both `SokoApplication.tsx` (for `OwnerApp`) and every
new component file import from the same neutral source - never from
each other.

## Extraction order

### Phase 0 - shared foundation (must land first, everything depends on it)

1. **Shared types/constants file(s)** - the 107 interfaces + 33 type
   aliases + the non-component consts from lines 269-2183, plus the
   `lazy()` component references. Likely split into a couple of files
   (e.g. `soko-application-types.ts` for the type/interface block,
   `soko-application-lazy-modules.ts` for the `lazy()` bindings) rather
   than one - decide the exact split when executing, based on what
   groups cleanly.
2. **Shared utility modules**, per the research pass's grouping (each
   verified to have zero component-specific coupling):
   - `api-helpers.ts` - `postJson`/`patchJson`/`putJson`/`deleteJson`/`getJson`
   - `formatters.ts` - `formatMoney`/`formatOptionalMoney`/`formatPercent`/`formatDate`/`formatLatency`/etc. (~18 functions)
   - `sokoid-and-storefront.ts` - `isSokoId`/`normalizeSokoId`/`createFallbackSokoId`/`createStorefrontUrl`/etc.
   - `country-dial-codes.ts` - `getCountryDialCode`/`getCountryDialCodeByCountry`/`inferCountryCode`/`isCountryDialCode`
   - `owner-app-bootstrap.ts` - the `readStored*`/`readSetupDraft`/agent-defaults family (stays imported only by `OwnerApp`, but needs to be somewhere importable)
   - `agent-command-engine.ts` - the ~20-function merchant-command NLU engine rooted at `createAgentRuntimeDecision`
   - chat/message plumbing, contacts-import helpers - grouped per the research pass, exact file names decided at execution time

### Phase 1 - low-coupling components first

Components with the smallest external-dependency surface, sequenced
before the ones that need Phase 0's modules to already exist:
`PrimaryNavigation`, `NetworkNodeList`, `CustomerSurface`,
`EmptyStateSurface`, `ShopPresenceButtons`, `LogisticsSurface`,
`ReportRow`, `InvoiceDocument`.

### Phase 2 - the rest of the ~34, grouped by shared-helper cluster

Grouped so a component and the helpers it alone needs move together
where the research pass found tight 1:1 coupling (e.g. `ImportSurface` +
`SupplierImportRowEditor` + `ProductImportRowEditor` + their import-parsing
helpers; `NetworkSyncNestedCard` + `NetworkContactGroup` + their contact
helpers; `CatalogueNestedCard` + `ProductNestedEditor` + product-field
helpers). Remaining Surfaces (`BusinessSetupPanel`, `NetworkSurface`,
`SyncSurface`, `RuntimeSurface`, `PaymentSurface`, `SupplierSurface`,
`ComplianceSurface`, `BetaSurface`, `LaunchSurface`, `ReportsSurface`,
`NotificationsSurface`, `MarketplaceModeCard`, `StorefrontPreviewCard`,
`ContextualBusinessCards`) follow, each importing Phase 0's shared
modules directly.

### Phase 3 - the two large ones

- **`ChatSurface`** (1,313 lines) - moves as one file; internally simple
  (7 closures, straightforward hooks), needs 6 of the other extracted
  components as JSX children plus several Phase-0 modules.
- **`AgentProfileSurface`** (5,060 lines) - moves as one file for this
  phase; internally it's really ~8 merged account-settings sub-panels
  (AI models, mailboxes, social accounts, security/MFA, phone/email, MCP
  tokens, deletion, context scripts) with 82 closures and 45 `useState`
  calls, none of which escape the function. Splitting it further is a
  candidate for a later, separately-scoped effort - not this roadmap.

### Phase 4 - `PublicStorefrontChat` + wiring

`PublicStorefrontChat` (953 lines, exported, not rendered by `OwnerApp`
but consumed externally by `AppRouter.tsx:21` via
`loadSokoApplication().then((m) => ({ default: m.PublicStorefrontChat }))`).
Moves to its own file; `SokoApplication.tsx` re-exports it
(`export { PublicStorefrontChat } from "./PublicStorefrontChat";`) so
`AppRouter.tsx` needs no change.

### Phase 5 - final `SokoApplication.tsx` shape

After all 34 components move, `SokoApplication.tsx` should contain only:
the npm/local imports it still needs, `OwnerApp` itself, named imports
of the 19 components `OwnerApp` actually renders (confirmed exact list:
`PrimaryNavigation`, `BusinessSetupPanel`, `AgentProfileSurface`,
`ChatSurface`, `ProductSurface`, `SupplierSurface`, `CustomerSurface`,
`InvoiceSurface`, `NetworkSurface`, `SyncSurface`, `RuntimeSurface`,
`PaymentSurface`, `ImportSurface`, `LogisticsSurface`,
`ComplianceSurface`, `BetaSurface`, `LaunchSurface`, `ReportsSurface`,
`NotificationsSurface`), the `PublicStorefrontChat` re-export, and
imports from the Phase-0 shared modules for whatever `OwnerApp` itself
still calls directly (the bootstrap functions, the agent command engine
entry point, chat/message plumbing, contacts-import helpers - all
confirmed `OwnerApp`-needed by the research pass).

## Ground rule for every slice (same as the backend roadmaps)

One slice per commit. After each slice:
1. `pnpm --filter @soko/web typecheck` (or the equivalent build check)
   clean.
2. `pnpm exec eslint <changed files> --max-warnings=0` clean.
3. `pnpm exec prettier --check <changed files>`, fix if needed.
4. **Start the dev server and manually exercise the affected surface in
   a browser** - this is the one gate the backend roadmaps didn't need.
   A clean typecheck proves the types line up, not that the UI renders
   or behaves correctly. Per CLAUDE.md: "For UI or frontend changes,
   start the dev server and use the feature in a browser before
   reporting the task as complete."
5. Full test suite (`pnpm vitest run tests/`) stays at the pre-existing
   baseline - 657 passed / 27 skipped / 1 pre-existing unrelated
   failure (migration-051 checksum, unrelated to this work).
6. Commit, push.

No live-Postgres or persistence-layer re-verification needed - this is
a pure client-side code-organization refactor, zero backend surface
touched.
