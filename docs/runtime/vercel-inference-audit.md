# Vercel inference migration audit

Phase 0 deliverable for moving Soko's inference execution off Render and onto Vercel, keeping
Render as the control plane and Neon as the store for both application state and model-artifact
metadata. This documents the actual repository state found, what was reused, what was removed, and
the resulting architecture - not a plan written before the code existed.

## Architecture before

```text
Chat client
    -> Render API (services/api)
        -> authenticate, resolve conversation/business context
        -> resolve agent + model + runtime binding (native runtime graph, Neon Postgres)
        -> resolve execution target: "backend"
        -> createBackendModelAdapter (services/api/src/inference/model-runtime.ts)
            -> HTTP call over Render's private network to services/ai-runtime
                -> Fastify app (services/ai-runtime/src/app.ts)
                -> Ollama engine (services/ai-runtime/src/inference-engine.ts,
                   services/ai-runtime/src/ollama-model.ts) against a Render persistent disk
                   (/var/lib/soko-models), OR
                -> optional OpenAI cloud fallback (services/api/src/inference/openai-provider.ts)
        <- normalized completion
    -> tool execution, persistence, response
```

`render.yaml` declared `soko-market-inference` as a Render private (`pserv`) Docker service running
`services/ai-runtime/Dockerfile`, with a 5 GB persistent disk mounted at `/var/lib/soko-models` and
Ollama bound to loopback inside the container. The API received the service's private
`hostport`/token through Render's `fromService` linking and never had a public inference endpoint.

## Canonical entry points identified

- **Chat entry point:** `POST /v1/messages` and `POST /businesses/:id/runtime/turns`
  (`services/api/src/cp2/domains/agent-runtime/routes.ts`), both routing through
  `AgentRuntimeDomain.createRuntimeTurn` (`store.ts`).
- **Runtime resolver:** `resolveExecutionTarget()` /
  `resolveNativeRuntimeModelProvider()` (`services/api/src/cp2/domains/agent-runtime/
  native-runtime-routing.ts`) - already fully generic over `ModelExecutionTarget`, driven by the
  native runtime graph (`cp2_native_execution_hosts`, `cp2_native_runtime_models`,
  `cp2_native_model_installations`, `cp2_native_runtime_bindings`). This module required **no**
  changes; it never hardcoded a target.
- **Inference provider interface:** `ModelRuntimeAdapter` (`canRun` / `healthCheck` / `generate`)
  and `RuntimeModelProvider` (`complete`) in `services/api/src/inference/model-runtime.ts`, adapted
  into each other by `runtimeProviderFromAdapter`. This is the swappable-primitive boundary the task
  asked to preserve, and it did not need to change shape.
- **Model artifact/binding tables:** `cp2_native_execution_hosts`, `cp2_native_runtime_models`,
  `cp2_native_model_installations`, `cp2_native_runtime_bindings`,
  `cp2_native_runtime_binding_models` (all pre-existing, from the prior native-runtime-binding
  unification work referenced in `docs/architecture/native-runtime-bindings.md`).

## Components reused as-is

