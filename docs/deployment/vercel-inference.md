# Deploy inference on Vercel

## Topology

`services/ai-runtime` is a standalone Vercel project, deployed independently from the Render API
(`render.yaml` no longer declares any inference service). `services/ai-runtime/vercel.json`
rewrites `/v1/inference` → `api/inference.ts` and `/health`/`/ready` → `api/health.ts`, both
Vercel serverless functions using the platform's `fetch`-handler convention (`export default {
fetch: handler }` / `export function GET()`).

The inference function is CPU-only (`vercel.json` excludes the CUDA/Vulkan/ARM
`node-llama-cpp` native binaries from the deploy bundle), runs in region `iad1`, and is configured
for `maxDuration: 300` / `memory: 2048` to accommodate a cold model load plus a full generation.

### Vercel project settings

Vercel resolves the Node.js runtime from the `engines.node` field of the `package.json` at its
configured Root Directory - for a monorepo-rooted project that is
`services/ai-runtime/package.json`, not the repository root's. Set these explicitly in the Vercel
dashboard when creating/verifying the project, and confirm no Node engine warning appears in the
deploy log:

```text
Repository:       LuckiestManAliveEver/soko.market
Root Directory:    services/ai-runtime
Framework Preset:  Other
Node.js Version:   22.x
Install Command:   pnpm install
Build Command:     pnpm run build
Output Directory:  (none / default)
Region:            iad1
```

`services/ai-runtime/package.json` also declares `"engines": {"node": ">=22.19.0 <23.0.0"}`
directly, matching the repository root and `.nvmrc` - this is what makes Vercel's automatic runtime
detection agree with the dashboard setting instead of silently picking its own default.

### node-llama-cpp install

`node-llama-cpp` ships a `postinstall` script that links the correct prebuilt native binary for the
target platform; pnpm 10 blocks arbitrary install scripts by default. The root `pnpm-workspace.yaml`
explicitly allows only this one:

```yaml
onlyBuiltDependencies:
  - node-llama-cpp
