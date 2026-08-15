# Deploying inference on Cloudflare Workers AI

## 1. Why Cloudflare Workers AI

Soko's backend-inference fallback previously ran only on a paid Render private service
(`soko-market-inference`, documented in [render-inference.md](./render-inference.md)). Render
private services require at least the `standard` plan, which is not available on a free-tier
Render account. `services/cloudflare-inference` implements the same backend-inference HTTP
protocol on Cloudflare Workers, calling Cloudflare's own hosted models through the Workers AI
binding (`env.AI`) instead of a self-managed Ollama container. Cloudflare Workers AI has a daily
free allocation (10,000 Neurons/day at the time of writing), so this is deployable without a paid
plan on either platform.

Both implementations are interchangeable from `soko-market-api`'s point of view: it only knows
about `BACKEND_INFERENCE_BASE_URL`, `INFERENCE_SERVICE_TOKEN`, and `BACKEND_INFERENCE_MODEL_ID`.
Switching providers is a configuration change, not a code change.

## 2. Architecture

```text
Browser / local inference
        |
        +-- succeeds --> response
        |
        +-- backend fallback
                 |
                 v
             Soko API (governed runtime: auth, context, tools, confirmation, DB)
                 |
                 v  HTTP, Bearer token, same protocol as services/ai-runtime
      Cloudflare inference Worker  (services/cloudflare-inference)
                 |
                 v  env.AI.run(...)
          Cloudflare Workers AI
                 |
                 v  normalized { ok, text, usage, ... }
          Soko API parser / policy / tool runtime
```

The Worker performs inference only:

- It resolves a Soko logical model id (e.g. `cloudflare-backend-default`) to a Cloudflare model id
  through `@soko/shared-types`'s `runtimeModels` registry — the same registry
  `services/ai-runtime` uses for its own Ollama mapping — rather than a second, duplicated table.
- It returns plain text; it does not parse tool calls, assemble business context, apply agent
  instructions, retrieve memory, resolve authorization, or execute tools. All of that stays in the
  Soko API's governed runtime (`packages/tool-core`'s `parseRuntimeModelOutput`,
  `runtimeToolRegistry`, policy, and confirmation flow), unchanged.
- If a model's raw output happens to contain a tool proposal (as JSON text, per
  `renderRuntimeModelOutputInstructions`), the Worker returns that text as-is; the Soko API parses
  and authorizes it exactly as it does for the Render/Ollama backend.

## 3. Cloudflare account setup

1. Create a Cloudflare account (free tier is sufficient) at <https://dash.cloudflare.com/sign-up>.
2. Workers AI is enabled by default for new accounts; no separate product activation is required.
3. Authenticate Wrangler locally:
   ```bash
   pnpm --filter @soko/cloudflare-inference exec wrangler login
   ```
4. Confirm you're authenticated against the right account:
   ```bash
   pnpm --filter @soko/cloudflare-inference exec wrangler whoami
   ```

## 4. Workers AI binding

`services/cloudflare-inference/wrangler.jsonc` declares the binding:

```jsonc
{
  "name": "soko-cloudflare-inference",
  "main": "src/index.ts",
  "ai": { "binding": "AI" }
}
```

This makes `env.AI.run(modelId, inputs, options)` available inside the Worker
(`services/cloudflare-inference/src/inference.ts`) with no separate API key — Workers AI billing
and auth are scoped to the Cloudflare account the Worker is deployed under. The default model is
`@cf/meta/llama-3.2-1b-instruct` (a small, low-cost instruct model with a 60,000-token context
window and stable JSON-mode support), registered as the `cloudflare-backend-default` logical model
in `packages/shared-types/src/index.ts`. Override it per-deployment with the `CLOUDFLARE_AI_MODEL`
var — see [.dev.vars.example](../../services/cloudflare-inference/.dev.vars.example) for the
drift-guard caveat (the override must stay in sync with the registry's `providerModelId`, or the
API client will reject responses as a `MODEL_IDENTITY_MISMATCH`).

## 5. `INFERENCE_SERVICE_TOKEN`

