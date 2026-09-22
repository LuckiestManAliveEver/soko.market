# Computer runtime audit

Audit performed before implementing a `ComputerRuntime` (browser/computer-use) capability, per
this repository's standing rule (see `docs/architecture/durable-execution-audit.md` for the prior
audit of this shape): read the actual code before adding an abstraction, and reuse what already
exists under its repository-native name instead of building a parallel system.

## 1. What already exists

Soko already has almost every structural piece this task asks for, built independently and named
according to this repository's own conventions rather than the task brief's vocabulary:

| Task brief's term                         | Repository's actual name                                                                                                                      | Where                                                                                                            |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Capability Router                         | `runtimeToolRegistry` (metadata) + `createRuntimeTurn` → policy/confirmation → `executeRuntimeCapability` (dispatch)                          | `packages/tool-core/src/registry/index.ts`, `services/api/src/cp2/domains/agent-runtime/{store,capabilities}.ts` |
| RuntimeHandoff                            | `RuntimeHandoff` (immutable checkpoint) + `cp2_runtime_task_heads`/`cp2_runtime_task_instances`                                               | `services/api/src/cp2/domains/runtime-handoff/{store,routes}.ts`, migrations 083-085                             |
| Execution hosts                           | `cp2_native_execution_hosts` / `NativeRuntimeBindingStore`'s `hosts` map (`type`, capabilities)                                               | `services/api/src/cp2/domains/native-runtime/store.ts`                                                           |
| Agent/model bindings                      | `cp2_native_runtime_bindings` / `cp2_native_runtime_binding_models`                                                                           | same file                                                                                                        |
| Approval / confirmation                   | `requiresConfirmation` on `RuntimeToolDefinition` + `confirmationToken` round-trip through `createRuntimeTurn`                                | `packages/tool-core/src/contracts/runtime.ts`, `agent-runtime/store.ts` `confirmRuntimeAction`                   |
| Human takeover / transfer of authority    | `cp2_runtime_transfers` (state machine `PENDING → ... → COMPLETED/FAILED`)                                                                    | migration `085_runtime_transfers.sql`, `runtime-handoff/store.ts`                                                |
| Idempotency                               | `cp2_runtime_operation_dedup`                                                                                                                 | `runtime-handoff/store.ts`                                                                                       |
| Durable execution/audit log               | `cp2_runtime_execution_events` (append-only, sequence-numbered, typed taxonomy)                                                               | migration `087_runtime_execution_events.sql`                                                                     |
| Fencing (stale-execution rejection)       | `RuntimeTaskInstance.fenceToken`/`executionId`, checked in `checkpointAfterTurn`                                                              | `runtime-handoff/store.ts`                                                                                       |
| Secret encryption at rest                 | `encryptOAuthToken`/`decryptOAuthToken` (AES-256-GCM), already reused outside OAuth by `external-connections`                                 | `services/api/src/cp2/oauth.ts`                                                                                  |
| Persistent third-party profile/connection | `ExternalConnectionRecord` (encrypted token, status, connect/disconnect)                                                                      | `services/api/src/cp2/domains/external-connections/{store,shared,routes}.ts`                                     |
| Isolated worker process                   | Self-hosted worker + `pserv` Render Blueprint service, reached over HTTP with bulkhead/circuit-breaker/retry                                  | `services/receipt-ocr-service/`, `services/api/src/cp2/ocr-provider.ts`, `render.yaml`                           |
| Chat "card" surface for tool results      | Flat `*Card.tsx` components, one per domain, composed in `ChatSurface.tsx`/`ContextualBusinessCards.tsx`                                      | `apps/web/src/*Card.tsx`                                                                                         |
| Metrics                                   | Closed `Metrics` interface (`prom-client`-backed), one method per concern, no generic registration escape hatch                               | `packages/observability/src/index.ts`                                                                            |
| Prompt-injection boundary                 | Untrusted-context sanitization ahead of the tool dispatcher (`createRuntimeTurn`'s context/grounding pipeline, `context-semantic-runtime.md`) | `agent-runtime/store.ts`                                                                                         |
| MCP surface                               | `soko.runtime_turn`/`soko.confirm_runtime_action` call the same `store.createRuntimeTurn`; no tool bypasses it                                | `services/api/src/mcp/routes.ts`                                                                                 |

This means the target architecture in the task brief (`Chat → Agent Runtime → Capability Router →
Execution Target → RuntimeHandoff → Result`) is **already the repository's architecture**, not
something to build from scratch. "Computer use becomes another execution capability" is achieved
by adding `computer.*` entries to the existing registry/dispatcher, not by building a new router.

## 2. Exact integration points

- **Tool contract**: `RuntimeToolName` (`packages/tool-core/src/contracts/runtime.ts`) is a closed
  string union; every composition site (`runtimeToolRegistry: Record<RuntimeToolName, ...>` in
  `packages/tool-core/src/registry/index.ts`) is therefore compiler-checked for exhaustiveness.
  Adding `computer.*` names here is additive and gets that exhaustiveness check for free.
- **Domain metadata module**: one file per domain under `packages/tool-core/src/domains/*.ts`
  (e.g. `commerce.ts`), each exporting `Partial<Record<RuntimeToolName, RuntimeToolDefinition>>`
  with `risk`, `requiresConfirmation`, `readOnly`, `requiredPermission`, `inputSchema`,
  `mcpExposable`. A new `computer.ts` module follows this exactly.
- **Dispatch**: `executeRuntimeCapability` in
  `services/api/src/cp2/domains/agent-runtime/capabilities.ts` is a single `switch` over
  `input.action.toolName` that delegates to one function per domain (e.g.
  `executeCommerceCapability`, `executeReceiptCapability`). A new `executeComputerCapability`
  function, added as new `case` arms here, is the only change this file needs. This switch is
  **not** compiler-exhaustive on its own (no `default: assertNever`), so every new `computer.*`
  name must get an explicit case — verified by a new registry/dispatch-coverage test (see §6).
- **Authorization/confirmation/policy**: already enforced entirely inside `createRuntimeTurn`
  before dispatch (`enforceAgentPolicy`, role/permission check, `requiresConfirmation` →
  `confirmationToken` round trip). A new domain gets this for free by registering
  `requiresConfirmation: true` on consequential tool names — no new approval engine is needed, only
  a _classification_ layer (READ/MUTATE/CONSEQUENTIAL) that decides which `computer.*` calls are
  registered with `requiresConfirmation: true`, and — because the same generic action (e.g.
  "click") can be innocuous or consequential depending on target/context — a per-call, in-domain
  policy check inside the new domain's own store that can force confirmation even when the
  generic tool metadata alone would not (see §5, "architectural conflict").
- **State/persistence**: one CP2 domain module (`services/api/src/cp2/domains/computer-runtime/`)
  following the `runtime-handoff` domain's shape (`store.ts` owns validated mutation + the
  in-memory/Postgres-snapshotted CP2 table rows, `routes.ts` owns the Fastify routes, composed into
  `Cp2Store` the same way every existing domain is). No sibling domain private-store deep import is
  permitted (`scripts/check-boundaries.mjs`), so computer-runtime must expose its API the same way
  `runtime-handoff`/`agent-runtime` do (an explicit injected dependency surface, not a raw import).
