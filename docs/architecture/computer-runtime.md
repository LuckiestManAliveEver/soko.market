# Computer runtime

`ComputerRuntime` is Soko's computer-use (browser-automation) execution capability: the agent can
open an isolated browser session, navigate, observe, click, type, scroll, and upload files on an
external website, while the user watches a live view, can take control at any time, and must
explicitly approve any consequential action. See `docs/architecture/computer-runtime-audit.md` for
the pre-implementation audit this design is built on, and
`docs/architecture/computer-runtime-security.md` for the full threat model.

## Architecture

```text
Soko Chat / MCP
      |
      v
createRuntimeTurn (existing, unchanged)          services/api/src/cp2/domains/agent-runtime/store.ts
      |  context -> policy -> confirmation
      v
executeRuntimeCapability (existing dispatcher)    .../agent-runtime/capabilities.ts
      |
      +-- commerce.*, product.*, ... (unchanged)
      |
      +-- computer.* --> executeComputerCapability  .../agent-runtime/computer-capabilities.ts
                                |
                                v
                      ComputerRuntimeDomain          .../cp2/domains/computer-runtime/store.ts
                        - authorization (business/account scoped)
                        - control-mode enforcement (agent vs. human)
                        - ComputerActionPolicy (READ/MUTATE/CONSEQUENTIAL/BLOCKED)
                        - approval creation/decision, RuntimeHandoff checkpointing
                                |
                                v
                      ComputerRuntimeProvider        packages/computer-runtime/src/provider.ts
                        (provider-neutral interface; no Stagehand/Playwright/Browserbase types)
                                |
                                v
                      RemoteComputerWorkerProvider    services/api/src/cp2/computer-worker-provider.ts
                        (HTTP + bulkhead + circuit breaker + retry, mirrors ocr-provider.ts)
                                |
                                v  (private network only)
                      services/computer-worker         isolated process/container
                        (Playwright + Chromium; the ONLY place a browser engine loads)
```

This is "everything is a capability" (task brief, `capability-first-runtime.md`) applied to
computer use: `computer.*` are ordinary `RuntimeToolName` entries in the single canonical
`runtimeToolRegistry`, dispatched by the single canonical `executeRuntimeCapability` switch, under
the same authorization/confirmation gate every other capability uses. There is no second router,
no second task-state system, and no new abstraction competing with `RuntimeHandoff` - see
`docs/adr/ADR-computer-runtime-ownership.md` for why Soko owns this contract instead of depending
on a browser-agent framework directly.

## Capabilities

| Tool name                  | Class (static registry) | requiresConfirmation | Notes                                                                            |
| -------------------------- | ----------------------- | -------------------- | -------------------------------------------------------------------------------- |
| `computer.session.create`  | medium                  | false                | Requires an active conversation; posts the live-view card                        |
| `computer.session.resume`  | low                     | false                |                                                                                  |
| `computer.navigate`        | low, readOnly           | false                | Navigation-policy checked (domain allow/block, SSRF)                             |
| `computer.observe`         | low, readOnly           | false                |                                                                                  |
| `computer.click`           | medium                  | false*               | *dynamically CONSEQUENTIAL for a submit/buy/delete/send-like target - see Policy |
| `computer.type`            | medium                  | false                | Refused outright for password/OTP/card-number-shaped fields                      |
| `computer.scroll`          | low, readOnly           | false                |                                                                                  |
| `computer.upload`          | medium                  | false*               | Content resolved from an already-authorized conversation attachment              |
| `computer.control.take`    | low                     | false                | Human-initiated; also a direct REST route                                        |
| `computer.control.release` | low                     | false                | Human-initiated; also a direct REST route                                        |
| `computer.checkpoint`      | low, readOnly           | false                |                                                                                  |
| `computer.suspend`         | low                     | false                |                                                                                  |
| `computer.close`           | low                     | false                |                                                                                  |

Registered in `packages/tool-core/src/domains/computer.ts`, composed into
`packages/tool-core/src/registry/index.ts` exactly like every other domain. Every entry is
`mcpExposable: false`, matching every other tool in the registry today.

### Why `requiresConfirmation` is `false` on every entry

The existing `requiresConfirmation` mechanism is a static, per-tool-name property, evaluated
_before_ dispatch. Whether one `computer.click` call is consequential depends on what it targets
("Search" vs. "Place order"), not which generic tool name carried it - a static flag can't express
that. Instead, `ComputerActionPolicy` (`packages/computer-runtime/src/policy.ts`,
`classifyComputerAction`) classifies each _specific_ proposed click/type/upload call, using the
target's description and the last observation's accessibility data - never trusting the agent's
own claimed intent alone. A `CONSEQUENTIAL` classification creates a `ComputerApproval` row and
returns `AWAITING_APPROVAL` without executing; approval/rejection happens through a dedicated REST
route (`POST .../computer/approvals/:id/approve|reject`), not the chat confirmation-token
round-trip, because the exact action was already captured server-side at proposal time - there is
nothing for the approve call to "replay toward a different action."

## RuntimeHandoff integration

