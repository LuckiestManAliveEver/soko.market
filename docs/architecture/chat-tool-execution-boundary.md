# Chat tool-execution boundary

This document exists because the two chat pipelines and three model-selection layers in this
repository are each individually documented, but the boundary _between_ them — which one can
actually execute a business action, and why the other cannot even if a user asks it to — was not
written down anywhere. It complements, not replaces:

- [`docs/model-activation-runtime.md`](../model-activation-runtime.md) — the server-side
  test/verify/activate API for `cp2_agent_model_bindings`.
- [`docs/architecture/client-first-inference.md`](client-first-inference.md) — provider routing,
  fallback order, and browser download mechanics.

## Two pipelines, not one

|                                | Server-mediated chat                                                           | Browser-local chat                                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Entry point                    | `POST /businesses/:id/runtime/turns` (`Cp2Store.createRuntimeTurn`)            | `generateBrowserAgentResponse` (`apps/web/src/browser-inference-session.ts`)                                                       |
| Runs on                        | The API server, using the shop's activated model binding                       | Entirely in the browser tab, using a downloaded on-device model                                                                    |
| Output shape                   | `RuntimeModelOutputParseResult`: `"response"` \| `"clarification"` \| `"tool"` | `BrowserGenerationResult`: `{ text: string, ... }` — no tool field exists                                                          |
| Can execute a business action? | Yes, after `enforceAgentPolicy` and confirmation gating                        | **No** — there is no code path from a browser-local result into `executeRuntimeAction`; the type itself has no tool-proposal field |
| Authorization                  | `requireAuthorizedSession`, tenant/role checks, per-tool policy                | None needed for execution, because none is possible; the result is just text rendered in the chat UI                               |

A model-proposed tool call is never trusted on its own anywhere in this system — see
`docs/agent-context-instructions-personality.md` and the runtime-turn pipeline
(`services/api/src/cp2/agent-business-runtime.ts`, `enforceAgentPolicy`) for the full
policy/confirmation chain. The browser-local pipeline takes this one step further: it is
_structurally_ incapable of proposing a tool at all, not merely policy-blocked from executing one.

## How a message gets routed between them

`decideInferenceRoute` (`apps/web/src/browser-inference-routing.ts`) decides per message, before
any inference runs:

```
requiresServerTool(message)   → route: "server" (or "native" if a bridge is ready)
complexReasoning / tab hidden → route: "server"
device unsupported            → route: "server"
prompt exceeds context window → route: "server"
model not loaded/ready        → route: "server"
otherwise                     → route: "browser-local"
```

`requestRequiresServerTool` is a keyword heuristic (`create|add|delete|remove|update|change|refund
|pay|send|invite|sync|order|receipt`, case-insensitive). It is a _routing convenience_, not the
safety boundary — it exists so obviously-actionable requests skip straight to the pipeline that can
actually do something, saving a round trip. The actual safety boundary is the structural one above:
even a message that slips past this heuristic and reaches the on-device model can only ever produce
`{ text }`. The realistic residual risk of a heuristic miss is the on-device model **hallucinating**
a reply that claims an action happened ("I've added the product for you") when nothing did — a
trust/UX problem to watch for in prompt design and user messaging, not a security hole.

## The three model-selection layers

Reading the code in isolation, `cp2_agent_model_bindings`, `agentModelAssignments`, and
`activeAiModels` look like three overlapping ways to pick a model. They are not — each has a
distinct, non-overlapping job, enforced by the actual UI flow
(`apps/web/src/SokoApplication.tsx`), not just by convention:

1. **`cp2_agent_model_bindings`** (`AgentModelBindingSummary`) — the canonical binding for
   _server-side_ execution targets (backend/Ollama, OpenAI, installed-app native bridge,
   remote-shop-device). Set only via `POST /api/agents/:agentId/models/:modelId/activate`, which
   re-runs a real inference health check before flipping the binding to `active`
   (`store.ts:3492`, `requireModelRuntimeAdapter(...).healthCheck(...)`). This is what
   `Cp2Store.resolveActiveRuntimeModelId` checks first when a runtime turn needs a model.
2. **`agentModelAssignments`** (`PUT /businesses/:id/agent-model`, `assignAgentModel`) — tracks
   whether a _device-local_ model (browser-downloaded or installed-app) has actually completed a
   real inference successfully. The frontend gate that matters:
   `agentModelAssignment.lastSuccessfulInferenceAt !== null && runtimeBackend !== "CLOUD"`
   (`SokoApplication.tsx:13195`) — a device model is not considered "ready" until it has proven
   itself with a real completion, mirroring the health-check discipline of layer 1 at the device
   level.
3. **`activeAiModels`** (`PUT /businesses/:id/ai-model`, `activateAiModel`) — the **cloud fallback**
   selector only. The UI explicitly blocks setting a cloud fallback model until layer 2 reports a
   ready local model (`SokoApplication.tsx:13197-13202`, `"Download, connect, and test a GGUF model
before selecting an OpenAI fallback."`). It is never the primary model source; it is only
   consulted by `resolveActiveRuntimeModelId` as a last-resort model ID when no verified binding
   (layer 1) exists.

None of the three is reachable without a prior real-inference success gate somewhere in its own
layer. There is no path to "chat is running on a model that was never confirmed to work."

## Verification

- Server-side auto-install and its own fail-fast gate:
  `services/ai-runtime/scripts/start-inference.sh`, `services/ai-runtime/scripts/model-admin.mjs`.
- Browser download, license gate, GGUF signature check:
  `apps/web/src/ai-model-manager.ts` (`downloadCatalogModel`, `importCustomGgufModel`).
- Verified server-side activation: `tests/model-activation-runtime.test.ts` — "tests real adapter
  output, activates a canonical binding, and survives hydration"; "routes agent chat through the
  active binding with shop instructions and records metadata"; "rejects unbound chat, cross-shop
  activation, browser activation, and absent bridges".
- Real deployed-model round trip (opt-in, not run as part of this doc's review):
  `tests/live-render-model-runtime.test.ts`, gated behind `RUN_LIVE_MODEL_RUNTIME_TEST=true`.
- Browser routing away from tool-shaped requests: `apps/web/src/browser-inference-routing.ts`
  (`decideInferenceRoute`, `requestRequiresServerTool`).
- Structural text-only browser output: `BrowserGenerationResult` in
  `apps/web/src/browser-inference-types.ts`.

## What this document is _not_ reporting as a gap

An earlier pass flagged the three model-selection layers above as a possible sign of overlapping,
unclear mechanisms worth auditing. On tracing the actual frontend gating logic
(`SokoApplication.tsx`), that concern did not hold up: each layer has a distinct job and its own
real-inference gate. No code change was made here — this document replaces that earlier informal
concern with the traced, verified explanation, so it does not need re-investigating later.
