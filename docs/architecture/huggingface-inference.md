# Hugging Face inference and dynamic model switching

This is the reference doc for how Hugging Face inference and multi-model switching actually work in
this repository, after the change described in `docs/implementation/huggingface-model-switching-report.md`.
Read `docs/architecture/huggingface-model-switching-audit.md` first for how this was scoped against
the pre-existing architecture — this doc does not repeat that reasoning, only the resulting design.

## 1. The five layers, and where each one lives

```
User
  -> Soko unified chat (apps/web: QuickRuntimeSwitcher.tsx / AgentModelPanel.tsx)
  -> Selected agent (AgentDefinition, unchanged by a model switch)
  -> Native runtime binding resolver (NativeRuntimeBindingStore.resolveRuntimeBinding)
  -> Model + provider (runtimeModels / aiModelRegistry, ModelRuntimeAdapter)
  -> Execution environment (the `vercel` execution target: services/ai-runtime on Vercel)
  -> Model response -> Soko tool-authorization boundary (packages/tool-core, unchanged) -> chat
```

Agent, model, provider and execution environment are four independently swappable dimensions,
exactly as the task brief required, but three of the four (agent, native runtime binding, tool
authorization) needed **zero code changes** for this feature — they were already provider-agnostic
by construction. The actual work was entirely in the "model + provider" and "execution environment"
layers: making Hugging Face a second, concurrently-available option there instead of an exclusive
deployment-wide mode.

## 2. Model registry

Two registries, both extended (not replaced):

- `runtimeModels` (`packages/shared-types/src/index.ts`) — the closed set of models that get a real,
  booted `ModelRuntimeAdapter` at server start (`services/api/src/index.ts`). Now includes `qwen3-4b`
  (`provider: "huggingface"`, `providerModelId: "Qwen/Qwen3-4B"`, `contextWindow: 32_768`,
  `requiresArtifact: false`).
- `aiModelRegistry` (`services/api/src/cp2/domains/agent-runtime/model-catalog.ts`) — the catalog
  surfaced to `GET /v1/ai-models` and the UI. Now includes a matching `qwen3-4b` entry with
  `canonicalModelId: "Qwen/Qwen3-4B"` (the provider-specific id, kept separate from the internal
  registry id `qwen3-4b` per the task brief's requirement), `supportsToolCalling: false` and
  `supportsStructuredOutput: false` (unverified for the featherless-ai-routed endpoint as of this
  writing — do not flip these without confirming against the live provider first).

`RuntimeModelDefinition.requiresArtifact` is the one new field on the registry type: `false` for a
model served remotely with nothing to download (Hugging Face today), defaulting to `true` (unchanged
behavior) for every model registered before this field existed.

## 3. Making Hugging Face concurrent instead of exclusive

Before this change, `services/ai-runtime`'s `INFERENCE_PROVIDER` env var picked exactly one engine
for the *entire deployment*: `llama-cpp` (download-and-run a GGUF artifact) or `huggingface` (route
every request to a Hub model via `HF_MODEL_MAP`, ignoring the artifact). A deployment could never
serve both at once, and switching meant a redeploy.

`resolveInferenceEngine()` (`services/ai-runtime/src/vercel-handler.ts`) now makes this a per-request
decision:

```ts
function resolveInferenceEngine(config, modelId):
  if HF_MODEL_MAP has modelId -> route to Hugging Face with that mapped id
  else if config.provider === "huggingface" and HF_MODEL_ID is set -> route to Hugging Face (legacy
    exclusive-mode fallback, unchanged behavior for deployments still using that mode)
  else -> route to llama-cpp
```

`readVercelInferenceConfig()` now builds the Hugging Face config block whenever `HF_TOKEN` is set —
not only when `INFERENCE_PROVIDER=huggingface`. This means the **recommended deployment shape** is:
leave `INFERENCE_PROVIDER=llama-cpp` (the default) and set `HF_TOKEN` + `HF_MODEL_MAP` anyway. Any
model id present in the map is then served by Hugging Face; every other enabled model keeps running
through llama.cpp in the exact same deployment, with no redeploy required to move a model between
engines. The old exclusive `INFERENCE_PROVIDER=huggingface` mode still works byte-for-byte as before,
for any deployment that depends on it.

`parseRequest()` in the same file only requires the wire-format `artifact` field when the resolved
engine is `llama-cpp`; a Hugging Face-routed request carries no artifact at all. On the `services/api`
side, `createVercelModelAdapter()` (`services/api/src/inference/model-runtime.ts`) takes a
`requiresArtifact` flag (sourced from `RuntimeModelDefinition.requiresArtifact`) and skips
`ModelArtifactStore.resolveArtifact/verifyArtifact/createDownloadUrl` entirely when false, reporting
`provider: "remote-chat-completions"` instead of `"llama.cpp"` in generation results and health
checks, so usage/health telemetry never misattributes a Hugging Face call to the GGUF engine.

## 4. Model-selection hierarchy

Unchanged: the pre-existing `NativeRuntimeBindingStore.resolveRuntimeBinding()` already implements
exactly the precedence the task brief asked for — (1) an explicit `runtimeBindingId` on the
conversation, (2) the business/account's most recent active binding, (3) the platform default
(`repositoryDefaultRuntimePolicy`, admin-overridable via the existing `PLATFORM_DEFAULT_MODEL_ID` env
var). This feature does not add a second resolution path; Qwen3-4B and any future Hugging
Face-routed model become selectable through this exact mechanism once registered.

**Qwen3-4B is registered, available, and marked `recommended: true`, but is deliberately not the
compiled-in platform default (`repositoryDefaultRuntimePolicy.modelId`, still `smollm2-360m`).**
`render.yaml` provisions `PLATFORM_DEFAULT_MODEL_ID` as an operator-set (`sync: false`) value on the
live Render deployment, whose current value this repository cannot see. Flipping the code-level
default to `qwen3-4b` would silently change platform-default routing behavior for that deployment if
its dashboard value happens to be unset — and would try to serve every zero-preference business
through Hugging Face without confirming `HF_TOKEN`/`HF_MODEL_MAP` are configured on the ai-runtime
side first. Making Qwen3-4B the actual live default is therefore an explicit administrator action:
set `PLATFORM_DEFAULT_MODEL_ID=qwen3-4b` (this already-existing env var) once Hugging Face is
configured and validated. This satisfies "the default must be configurable by the platform
administrator" literally, without an unverifiable silent behavior change to production.

## 5. Conversation continuity and context budgeting

Unchanged. `contextCharacterBudgetForModel()` already derives its budget from a model's declared
`contextWindow` — Qwen3-4B's `32_768` flows through automatically. Conversation history, tool
results, and task state are unaffected by which `ModelRuntimeAdapter` ultimately serves a turn: they
live in `conversations`/`conversation_messages`/`cp2_runtime_task_heads` regardless of provider. A
model swap mid-task goes through the pre-existing `POST /v1/runtime/:taskId/swaps/model` endpoint
(runtime handoff protocol), which was not modified.

## 6. Credential architecture

Three distinct credentials, never conflated:

1. **Platform-managed inference token** — `ai-runtime`'s `HF_TOKEN` (required for any Hugging
   Face-routed model). Server-side only, never reaches a browser, never logged.