The Worker authenticates every request with the same `Authorization: Bearer <token>` contract
`services/ai-runtime` uses, comparing SHA-256 digests in constant time
(`services/cloudflare-inference/src/auth.ts`). It is a **secret**, not a plain var:

```bash
pnpm --filter @soko/cloudflare-inference exec wrangler secret put INFERENCE_SERVICE_TOKEN
```

Generate a random value of at least 32 characters (for example `openssl rand -hex 32`) and set the
identical value on `soko-market-api`'s `INFERENCE_SERVICE_TOKEN` environment variable. Never add it
to a `VITE_*` variable or any frontend-reachable configuration — the Worker rejects requests
without it, and the Soko API is the only party that should hold it.

## 6. Local development

```bash
cp services/cloudflare-inference/.dev.vars.example services/cloudflare-inference/.dev.vars
# edit .dev.vars: set INFERENCE_SERVICE_TOKEN to a local test value (32+ characters)
pnpm --filter @soko/cloudflare-inference dev
```

`wrangler dev` runs the Worker locally (with real access to Workers AI, billed against your
account's free allocation) at `http://127.0.0.1:8787` by default. Point a local API instance at it:

```dotenv
BACKEND_INFERENCE_ENABLED=true
BACKEND_INFERENCE_BASE_URL=http://127.0.0.1:8787
BACKEND_INFERENCE_MODEL_ID=cloudflare-backend-default
INFERENCE_SERVICE_TOKEN=<same value as .dev.vars>
```

## 7. Deployment

From the repository root — no `cd` into the package required:

```bash
pnpm --filter @soko/cloudflare-inference build    # tsc --noEmit type check
pnpm --filter @soko/cloudflare-inference deploy    # wrangler deploy
```

`deploy` prints the Worker's `https://soko-cloudflare-inference.<your-subdomain>.workers.dev` URL
(or a configured custom domain, if one is added to `wrangler.jsonc` later). Wrangler is pinned to
an exact version in `services/cloudflare-inference/package.json`'s `devDependencies` so `deploy`
never installs an arbitrary latest version; do not run `npx wrangler` for production deploys.

Wrangler 4.85.0 is pinned specifically because it is the newest release that still supports Node
20.19.0 — the version the rest of this monorepo (and Render's `soko-market-api`) is pinned to.
Newer Wrangler releases require Node 22. If you upgrade Wrangler, do it only inside
`services/cloudflare-inference`'s own `package.json`; do not raise the root `engines.node` range,
which would affect the Render API build unrelated to this Worker. Cloudflare's own build
infrastructure (if you connect this repository via Cloudflare's Git integration instead of running
`wrangler deploy` from CI) manages its own Node version independently of Render's.

## 8. Cloudflare dashboard build settings

If connecting the whole `soko.market` repository to Cloudflare's Git integration (rather than
deploying via `wrangler deploy` from your own CI), use exactly these commands so it does not build
the entire monorepo:

```text
Build command:
pnpm --filter @soko/cloudflare-inference build

Deploy command:
pnpm --filter @soko/cloudflare-inference deploy
```

Do not use `pnpm run build` (builds every workspace package) or `npx wrangler deploy` from the
repository root (bypasses the pinned Wrangler version and the package's own `wrangler.jsonc`
working directory).

## 9. Render environment variables

Set these on `soko-market-api` (already reflected in `render.yaml`, where `BASE_URL` and the token
are `sync: false` placeholders you fill in from the Render dashboard after deploying the Worker):

```dotenv
BACKEND_INFERENCE_ENABLED=true
BACKEND_INFERENCE_BASE_URL=https://soko-cloudflare-inference.<your-subdomain>.workers.dev
BACKEND_INFERENCE_CONNECT_TIMEOUT_MS=5000
BACKEND_INFERENCE_TIMEOUT_MS=90000
BACKEND_INFERENCE_REQUIRED=false
BACKEND_INFERENCE_MODEL_ID=cloudflare-backend-default
INFERENCE_SERVICE_TOKEN=<same value set via `wrangler secret put`>
```

`BACKEND_INFERENCE_REQUIRED=false` is a deliberate choice, not the Render/Ollama default: Cloudflare
is fallback infrastructure behind browser-local and cloud-fallback inference, and Render's own
`/health/ready` should not report the whole API unavailable just because the Worker is briefly
unreachable. Set it to `true` only if your deployment has no other inference path and must fail
closed when the Worker is down.

## 10. Health verification

```bash
curl -s https://soko-cloudflare-inference.<your-subdomain>.workers.dev/health/ready \
  -H "Authorization: Bearer $INFERENCE_SERVICE_TOKEN" | jq .
```

Expect `{"ok":true,"engine":"cloudflare-workers-ai","models":[{"id":"cloudflare-backend-default",...,"available":true}]}`.
Readiness does not invoke inference (no Neurons spent) — it only confirms the binding and token are
configured, matching how `services/ai-runtime`'s `/health/ready` avoids calling `generate()`.

Then check the API's own aggregate readiness:

```bash
curl -s https://api.soko.market/health/ready | jq .inference
```

## 11. End-to-end inference verification

A real probe call (spends a small number of Neurons):

```bash
curl -s -X POST \
  https://soko-cloudflare-inference.<your-subdomain>.workers.dev/v1/models/cloudflare-backend-default/probe \
  -H "Authorization: Bearer $INFERENCE_SERVICE_TOKEN" | jq .
```

Expect `{"ok":true,"modelId":"cloudflare-backend-default","providerModelId":"@cf/meta/llama-3.2-1b-instruct",...}`.
Then exercise a full chat turn through the deployed API (owner session required) and confirm
`turn.model.provider` reports `"cloudflare-workers-ai"` and `turn.model.status` is `"completed"`.

## 12. Rollback to Render/Ollama

1. Uncomment the `soko-market-inference` block in `render.yaml` (see the comment directly above it)
   and restore `BACKEND_INFERENCE_BASE_URL` / `INFERENCE_SERVICE_TOKEN` on `soko-market-api` to
   their `fromService` form, per [render-inference.md](./render-inference.md).
2. Set `BACKEND_INFERENCE_MODEL_ID=qwen2.5-0.5b-android` and `BACKEND_INFERENCE_REQUIRED=true` (or
   your prior value).
3. Re-apply the Blueprint. This requires a paid Render plan for the private service.
4. Optionally leave the Cloudflare Worker deployed — it costs nothing idle — or run
   `pnpm --filter @soko/cloudflare-inference exec wrangler delete` to remove it.

Because both providers implement the same protocol, no Soko API code changes are needed either
direction; only the environment variables above change.

## 13. Free-tier limitations and rate-limit behavior

Cloudflare Workers AI's free allocation is shared across every model call on the account (currently
10,000 Neurons/day, resetting at 00:00 UTC) and Cloudflare may throttle or reject requests once
exhausted. When the underlying `env.AI.run()` call fails for a rate-limit-shaped reason, the Worker
returns HTTP `429` with `{"error":{"code":"MODEL_GENERATION_FAILED","retryable":true}}`
(`services/cloudflare-inference/src/errors.ts`'s `classifyProviderError`) — the Soko API's backend
client already treats HTTP `429` as retryable regardless of the specific code, so this surfaces as
a transient failure, not a hard error, and the API's fallback chain (browser-local → backend →
cloud fallback, per `INFERENCE_CLOUD_FALLBACK_ENABLED`) can absorb it. There is no autoscaling
mitigation on Soko's side for this; if the free allocation is consistently insufficient for
production traffic, Cloudflare's paid Workers AI usage (billed per-Neuron beyond the free tier) is
the intended next step, requiring no further code change.

## 14. Difference between the Worker and the Soko governed runtime

The Worker is a transport, not an agent. Everything that makes Soko's agent runtime "governed" —
authorization, context resolution, MCP wiring, the tool registry, policy checks, confirmation
prompts, and all database access — lives exclusively in the Soko API
(`services/api/src/cp2`, `packages/tool-core`, `packages/business-core`) and is unaffected by which
backend-inference provider is configured. The Worker never sees a database credential, never
executes a tool, and never makes a business-state write; it receives an already-assembled prompt
string and returns already-generated text, exactly like the Render/Ollama service it can replace.