- The entire native runtime graph and its resolver (`native-runtime-routing.ts`,
  `native-runtime/store.ts`'s binding/host/installation/role tables).
- `ModelRuntimeAdapter` / `RuntimeModelProvider` / `runtimeProviderFromAdapter` - the adapter
  abstraction itself.
- `OwnerNodeBroker` (`services/api/src/inference/owner-node-broker.ts`) - the separate
  `remote-shop-device` execution target (merchant-owned hardware, WebSocket-registered, HMAC-signed
  jobs). Untouched; a legitimate second execution target with its own broker, not a duplicate of the
  Vercel path.
- `modelExecutionTargets` / `isModelExecutionTarget` (`packages/shared-types/src/index.ts`) - the
  existing three-value union (`"vercel" | "backend" | "remote-shop-device"`) already modeled Vercel
  as a first-class target before this audit; the gap was in code that hardcoded `"backend"` instead
  of consulting this union or the platform's configured default.

## Components removed

- `services/ai-runtime/src/app.ts`, `server.ts`, `inference-engine.ts`, `local-model.ts`,
  `ollama-model.ts`, `openai-model.ts`, `redis-client.ts`, `runtime-config.ts`,
  `scripts/model-admin.mjs`, `scripts/start-inference.sh`, `Dockerfile` - the entire Fastify +
  Ollama + Redis private-service implementation.
- `services/api/src/inference/openai-provider.ts` - the OpenAI Responses API adapter and its
  `openai-fast` / `openai-reasoning` catalog entries
  (`services/api/src/cp2/domains/agent-runtime/model-catalog.ts`).
- `createBackendModelAdapter`, `createBackendModelAdapterRegistry`, `createBackendInferenceClient`,
  `createProviderModelAdapter` (`services/api/src/inference/model-runtime.ts`) - replaced by
  `createVercelModelAdapter` / `createVercelInferenceClient`.
- `resolveOllamaModelName` and the `BACKEND_INFERENCE_*` / `INFERENCE_CLOUD_*` / `OPENAI_*` /
  `INFERENCE_ENGINE` environment variables (`services/api/src/config.ts`).
- The `soko-market-inference` Render Blueprint service, its persistent disk, and every
  `BACKEND_INFERENCE_*` env var on the API service.

## New components

- `services/ai-runtime/src/vercel-handler.ts` - `createVercelInferenceHandler` /
  `createVercelHealthHandler`, the Vercel `fetch`-handler request/response contract (bearer auth,
  manual schema validation, NDJSON streaming), backed by `services/ai-runtime/api/inference.ts` and
  `api/health.ts`.
- `services/ai-runtime/src/artifact-loader.ts` - `downloadVerifiedArtifact`: SSRF-guarded (host
  allowlist, no-redirect fetch), size-capped, sha256/size/format-verified GGUF download with an
  on-disk cache keyed by hash.
- `services/ai-runtime/src/llama-runtime.ts` - `loadLlamaRuntime`, the `node-llama-cpp` (CPU-only)
  wrapper actually running inference.
- `services/ai-runtime/src/runtime-cache.ts` - `RuntimeCache`, a bounded (1-4 entries) LRU cache
  with concurrent-load deduplication, scoped to one warm Vercel instance.
- `services/ai-runtime/src/service-error.ts` - `InferenceServiceError`, typed errors with an HTTP
  status baked in.
- `services/api/src/inference/model-artifact-store.ts` - `createNeonModelArtifactStore`
  (`ModelArtifactStore`): resolves the available artifact row for a model, hand-rolls AWS SigV4
  presigning for Neon's S3-compatible object storage (no AWS SDK dependency), and does a
  path-traversal/bucket-name-hardened `HEAD`-based size verification.
- `services/api/src/inference/model-runtime.ts` additions - `createVercelInferenceClient` (the
  HTTPS + bearer + NDJSON client) and `createVercelModelAdapter` (wraps the client + artifact store
  into the same `ModelRuntimeAdapter` shape every other target already implements).
- `infra/db/migrations/079_vercel_inference_artifacts.sql` - see Schema changes below.

## Schema changes

Migration `079_vercel_inference_artifacts.sql`:

- Creates `cp2_model_artifacts` (metadata-only: `storage_provider`, `bucket`, `object_key`,
  `format`, `quantization`, `size_bytes`, `sha256`, `content_type`, `status`), with a CHECK
  constraint rejecting path traversal / absolute / backslash object keys, a format regex, a
  sha256-hex regex, and a partial unique index enforcing at most one `status = 'available'` artifact
  per model. GGUF bytes are never stored in Postgres.
- Seeds `builtin:smollm2-360m:q4_0:gguf` as the available artifact for the platform default model,
  and a `builtin:vercel-inference:v1` row in `cp2_native_execution_hosts` (`type: "vercel"`,
  `credentialReference: "env:SOKO_INFERENCE_SERVICE_TOKEN"`).
- Points `cp2_native_runtime_models` for `smollm2-360m` at `executionTarget: "vercel"` and the new
  artifact, adds a `cp2_native_model_installations` row binding model to host, and repoints the
  default runtime binding's primary role at the Vercel host.
- Marks the old Render-hosted host record and its installations `status: "unavailable"`, so no
  binding can silently fail over to Render-hosted execution - the retirement is explicit in data,
  not just in code.

No destructive drops. The old host/installation rows remain as unavailable historical records,
consistent with this repository's existing migration convention (see migration 065's retirement of
the execution-fabric tables, referenced throughout `native-runtime-deployment.md`).

## Bugs found and fixed during this migration

The adapter/config/DB layers were migrated correctly, but several places in the business-logic
layer still hardcoded the literal `"backend"` as if it were the only live execution target, instead
of consulting `isModelExecutionTarget()` or the platform's configured default. Since production
`PLATFORM_DEFAULT_EXECUTION_TARGET` moved to `"vercel"` and `modelRuntimeAdapterResolver` only ever
registers adapters under `vercel:*` keys, these were live production bugs, not just stale tests:

- `getEffectiveRuntime` (`agent-runtime/store.ts`) hand-enumerated `"backend" | "remote-shop-device"`
  instead of using `isModelExecutionTarget()`, so it never resolved an adapter for a Vercel-executed
  binding - `/businesses/:id/runtime/effective` always reported `ready: false` even when Vercel was
  healthy. Fixed to use the existing type guard.
- `resolveRuntimeModelProvider`'s `eligibleExecutionTargets` was hardcoded to
  `Set(["backend"])` - the one call site gating which targets a real chat turn is even allowed to
  route to. This meant **no chat turn could ever route to Vercel**, regardless of any other fix.
  Fixed to `modelExecutionTargets` minus `"remote-shop-device"`.
