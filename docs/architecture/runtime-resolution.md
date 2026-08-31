# Runtime resolution

The API's native runtime binding resolver (`services/api/src/cp2/domains/native-runtime/store.ts`,
`NativeRuntimeBindingStore`) is the sole authoritative server-side path for "which harness + model +
execution host handles this turn." It reads the persisted binding, agent, binding-model roles,
installations, and hosts. Client routing may propose a previously authorized local completion; it
cannot invent a model, host, assignment, or tool permission.

## One resolver

`NativeRuntimeBindingStore.resolveRuntimeBinding({ businessId, accountId?, agentId,
conversationId? })` is the only effective-runtime decision. Storefront chat supplies
`conversationId`; the merchant's direct runtime-session chat supplies its authenticated
`accountId`. Conversation calls derive the account from the conversation as a defense in depth.
Both shapes enter the same function and receive the same binding, agent, model, installation, and
host result.

Every shop-scoped read and write uses `profile.agentId` (the business id for the default profile).
Zero-setup provisioning and explicit activation therefore update the same binding identity.
Settings cannot read a business-id binding while chat silently reads a second `builtin:pi:v1`
binding. The built-in Pi record remains the global platform-default resource; inheriting it does
not create a second per-shop identity space.

## Resolution precedence

For a given `(businessId, agentId)`:

1. **Conversation override** - only when a `conversationId` is present: the conversation's own
   `runtimeBindingId`, if the caller explicitly reassigned one via `activateVerifiedRuntimeBinding`.
2. **Shop/account binding** - the most recently active `NativeRuntimeBindingSummary` for this
   `(businessId, accountId, agentId)`, however it got there (explicit user activation via
   `activateVerifiedModel`, or zero-setup lazy provisioning below).
3. **Platform default** - `builtin:soko-default-runtime:v1`, materialized by migration 077 as Pi +
   SmolLM2 360M + the backend execution host. A conversation carrying this binding id is treated as
   inherited default, so a later account override still wins.

## Zero-setup first-chat provisioning

`ensureDefaultRuntimeForTurn` (`agent-runtime/store.ts`) is the idempotent, lazy path that turns
`platformDefaultRuntime` policy (`PLATFORM_DEFAULT_MODEL_ID=smollm2-360m`,
`PLATFORM_DEFAULT_EXECUTION_TARGET=backend`, harness `Pi`) into a real, shop-scoped binding the first
time a shop's agent needs one:

1. Call the canonical resolver. If it already has an available backend candidate, do nothing.
2. Resolve the Pi harness adapter and confirm `platformDefaultRuntime.executionTarget === "backend"`.
   Probe `agentAdapter.canRun(...)` for the harness itself.
3. Walk preferred model ids (the shop's own AI-model preference, the platform default model,
   `defaultAiModelId`, then the rest of the enabled chat-capable catalog) and probe each one's
   `ModelRuntimeAdapter.canRun(...)` (a real `/v1/models/:id/probe` call against the backend
   inference host), collecting up to two verified candidates.
4. Call `NativeRuntimeBindingStore.ensureDefaultRuntimeBinding` with those candidates. It is
   idempotent per `(businessId, accountId, agentId)`: an existing active binding is never reset,
   only extended with a hosted fallback role if it lacks one; a shop with nothing yet gets a brand
   new binding (`activateVerifiedModel` under the hood) marked
   `configuration.source = "zero-setup-provisioning"`.

This is a bootstrap repair path for fresh in-memory stores and deployments upgrading from a draft
default. Migration 077 makes the production platform default a real graph up front. The same logic
runs for conversation and conversation-free turns.

## Effective runtime API

`GET /businesses/:businessId/runtime/effective` calls the same resolver and verifies both the
selected harness and model adapter. It returns public resource identity, resolution source, and
`READY`/`UNAVAILABLE`; it never returns host endpoints or credentials. The quick switcher and
advanced settings readiness banner consume this response rather than deriving readiness from the
model catalog in React.

## Execution target resolution

`resolveExecutionTarget` (`native-runtime-routing.ts`) is deliberately strict: given a resolved
native binding, it reads the selected candidate's host type, falling back to the model's declared
`configuration.executionTarget` only when no host is attached yet. If neither is a valid
`ModelExecutionTarget`, it throws `409 NO_COMPATIBLE_EXECUTION_TARGET` - there is intentionally no
implicit "assume backend" branch, because a model that never declared where it runs is a routing
failure, not something safe to guess at. This function does not special-case any provider (OpenAI,
Ollama, or otherwise); provider-specific behavior lives entirely behind the registered
`ModelRuntimeAdapter` for the resolved execution target.

For an ordinary turn, once resolution succeeds:

1. Reject inactive models, unavailable installations, unhealthy hosts, incompatible runtime
   contracts, missing model capabilities, and cross-account/shop hosts.
2. Select the first available candidate deterministically by role and priority (primary, then
   fallbacks in priority order).
3. Execute through the provider-neutral `ModelRuntimeAdapter` interface
   (`services/api/src/inference/model-runtime.ts`) - for the backend target this is an HTTPS call
   over Render's private network to the `soko-market-inference` service, which runs Ollama with
   `smollm2:360m-instruct-q4_0` in-container.
4. On a retryable, pre-side-effect inference failure, add the candidate key to the attempted set and
   try the next candidate. The persisted finite role list bounds failover.
5. Execute tools only after normal server parsing, authorization, confirmation, and idempotency
   checks.

Selection and completion telemetry records binding, conversation (or `"runtime-unbound"`), model,
target, host, resolution source, fallback index/reason, error category, and latency. It excludes
prompts, message contents, credentials, and tokens.

## History

Migration 063 introduced the native graph; migrations 065-072 migrated the retired execution
fabric, provider-specific target values, and the Pi + SmolLM2 360M zero-setup default without
invalidating conversations. Migrations 075/076 (`Unify runtime binding on
NativeRuntimeBindingStore`) dropped the legacy `cp2_agent_model_bindings` table and its dual-write
fallback tier entirely. Migration 077 materialized the default model/host/installation association.
`NativeRuntimeBindingStore` is the only runtime-binding storage and resolver.