```

No other dependency's install scripts are approved. `services/api` must never depend on
`node-llama-cpp` or any other native inference engine - `pnpm check:render-inference-boundaries`
fails the build if it does.

Vercel has no access to Postgres, no business data, no tool-execution authority, and no permanent
storage credentials. Render mints a short-lived signed download URL for the GGUF artifact and sends
it as part of each request; Vercel downloads, verifies (SHA-256 + size + format), loads via
`node-llama-cpp`, and streams NDJSON delta/result events back over the same HTTPS response Render
is holding open.

## Required configuration

Vercel project environment (`services/ai-runtime/.env.example`):

```text
SOKO_INFERENCE_SERVICE_TOKEN=<same value as Render's SOKO_INFERENCE_SERVICE_TOKEN>
MODEL_ARTIFACT_ALLOWED_HOSTS=<Neon object-storage hostname(s), comma-separated>
VERCEL_MAX_ARTIFACT_BYTES=450000000
INFERENCE_MAX_INPUT_CHARACTERS=64000
INFERENCE_MAX_OUTPUT_TOKENS=512
INFERENCE_RUNTIME_CACHE_ENTRIES=1
```

Render API environment (`render.yaml`'s `soko-market-api` service, `.env.example` at the repo
root):

```text
VERCEL_INFERENCE_URL=https://<your-vercel-deployment>.vercel.app
VERCEL_INFERENCE_TIMEOUT_MS=300000
INFERENCE_REQUIRED=true
SOKO_INFERENCE_SERVICE_TOKEN=<same value as Vercel's SOKO_INFERENCE_SERVICE_TOKEN>
NEON_MODEL_STORAGE_ENDPOINT=https://<neon-object-storage-host>
NEON_MODEL_STORAGE_REGION=us-east-1
NEON_MODEL_STORAGE_ACCESS_KEY_ID=<neon object-storage access key>
NEON_MODEL_STORAGE_SECRET_ACCESS_KEY=<neon object-storage secret key>
MODEL_ARTIFACT_URL_TTL_SECONDS=900
```

`SOKO_INFERENCE_SERVICE_TOKEN` must be identical on both sides and at least 32 characters. Render
and Vercel are separate platforms with no shared secret-linking mechanism (unlike `render.yaml`'s
`fromService`), so this is a manual copy-paste step: generate the value in Render (or anywhere), set
it in the Render dashboard, then paste the same value into the Vercel project's environment
variables.

## Model artifacts

GGUF model weights never live in this repository or in a PostgreSQL BYTEA column. Migration
`infra/db/migrations/079_vercel_inference_artifacts.sql` creates `cp2_model_artifacts` (metadata
only: bucket, object key, format, quantization, size, SHA-256, status) and seeds the platform
default (`builtin:smollm2-360m:q4_0:gguf`). The actual `.gguf` file must be uploaded to the
configured Neon object-storage bucket at the exact `object_key` the row declares, before traffic is
switched to Vercel. See [../storage/model-artifacts.md](../storage/model-artifacts.md).

## Health and rollout

`/health` and `/ready` are separate Vercel serverless functions (`api/health.ts`, `api/ready.ts`)
with deliberately different, honest claims:

- `/health` is unauthenticated bare liveness - `{ ok: true, service: "soko-ai-runtime" }` - and
  never depends on configuration, so it cannot fail because an environment variable is missing. It
  proves nothing about whether inference can run.
- `/ready` parses this function's own configuration (service token, artifact host allowlist, size/
  token limits) and returns `200 { ready: true, ... }` or `503 { ready: false, reason }`. It never
  triggers a model download or load, so probing it repeatedly is cheap.

Neither endpoint can report whether a model is actually loaded: `/v1/inference` is a _separate_
Vercel serverless function with its own process memory, so `/ready` can never observe whether that
function's warm-instance model cache is populated, and there is no single fixed "the" model to
preload - Render resolves and sends the artifact per request, and Vercel is intentionally not a
model registry. Real per-request model readiness is proven end-to-end through Render's `/health/ai`,
which resolves the runtime binding, mints a signed artifact URL, and performs a real inference call
against Vercel.

For a live proof that goes further than a compiled build - a real GGUF file, the real
`node-llama-cpp` native binding, and the real `createVercelInferenceHandler` request handler, all
run locally without deploying anything - see `pnpm inference:live-probe`
(`scripts/ai-runtime-live-inference-probe.mjs`). It downloads a GGUF you point it at, serves it from
a throwaway local HTTP server standing in for Neon object storage, and asserts two real inference
calls succeed with non-empty generated text - the second reusing the warm model cache
(`cacheHit: true`), proving the caching behavior with the real runtime, not a mock.

Roll out in this order:

0. before touching Neon/Vercel/Render at all, run `pnpm inference:live-probe` locally against a
   downloaded copy of the target GGUF file - it proves node-llama-cpp can actually load and run
   that exact file before spending time on the rest of the rollout;
1. upload the GGUF artifact to Neon object storage at the object key `cp2_model_artifacts` expects
   (migration 079's seed row, or a new row for a different model) - verify its real byte size and
   SHA-256 first (`sha256sum`) and make sure both match the `cp2_model_artifacts` row exactly;
   `size_bytes` must be the artifact's _actual_ size, not an estimate (migration 080 corrected an
   estimated placeholder that would have made every real download fail `ARTIFACT_SIZE_MISMATCH`);
2. deploy `services/ai-runtime` to Vercel; run `pnpm inference:health` against the new
   `VERCEL_INFERENCE_URL` to confirm the deployment is live;
3. set `VERCEL_INFERENCE_URL`, `SOKO_INFERENCE_SERVICE_TOKEN`, and the `NEON_MODEL_STORAGE_*`
   variables on the Render API and deploy it;
4. run `pnpm inference:probe` (hits Render's `/health/ai`) to prove the full path: Render resolves
   the binding, signs the artifact URL, and Vercel downloads/verifies/loads/generates;
5. run a fresh-account/shop/conversation first-chat smoke test through the real `/v1/messages` API;
6. confirm the tenant's runtime binding records Pi, `smollm2-360m`, and execution host `vercel`
   (`GET /businesses/:id/runtime/effective`);
7. send a second chat turn and confirm `cacheHit: true` in Vercel's structured
   `inference.completed` log line, proving the warm-instance model cache is working.

## Verification

```sh
pnpm build:production
SOKO_LIVE_GGUF_PATH=/path/to/model.gguf pnpm inference:live-probe
VERCEL_INFERENCE_URL=https://<deployment>.vercel.app pnpm inference:health
SOKO_API_URL=https://api.soko.market pnpm inference:probe
pnpm verify:production-runtime
```

`pnpm verify:production-runtime` proves the actual `POST /v1/messages` flow end to end, not only
mocked adapter tests - it requires `SOKO_API_URL`, `VERCEL_INFERENCE_URL`, `SOKO_TEST_TOKEN`, and
`SOKO_TEST_SHOP_ID` for a real authenticated account.

## Failure and rollback

Production sets `INFERENCE_REQUIRED=true`, so API readiness fails while the promised zero-setup
default host/model is unavailable. An emergency commerce-only rollback may explicitly set it to
`false`; turns bound to the unavailable execution target then fail with normalized retryable
runtime errors, and Soko does not silently substitute a provider/model.

Rollback options are independent:

- clear `VERCEL_INFERENCE_URL` to detach the adapter while leaving the Vercel deployment for
  diagnosis (no adapter is registered under `vercel:*` when the URL is empty);
- change the platform agent adapter from Pi to another registered adapter;
- change the platform model/artifact mapping and bootstrap model
  (`PLATFORM_DEFAULT_MODEL_ID`, a new `cp2_model_artifacts` row);
- roll back the Vercel deployment to a previous version through the Vercel dashboard/CLI
  independently of the Render API's deploy state - the two platforms deploy independently by
  design.

Never delete a `cp2_model_artifacts` row that a live binding still references. Never place the
service token or Neon storage credentials in a browser-facing variable, database row, command
output, or log bundle.