- `ensureDefaultRuntimeForTurn`'s zero-setup provisioning bailed out unless
  `platformDefaultRuntime.executionTarget === "backend"`, so a fresh shop's first chat could never
  auto-provision a working Pi + SmolLM + Vercel binding - the exact "Phase 9: Default Runtime"
  requirement. Fixed to compare against the configured default / exclude only
  `remote-shop-device`.
- `validateAgentModelBindingConfiguration` (`agent-runtime/shared.ts`) required
  `executionTarget === "backend"` for hosted-source models and `CLOUD_ONLY` mode, rejecting a
  legitimate `"vercel"` selection. Fixed to reject only `remote-shop-device`.
- `cp2/store.ts`'s `ensureDefaultRuntimeBinding` wrapper was missing the `activeShopId !== null &&`
  tolerance its sibling `resolveNativeRuntimeBinding` check already had, incorrectly rejecting a
  conversation with no explicit shop scope once `ensureDefaultRuntimeForTurn` started actually
  running (previously masked because that function always bailed out early). Fixed to match.
- Three call sites in `apps/web/src/AgentModelPanel.tsx` and `QuickRuntimeSwitcher.tsx` sent
  `executionTarget: "backend"` when a merchant activated or tested a "Soko backend" model from the
  UI - this would have made every UI-driven activation fail its own health probe. Fixed to send
  `"vercel"`.

All of the above were caught by re-running the full test suite after the adapter/config layer
changes, not by inspection alone - several tests that hardcoded `"backend"` as their expected
execution target started failing once the routing bugs were fixed, which is what surfaced them.
See `tests/model-activation-runtime.test.ts`, `tests/native-runtime-execution-target-resolution.test.ts`,
`tests/zero-setup-native-runtime.test.ts`, `tests/effective-runtime.test.ts`.

## Migration strategy actually used

1. Land the new Vercel-side service (`services/ai-runtime`) and Render-side adapter/client
   (`model-runtime.ts`, `model-artifact-store.ts`) as pure additions.
2. Wire `index.ts` to register a `createVercelModelAdapter` per enabled catalog model under
   `vercel:${modelId}`, gated on `VERCEL_INFERENCE_URL` being configured.
3. Migrate the database: seed the Vercel host/artifact rows, repoint the default binding, mark the
   old Render host unavailable - all in one migration, no separate backfill step needed since the
   native runtime graph already supported multiple execution targets.
4. Remove the old Render-hosted implementation and its Blueprint declaration.
5. Fix the business-logic call sites that still hardcoded `"backend"` (found via full test-suite
   regression, see above).
6. Rewrite `render.yaml`, `docker-compose.yml`, `.env.example`, the ops scripts
   (`inference-health.mjs`, `inference-probe.mjs`, `verify-production-runtime.mjs`), and
   `scripts/check-render-inference-boundaries.mjs` (which had been asserting the *old* boundary and
   would have failed Render's own build) to match the new contract.

## Final target flow

```text
Chat client
    -> Render API (services/api) - control plane
        -> authenticate, resolve conversation/business context
        -> resolve agent + model + runtime binding (native runtime graph, unchanged)
        -> resolve execution target: "vercel" (isModelExecutionTarget-driven, generic)
        -> createVercelModelAdapter.generate()
            -> resolve artifact metadata (Neon Postgres, cp2_model_artifacts)
            -> mint a short-lived signed download URL (Neon object storage, SigV4)
            -> POST https://<vercel-deployment>/v1/inference (bearer token, NDJSON stream)
                -> services/ai-runtime (Vercel serverless function)
                -> download + verify (SSRF-guarded, sha256/size/format) if not cache-hot
                -> load via node-llama-cpp (bounded LRU cache, dedup concurrent loads)
                -> generate, stream delta/result NDJSON events back
        <- normalized completion (ModelRuntimeGenerationResult)
    -> tool execution, persistence, response streamed to client
```

Neon stores. Render routes and coordinates. Vercel executes inference. Agent, model, artifact, and
execution host remain independently swappable: the same `ModelRuntimeAdapter` shape that serves
`vercel:smollm2-360m` today could serve a self-hosted `backend:*` adapter or a different model under
the identical resolver/routing/telemetry path with no chat-code branching.

## Documentation

- [../architecture/inference-runtime.md](../architecture/inference-runtime.md) - ownership boundary,
  runtime contracts, swap flows.
- [../deployment/vercel-inference.md](../deployment/vercel-inference.md) - Vercel deployment runbook.
- [../deployment/render-api.md](../deployment/render-api.md) - Render API deployment/config.
- [../storage/model-artifacts.md](../storage/model-artifacts.md) - Neon artifact storage contract.