2. **Discovery token** — `services/api`'s `HF_TOKEN` (optional). Used only to raise Hub search rate
   limits for registry discovery (`huggingface-model-catalog.ts`), never used for inference. Kept
   deliberately separate from (1) despite the identical env var name on the other service.
3. **User-connected (BYO) inference credential** — a business's own Hugging Face personal access
   token, stored via the pre-existing `ExternalConnectionsDomain`
   (`cp2_external_registry_connections`, encrypted with the same primitive as social-login OAuth
   tokens). This repository's credential storage already supported connecting an HF account for
   discovery; this feature adds one column and one endpoint so that connection can *also*, with a
   separate explicit step, be authorized for inference billing:

   - `inference_authorized boolean not null default false` (migration `097`). Connecting an account
     never sets this true — the discovery scope and the inference-billing scope are two different
     authorizations with different financial consequences, so one is never inferred from the other.
   - `POST /v1/external-connections/:id/inference-authorization` (body `{authorized: boolean}`) is
     the only action that changes it. Setting `false` always succeeds; setting `true` requires the
     connection to still be `status: "connected"` with a decryptable token.
   - `ExternalConnectionsDomain.resolveInferenceToken(accountId, provider)` — the read path an
     inference call must use — returns a token only when `inferenceAuthorized` is true, `null`
     otherwise. `resolveToken()` (the pre-existing discovery read path) is unaffected and must never
     be used to source a credential for a billed model call.
   - The wire contract for actually using it end to end exists and is unit-tested
     (`InferenceExecutionRequest.providerCredential`, honored by `vercel-handler.ts`'s Hugging Face
     branch, which prefers it over the platform's `HF_TOKEN` when present) — see §8 for what is and
     is not wired into the live per-turn call path yet.

Every credential path shares the same guarantees: HTTPS transit, server-side validation before
persistence (one real API call against the provider), encryption at rest
(`encryptOAuthToken`/`decryptOAuthToken`), account-scoped resolution (a business can never read
another business's connection — enforced by `accountId` equality checks in every domain method), and
exclusion from logs, telemetry, and model context. `resolveExternalConnectionToken`/
`resolveExternalConnectionInferenceToken` on `Cp2Store` are explicitly documented as internal-only
and are never exported from a route handler.

## 7. Free-tier and spending safeguards

Verified against Hugging Face's own pricing docs (`huggingface.co/docs/inference-providers/pricing`,
checked 2026-09-24): free accounts get **$0.10/month** in Inference Providers credit; PRO/Team/
Enterprise get $2.00/seat/month. Extra usage past that requires purchasing credits — Hugging Face
does not document an automatic "keep charging a card" behavior for a free account with no payment
method on file, and this repository does not assume one.

Two independent layers:

- **Provider-side** (authoritative, not implemented here): the administrator should configure the
  actual spending limit in the Hugging Face billing dashboard
  (`huggingface.co/settings/billing`) and, for Team/Enterprise, the org-level spending cap mentioned
  in that doc. This repository cannot see or set that from application code.
- **Application-side backstop** (implemented, `HF_FREE_TIER_ONLY` env var on `services/ai-runtime`):
  - `huggingface-runtime.ts` classifies an HTTP 402 response from Hugging Face as
    `INFERENCE_BUDGET_EXHAUSTED`, non-retryable — distinct from a generic failure.
  - When `HF_FREE_TIER_ONLY=true`, one confirmed `INFERENCE_BUDGET_EXHAUSTED` response trips a
    process-lifetime latch (`vercel-handler.ts`) that immediately refuses every subsequent
    Hugging-Face-routed request with the same error, without calling Hugging Face again — "stop
    when spending cannot be bounded reliably," not "back off and retry the paid path."
  - **Named limitation**: this latch is per warm serverless-function instance, not distributed. It
    resets on cold start and does not coordinate across concurrently running instances. It is a
    safety net on top of the provider-side limit, never a replacement for it — this is stated
    explicitly in the env var's own doc comment in `.env.example` so it cannot be mistaken for a
    hard guarantee.

Per-request/model/output-token limits, concurrency bulkheads and a circuit breaker
(`INFERENCE_MAX_CONCURRENCY`, `INFERENCE_CIRCUIT_BREAKER_*`, `INFERENCE_MAX_OUTPUT_TOKENS`) already
existed and apply identically to Hugging Face-routed and llama.cpp-routed requests — they were not
provider-specific before this change and remain so.

## 8. What is implemented vs. designed-only

**Implemented, tested, and wired into the live request path:**
- Concurrent per-model Hugging Face/llama.cpp routing in the same deployment.
- Qwen3-4B registered, catalog-visible, activatable through the existing atomic binding-activation
  endpoint.
- 402 budget-exhaustion classification and the `HF_FREE_TIER_ONLY` process-lifetime latch.
- `providerCredential` wire plumbing from `services/api`'s adapter through to `services/ai-runtime`'s
  Hugging Face call, preferring a supplied credential over the platform token.
- The `inference_authorized` credential-scope column, its dedicated authorization endpoint, and
  `resolveInferenceToken`'s scope-gated read.
- The merchant-funded-model cost-confirmation gate in both `QuickRuntimeSwitcher.tsx` and
  `AgentModelPanel.tsx` (a pre-existing gap in both surfaces — cost responsibility was being sent to
  the activation endpoint without ever asking the merchant first).

**Designed and mechanism-tested, not yet wired into the live per-turn chat call:**
- Actually resolving a business's authorized `providerCredential` and injecting it into
  `ModelRuntimeContext` during a real chat turn. The natural injection point is
  `resolveNativeRuntimeModelProvider()` / `runtimeProviderFromAdapter()`
  (`services/api/src/cp2/domains/agent-runtime/native-runtime-routing.ts:152`), which is currently a
  deliberately pure, synchronous precedence resolver with an extensive existing test suite relying on
  that purity. Adding an async, account-scoped credential lookup inside it is a real architectural
  change to a load-bearing function and was not made blind in this session — it needs its own
  reviewed change, including deciding where a business's chosen "use my own Hugging Face account"
  billing-mode preference is persisted (a candidate: `NativeRuntimeModelSummary.configuration`, the
  existing free-form per-model configuration field on the native runtime binding graph).
- Task-type-based automatic model routing (§9 of the audit) — genuinely new capability, not required
  by the task brief's explicit precedence hierarchy, and not built.

Nothing in this list was reported as done in the final report unless it is in the first category.