- **RuntimeHandoff extension**: the checkpoint's `record` JSONB column has already been extended
  additively twice without an `ALTER TABLE` (fenceToken/executionId for durable execution,
  `runtime.resumable`/`runtime.portable`/`context.recipe` for MUSE). The same pattern — new
  optional fields inside the existing JSON envelope — is the correct way to add
  `executionTarget: "browser-computer"`, `computerSessionId`, `controlMode`, `pendingApproval`.
  **Not** a new ALTER TABLE, **not** a new checkpoint table.
- **Isolation of the actual browser process**: `services/api` (Render) is already a proven "control
  plane only" host — `scripts/check-render-inference-boundaries.mjs` fails CI if Render code
  depends on a local model-execution engine or the Render Blueprint reintroduces
  model execution on Render. `render.yaml` already deploys exactly one such isolated worker
  (`soko-market-ocr-worker`, a private `pserv` Docker service, reached only over Render's private
  network via `fromService...property: hostport`, fronted in `services/api` by a
  bulkhead+circuit-breaker+retry HTTP bridge — `services/api/src/cp2/ocr-provider.ts`). This is the
  exact isolation shape section 25 of the task brief asks for; a new `soko-market-browser-worker`
  `pserv` service plus a `services/browser-worker` Docker image, bridged the same way, satisfies it
  without inventing a new deployment pattern.
