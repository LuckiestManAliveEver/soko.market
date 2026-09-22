# ADR: Soko owns the ComputerRuntime abstraction

## Context

Soko was asked to give its agent a computer-use (browser-automation) capability: open an isolated
browser, navigate/observe/click/type/scroll/upload on an external website, with a live view the
user can watch, a "take control"/"return to Soko" handoff, and mandatory approval before any
consequential action. Several open-source computer-use frameworks exist that could plausibly
supply this wholesale - Stagehand, Browser Use, Browser Use Web UI, Open Operator, Skyvern,
BrowserCode. The task brief explicitly required auditing their licenses and prohibited coupling
Soko's domain code directly to any one of them.

The audit behind this change (`docs/architecture/computer-runtime-audit.md`) found that Soko
already owns the surrounding architecture this capability needs to plug into: a single canonical
tool registry and dispatcher (`runtimeToolRegistry`/`executeRuntimeCapability`), an immutable
portable-checkpoint protocol (`RuntimeHandoff`), business/account-scoped authorization, an audit
event log, and a proven pattern for isolating a resource-heavy worker process from the main API
(`services/receipt-ocr-service`). None of the candidate frameworks are a repository-architecture
fit as-is: each bundles its own session/state model, its own approval or human-in-the-loop
pattern (if any), and in most cases its own LLM-driven element-resolution step baked into the
same process that drives the browser - exactly the "model directly controls Chromium" shape this
task explicitly forbids.

## Decision

Soko defines its own provider-neutral `ComputerRuntime` contract
(`packages/computer-runtime/src/{types,provider,policy,redaction}.ts`) and owns every piece of
domain logic that touches authorization, consequential-action policy, approval, control ownership,
and RuntimeHandoff integration (`services/api/src/cp2/domains/computer-runtime/store.ts`). A
concrete browser-automation library is only ever an implementation detail behind
`ComputerRuntimeProvider`, reached exclusively through
`services/api/src/cp2/computer-worker-provider.ts`'s HTTP bridge to an isolated worker process
(`services/computer-worker`) that is the only place in the deployment allowed to load a browser
engine.

The shipped provider uses **Playwright** directly (Apache 2.0, MIT-compatible, already a
devDependency of this repository for its own E2E tests, no source copied), not a wrapping
framework. Element resolution uses Playwright's own accessibility-locator chain
(`getByRole`/`getByLabel`/`getByPlaceholder`/`getByText`), not a second model call - consistent
with the ownership decision below and with the task brief's explicit prohibition on the model
directly driving the browser.

## Why not depend on a browser-agent framework directly

1. **Domain-contract coupling.** Every reviewed framework's core abstraction _is_ its session/
   action/state model. Depending on one directly would mean Soko's tool registry, approval engine,
   and RuntimeHandoff checkpoints would either wrap that framework's types (leaking them into
   Soko's domain contracts, which the task brief explicitly forbids) or duplicate them (the second
   task-state system the task brief also forbids). Neither is acceptable; a thin, Soko-owned
   contract with the framework fully behind `ComputerRuntimeProvider` is the only shape that avoids
   both.
2. **Model/browser separation is not guaranteed by these frameworks' own architecture.** Several
   (Stagehand, Browser Use) are explicitly designed around an LLM call _inside_ the automation
   loop to decide what to click next, often on every step. Soko's own agent already proposes
   actions through `createRuntimeTurn`; adding a second, framework-internal model call the domain
   layer cannot inspect, authorize, or gate would create exactly the "agent bypasses approval
   through a generic click" risk the consequential-action policy exists to prevent (task brief §14).
3. **Approval/human-takeover semantics differ per framework and are usually absent.** None of the
   reviewed frameworks ship Soko's specific requirement: server-authoritative, replay-protected,
   hash-bound approval before a _specific_ consequential action, and an atomic agent/human
   control-mode handoff backed by the same immutable checkpoint chain every other Soko runtime
   transition uses. Building this once, in Soko's own domain, on top of a low-level driver
   (Playwright) is less code than adapting each framework's different approval/handoff primitive
   (if any) to Soko's.