Every `computer.session.create` call requires an active conversation (`taskId` = conversation id,
same as everywhere else in this codebase - see `docs/runtime/runtime-handoff.md`). The domain calls
the _existing_ `RuntimeHandoffDomain.createCheckpoint` (via an injected `checkpointTask` closure,
`Cp2Store`'s constructor) whenever a session reaches an approval-required pause or control changes
hands, producing a real, immutable `cp2_runtime_handoffs` row referenced from
`relevantContext: [{ kind: "computer_session", refId: <sessionId>, ... }]` (a new, additive
`RuntimeContextReferenceKind`). No new checkpoint table, no changes to `RuntimeHandoffDomain`
internals, no changes to the per-turn auto-checkpoint path - this is the same public
`createCheckpoint` API every other caller uses, called with `promote: false` so it never contends
with the task's canonical checkpoint version.

## Control ownership

`ComputerSession.controlMode` is `AGENT | HUMAN | SUSPENDED`, stored on the session row and flipped
atomically (one synchronous map write) by `takeControl`/`releaseControl`. Every agent-driven action
re-checks `controlMode === "AGENT"` twice: once before calling the provider, once after the
provider call's `await` resolves - a human can take control while an agent action is in flight, and
the second check discards that action's result (`status: "REJECTED"`) instead of overwriting
human-driven browser state. `releaseControl` fetches a fresh observation and checkpoints before
handing control back to the agent (task brief §7/§11).

## Persistent profiles

`ComputerProfile` (`cp2_computer_profiles`, account-scoped, encrypted `storageState`) is separate
from `ComputerSession` (business-scoped, per-task). A profile is created by
`saveSessionAsProfile`: the user takes control of a session, logs in by hand, and the session's
provider-captured storage state (`ComputerRuntimeProvider.checkpoint`) is encrypted with the same
`encryptOAuthToken`/`decryptOAuthToken` helpers `services/api/src/cp2/oauth.ts` already provides
and stored. The model never sees this material; only the domain decrypts it, and only to hand it
to the isolated worker over the private network when a session starts.

## Live browser surface

`packages/shared-types` gained one additive `ConversationMessageContent` variant,
`{ type: "computer-session", businessId, computerSessionId }`, posted as a `system`-authored
conversation message when a session is created. `apps/web/src/generated-surface-registry.tsx`
(the existing "generated-surface" protocol, see `docs/frontend/frontend.md`) renders it via
`apps/web/src/ComputerSessionCard.tsx` - zero changes to `ChatSurface.tsx`. The card polls
`GET /businesses/:businessId/computer/sessions/:id` (2s while the agent is driving, 8s otherwise)
for the latest sanitized screenshot/URL/status/control-mode/pending-approval, and posts to the
direct REST routes for take/release control, approve/reject, and stop. The live view is a polled
JPEG screenshot, not a WebRTC/CDP video stream - a deliberate, simpler MVP choice (see
"Not yet built" below).

## Deployment

`services/computer-worker` is the only process that loads a browser engine (Playwright + Chromium).
It never runs inside the main API process and is never given a public route:
`render.yaml`'s `soko-market-computer-worker` is a private `pserv` Docker service, reached by
`services/api` only over Render's private network (`COMPUTER_WORKER_URL`, wired the same way
`soko-market-ocr-worker`/`OCR_WORKER_URL` already is). `services/api/src/cp2/computer-worker-provider.ts`
is the only file in `services/api` that talks to it, over plain HTTP with a bulkhead + circuit
breaker + bounded retry (mirrors `ocr-provider.ts` exactly). `services/api/package.json` has no
Playwright/browser-automation dependency - see `docs/architecture/computer-runtime-audit.md` §3.

Environment variables (main API service): `COMPUTER_WORKER_URL` (Render `fromService`/`hostport`,
falls back to `http://127.0.0.1:8091` in local dev if unset via the code default, not an env
default), `COMPUTER_WORKER_CONCURRENCY` (default 8), `COMPUTER_WORKER_TIMEOUT_MS` (default 45000).
Worker service: `COMPUTER_WORKER_PORT` (default 8091), `COMPUTER_WORKER_HOST` (default `0.0.0.0`),
optional `PLAYWRIGHT_CHROMIUM_PATH` override for non-standard Chromium install locations.

## Provider replacement

Nothing outside `packages/computer-runtime/src/provider.ts` and
`services/api/src/cp2/computer-worker-provider.ts` may name a concrete browser-automation
implementation. To replace Playwright with another engine (Stagehand, Browser Use, a future
Soko-native driver): implement `ComputerRuntimeProvider`, wire it in via `Cp2StoreOptions.computerRuntimeProvider`
(tests already do this - see `tests/computer-runtime-domain.test.ts`) or a new
`create<X>ProviderFromEnvironment()` function mirroring `createComputerWorkerProviderFromEnvironment`.
No change to `ComputerRuntimeDomain`, the tool registry, or any route is required.

## Not yet built (honest scope boundary)

- **Live view is polled screenshots, not a video/WebRTC stream.** A real CDP screencast or WebRTC
  relay would reduce latency and bandwidth; the current polling approach is simpler, has no new
  infrastructure, and was sufficient to satisfy the completion criteria (§28 of the task brief)
  with real, working code end-to-end. Swapping it for a stream is additive to the same provider
  contract (a `ComputerRuntimeProvider` could add a `streamUrl` to `ComputerObservation`).
- **Element resolution is deterministic (Playwright accessibility locators), not a second model
  call.** The task brief is explicit that the model must never drive Chromium directly; adding an
  LLM call inside the worker to resolve "click the send button" would be exactly that by another
  name. This is a real, functioning, swappable strategy - not a stub - but it is less robust than
  a vision-based resolver on visually complex pages. `ComputerRuntimeProvider`'s adapter boundary
  is exactly where a smarter resolver would go later.
- **`computer.session.resume` on a suspended worker-side session re-creates the browser context
  from the last checkpoint's storage state**, not a literally-paused OS process - Playwright has no
  "freeze in place" primitive; this is the same trade every serverless/scale-to-zero browser
  automation service makes.