- **Persistent profile storage**: `external-connections` domain
  (`services/api/src/cp2/domains/external-connections/{store,shared,routes}.ts`) is the closest
  existing analog to "browser profile": per-account encrypted token, `ExternalConnectionRecord`
  never leaves the domain except through a view that strips the secret, `encryptOAuthToken`/
  `decryptOAuthToken` reused rather than a new crypto primitive. `ComputerProfile` (encrypted
  cookie/storage-state blob instead of a single token, but the same shape) follows this template.

## 3. Architectural conflicts / risks found

1. **The dispatcher `switch` is not compiler-exhaustive.** Unlike the registry composition object,
   forgetting a `case` for a new `computer.*` tool name silently falls through to `undefined`
   rather than a build error. Mitigated with an explicit unit test asserting every
   `RuntimeToolName` starting with `computer.` has a dispatch case (§6), since a `default: never`
   guard cannot be added without touching every existing case in a file this task should not need
   to rewrite wholesale.
2. **"Requires confirmation" is currently a static, per-tool-name property.** The task's
   consequential-action policy needs to be _contextual_ (the same `computer.click` can be
   read-only or can submit a purchase, depending on what was clicked). The existing mechanism
   (`RuntimeToolDefinition.requiresConfirmation`) cannot express that alone. Resolution: register
   `computer.click`/`computer.type`/etc. as `requiresConfirmation: false` at the generic-tool-name
   level (matching how e.g. `product.update` is unconditionally not required), and add a
   **second, additive** gate inside the computer-runtime domain itself — a `ComputerActionPolicy`
   that inspects the _specific proposed action_ (semantic intent + target + page context) before
   the action reaches the provider, and when it classifies as `CONSEQUENTIAL`, creates a checkpoint
   and returns an explicit `AWAITING_APPROVAL` status instead of executing, mirroring — but not
   duplicating — the existing `confirmationToken` shape used by `commerce.checkout`. This is scoped
   entirely inside the new domain; it does not change `createRuntimeTurn`'s policy gate.
3. **`cp2_runtime_transfers` is scoped to native-runtime-host swaps** (source/target
   `cp2_native_execution_hosts`, receipts that assert agent/model/harness identity). It is the
   wrong primitive for "human takes the mouse from the agent inside one already-active browser
   session" — that is a same-host control-mode flip, not a host migration, and forcing it through
   the transfer table would require fabricating a fake target host and receipt shape that transfer
   validation does not otherwise need. Resolution: control-mode (`AGENT_CONTROLLED` /
   `HUMAN_CONTROLLED` / `SUSPENDED`) is new, small state owned by the computer-runtime domain and
   the RuntimeHandoff checkpoint's `record` JSON, not `cp2_runtime_transfers`. The existing
   immutable-checkpoint mechanism _is_ reused for the "checkpoint" step of both the approval flow
   and the takeover flow (§7/§11 of the task brief), since checkpointing before a control or
   authority change is exactly what `RuntimeHandoff` already exists to do.
4. **`Metrics` (packages/observability) has no generic counter-registration API** — every metric is
   hand-declared in `createMetrics()`. New `computer_*` metrics must be added there as first-class
   named methods, not through a generic escape hatch (consistent with the file's existing style,
   but it does mean touching a shared file rather than a domain-owned one).
5. **`services/api/package.json` must never gain a Playwright/Chromium/browser-automation runtime
   dependency.** No boundary script currently blocks this (unlike the LLM-engine blocklist in
   `check-render-inference-boundaries.mjs`), because until now nothing needed one. This audit
   extends that script's spirit: the browser worker's provider client in `services/api` talks to
   the isolated worker only over HTTP, exactly like `ocr-provider.ts`; Chromium/Playwright are
   dependencies of the new `services/browser-worker` package only.

## 4. Missing components (confirmed absent, not assumed)

Repo-wide search for `browser|playwright|stagehand|browserbase|browser-use|chromium|puppeteer|cdp`
across every non-`node_modules` file found only: Playwright as an **existing devDependency used
exclusively for `e2e/*.spec.ts` UI tests** (`playwright.config.ts`), which drives Soko's own web
app for end-to-end testing — completely unrelated to, and not reusable as, a computer-use
execution provider. No Stagehand, Browser Use, Browserbase, Skyvern, Open Operator, or BrowserCode
code or dependency exists anywhere in the repository. Nothing here needed to be removed or
disambiguated from a prior implementation.