4. **Replaceability.** The task brief requires the eventual ability to swap providers
   (`BrowserUseProvider`, `LocalCDPProvider`, `SokoBrowserProvider`, ...) without touching domain
   contracts. That is only possible if the contract is Soko's own from day one - adopting a
   framework's types as the contract would make every future provider swap a breaking change to
   the trusted interface, not an additive one.

## License review (task brief §24)

| Project                          | License                                                       | Verdict                                                                                                                                                                                                                                                                |
| -------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Playwright (shipped)             | Apache License 2.0                                            | Compatible; used as a direct dependency, no source copied.                                                                                                                                                                                                             |
| Stagehand                        | MIT (browserbase/stagehand, as of the versions reviewed)      | Compatible license; not adopted for the architectural reasons above, not a license blocker.                                                                                                                                                                            |
| Browser Use / Browser Use Web UI | MIT                                                           | Compatible license; not adopted for the architectural reasons above.                                                                                                                                                                                                   |
| Open Operator                    | MIT                                                           | Compatible license; reviewed only for its orchestration pattern, no code taken.                                                                                                                                                                                        |
| Skyvern                          | AGPL-3.0 (core)                                               | **Would require this repository to be licensed compatibly with AGPL's network-copyleft terms if its source were incorporated.** Not incorporated; reviewed only at a conceptual/architectural level (its workflow/step model), never as a dependency or copied source. |
| BrowserCode                      | Varies by fork/version at time of review; treat as unverified | Not adopted; no code or dependency taken.                                                                                                                                                                                                                              |

Soko's own `license` file is PolyForm Noncommercial 1.0.0. Permissive upstream licenses (Apache
2.0, MIT) are compatible with inclusion regardless of Soko's own license terms, since they impose
no reciprocal-licensing requirement on the including project. No AGPL or other copyleft-licensed
source was copied into this repository; see `THIRD_PARTY_NOTICES.md` for the full dependency
notice.

## Alternatives considered

- **Wrap Stagehand as the primary provider**, since it is the closest single-library match to the
  provider-adapter shape. Rejected for this initial vertical slice: Stagehand couples its own LLM
  call into element resolution (point 2 above), and depending on it as the _only_ shipped provider
  before the contract itself was proven would risk the contract quietly absorbing Stagehand-shaped
  assumptions. Playwright directly, with a deterministic locator-resolution strategy, proves the
  contract cleanly; a Stagehand-backed provider (`StagehandProvider`) remains addable later without
  changing `ComputerRuntimeProvider`, per the "Provider replacement" section of
  `docs/architecture/computer-runtime.md`.
- **A generic "computer_use" MCP tool exposed directly**, bypassing `createRuntimeTurn`. Rejected:
  every existing MCP tool in this repository routes through the same dispatcher every other surface
  uses (`docs/architecture/governed-tool-runtime.md`); a computer-use MCP tool that skipped policy/
  approval would be the exact "model bypasses approval" gap the task brief warns against.

## Consequences

- Soko can replace its browser-automation provider without touching `packages/tool-core`,
  `services/api/src/cp2/domains/computer-runtime`, `apps/web/src/ComputerSessionCard.tsx`, or any
  migration.
- The shipped provider (Playwright + deterministic locator resolution) is less robust on visually
  complex pages than a vision-based resolver would be; this is a known, documented limitation
  (`docs/architecture/computer-runtime.md` "Not yet built"), not a silent gap.
- Every future addition to `computer.*` capabilities, or a new provider, must keep the model on
  the authorized side of `ComputerRuntimeDomain` - no route may let a proposed action reach a
  provider without authorization, policy classification, and (for `CONSEQUENTIAL` actions)
  approval.

## Security implications

See `docs/architecture/computer-runtime-security.md` for the full threat model. This decision's
main security consequence is structural: because the contract is Soko's own, every
policy/approval/control-mode/credential-isolation guarantee documented there is enforced in one
place (`ComputerRuntimeDomain`) regardless of which provider is active - a provider swap cannot
accidentally remove a security guarantee, since providers never see unauthorized or unapproved
calls in the first place.

## Migration impact

Additive only. New package (`@soko/computer-runtime`), new service (`@soko/computer-worker`), new
CP2 domain, new migration (`089_computer_runtime.sql`), new `RuntimeToolName` entries, new
`ConversationMessageContent`/`RuntimeContextReferenceKind` variants, new Render service. No
existing table, route, or domain contract changed shape.