Confirmed missing (must be built):

- Any `ComputerRuntime`/`ComputerSession`/`ComputerObservation` domain type.
- Any browser-session persistence (`computer_sessions`, `computer_profiles`).
- Any browser automation provider/worker.
- Any computer-use tool registry entries or dispatcher cases.
- Any consequential-action policy classifier for browser actions.
- Any live-view browser UI surface in `apps/web`.
- Any browser-worker deployment topology in `render.yaml`.

## 5. Proposed integration points (summary)

| New piece                                           | Lives in                                                                                            | Reuses                                                                                                            |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `ComputerRuntime` contract (provider-neutral types) | `packages/computer-runtime/src` (new package)                                                       | none — pure types/policy, mirrors `packages/tool-core`'s contract-first style                                     |
| `computer.*` `RuntimeToolName`s + registry metadata | `packages/tool-core/src/contracts/runtime.ts`, `packages/tool-core/src/domains/computer.ts`         | existing registry composition                                                                                     |
| Dispatch                                            | `services/api/src/cp2/domains/agent-runtime/computer-capabilities.ts`, wired into `capabilities.ts` | existing `executeRuntimeCapability` switch pattern                                                                |
| Session/profile/approval state                      | `services/api/src/cp2/domains/computer-runtime/{store,routes}.ts`                                   | CP2 domain conventions, `encryptOAuthToken`/`decryptOAuthToken`                                                   |
| RuntimeHandoff extension                            | additive fields on the existing checkpoint `record` JSON                                            | `runtime-handoff` domain, no new table                                                                            |
| Browser execution                                   | new `services/browser-worker` (Playwright + Chromium), isolated `pserv` in `render.yaml`            | `services/receipt-ocr-service`'s deployment shape, `ocr-provider.ts`'s bulkhead/circuit-breaker/retry HTTP bridge |
| Migrations                                          | `infra/db/migrations/089_*.sql` onward                                                              | existing `cp2_*` generic-entity table shape (`entity_id`, `record jsonb`, generated columns, rollback file)       |
| Frontend live browser card                          | `apps/web/src/ComputerSessionCard.tsx` + wiring through `ChatSurface.tsx`/`useChatRuntimeState.ts`  | existing `*Card.tsx` pattern                                                                                      |
| Metrics                                             | new methods on `packages/observability/src/index.ts`'s `Metrics`                                    | existing histogram/counter/gauge style                                                                            |

## 6. Migration requirements

Next available migration number is `089` (last is `088_runtime_experiences.sql`). New tables
follow the established generic-entity shape (`entity_id text primary key`, `record jsonb not null`,
generated/stored columns for indexed fields, `foreign key` references to owning entities,
`create table if not exists` for idempotent re-apply, a matching file under
`infra/db/rollbacks/`). Planned tables: `cp2_computer_sessions`, `cp2_computer_profiles`,
`cp2_computer_action_audit`. No `ALTER TABLE` on any existing table — RuntimeHandoff/task-instance
extensions are additive JSON fields inside `record`, exactly like migrations 087/088.

## 7. Security implications

- The model must never see `ComputerProfile`'s encrypted cookie/storage-state blob or any
  decrypted credential — only the domain's server-side store ever calls `decryptOAuthToken` on it,
  and only to hand the _decrypted_ material to the isolated browser worker over the private
  network, never back into a model prompt or a chat response.
- Browser observations (DOM text/screenshots) returned to the agent's context must be treated as
  **untrusted web content**, subject to the same instruction-precedence/sanitization boundary
  `context-semantic-runtime.md` already establishes ahead of the tool dispatcher — extended, not
  duplicated, for this new untrusted-content source.
  is required.
- SSRF/navigation-policy enforcement must happen in the isolated browser worker (which is the
  network-adjacent process) and be re-validated in the computer-runtime domain before any
  `navigate` call is forwarded, so a compromised worker response cannot be the only line of
  defense.
- Every mutating/consequential action must carry an idempotency key through to the worker,
  matching the existing `commerce.checkout`/`messaging.send` pattern, so a retried or duplicated
  approval can never execute twice.

## 8. Corrections/additions from a full-repo second pass

A second, independent pass (full-text read of the agent runtime loop, `RuntimeHandoff` types,
frontend card wiring, MCP routes, auth, event log, encryption, metrics, and test conventions)
confirmed everything above and added the following precision:

- **Frontend card hook is `generated-surface-registry.tsx`, not `ContextualBusinessCards.tsx`.**
  `apps/web/src/generated-surface-registry.tsx` exports `generatedSurfaceRegistry`, a
  `Partial<Record<ConversationMessageContent["type"], GeneratedSurfaceRenderer>>` keyed by a typed
  `ConversationMessageContent` variant (defined in `packages/shared-types`) and looked up per
  message; an unrecognized type renders `null` and falls back to plain text. Adding the live
  computer-session card is: one new `ConversationMessageContent` variant, one registry entry, one
  new `*Card.tsx` — **zero changes to `ChatSurface.tsx`**. `ContextualBusinessCards.tsx` is an
  older, unrelated home-screen quick-links pattern.
- **Execution host table is `cp2_native_execution_hosts`, migration `063_native_runtime_bindings.sql`**
  (not something inferred only from `native-runtime/store.ts`'s in-memory `hosts` map, which is
  that table's runtime projection). A computer-use worker is registered as one more
  `cp2_native_execution_hosts` row/type, following the same graph `agentId`/`modelId` resolution
  already uses for hosted-vs-local execution-host choice — no parallel host registry.
- **A prior "Execution Fabric" abstraction existed and was explicitly retired**
  (`060_execution_fabric_entities.sql` → `065_retire_execution_fabric.sql`,
  `docs/architecture/soko-execution-fabric-audit.md`), and `scripts/check-retired-runtime-references.mjs`
  fails CI if it's referenced again. This is independent confirmation of task brief rule #27 ("do
  not create a second task-state system") — the repository already paid the cost of violating it
  once and built a static guard against repeating it.
- **Name collision: "browser" already means something else.** `apps/web/src/webllm-runtime.ts`,
  `docs/architecture/browser-inference.md`, and `isLocalRuntimeHost`'s `"browser"`/`"browser-local"`
  execution-host types all refer to **running the chat model's own inference client-side via
  WebGPU/WebLLM** — unrelated to driving an external website. To avoid ambiguity in code, docs, and
  audit events, this implementation uses **"computer"** vocabulary throughout
  (`ComputerRuntime`, `computer.*` tools, `cp2_computer_sessions`, `COMPUTER_WORKER_URL`, a
  `soko-market-computer-worker` Render service) and never "browser runtime" or "browser worker".
- **Audit logging has no dedicated table family.** `packages/event-core` supplies only the
  `BusinessEvent`/`createEvent()` type and freezing helper; the actual store is a flat, in-process
  `Cp2Store.auditEvents: BusinessEvent[]` array (persisted through the same Postgres snapshot writer
  as every other CP2 collection), appended to via each domain's injected `recordAuditEvent`
  closure. Computer-runtime audit trail (task section 17) is satisfied by emitting `BusinessEvent`s
  through this exact mechanism — not a new `cp2_computer_action_audit` table — with a dedicated
  `cp2_computer_approvals` table reserved only for what genuinely needs independent, queryable,
  replay-protected persistence (approval binding/hash/at-most-once state), mirroring why
  `cp2_runtime_transfers` is separate from the audit log but `runtime.handoff_*` events are not.
- **`AUTH_TOKEN_ENCRYPTION_KEY`/`OAUTH_TOKEN_ENCRYPTION_KEY` (`services/api/src/cp2/oauth.ts`
  `getTokenEncryptionKey()`) throws in production if unconfigured** and only falls back to a
  hardcoded local-dev string outside production. `ComputerProfile` credential material reuses this
  exact key/function; no new secret needs provisioning.
- **Tests are flat `tests/*.test.ts` files run by Vitest** (`pnpm test` → `vitest run`), not nested
  by feature; only one file currently lives under `tests/integration/`. New computer-runtime tests
  follow the flat convention (e.g. `tests/computer-runtime-domain.test.ts`,
  `tests/computer-runtime-security.test.ts`), matching `tests/runtime-handoff-protocol.test.ts`'s
  style of driving the domain directly and/or through `app.inject`.

This audit is the basis for the implementation that follows; see
`docs/architecture/computer-runtime.md` for the resulting design and
`docs/architecture/computer-runtime-security.md` for the full threat model.
