# Deploying private inference on Render

> **This is now an optional backend-inference provider.** The currently deployed provider is
> Cloudflare Workers AI — see [Deploying inference on Cloudflare Workers](./cloudflare-workers-ai.md).
> Both implement the same backend-inference HTTP protocol (`GET /health/ready`, `GET /v1/models`,
> `POST /v1/models/:modelId/probe`, `POST /v1/chat/completions`), so `soko-market-api` only needs
> `BACKEND_INFERENCE_BASE_URL` / `INFERENCE_SERVICE_TOKEN` / `BACKEND_INFERENCE_MODEL_ID` repointed
> to switch between them. This document describes the Render/Ollama service `services/ai-runtime`
> implements; its `render.yaml` block is commented out by default because it requires a paid Render
> plan. Uncomment it (see the comment above the `soko-market-inference` block in `render.yaml`) to
> use it instead of, or in addition to, Cloudflare.

## Services

`render.yaml` defines:

- `soko-market-api`, the public Node API;
- `soko-market-inference`, a paid private Docker service in the same Oregon region (commented out
  by default — see the note above);
- a 10 GB persistent disk mounted at `/var/lib/soko-models`, used only when that service is enabled;
- the existing frontend and operational cron services.

The API uses the paid `starter` plan because Render's pre-deploy command is available only for paid
web services. That phase is where the Neon migration gate runs; a free API plan would silently
invalidate this deployment design. See [Deploying on Render](https://render.com/docs/deploys).

The private service runs the Soko gateway on Render's `PORT` and Ollama on container-local
`127.0.0.1:11434`. Only this colocated engine may use loopback. The API receives the private
service's `hostport` through Blueprint service discovery.

Render private services have stable private-network addresses and must be in the same workspace and
region as their consumers. Render currently performs TCP checks for private services rather than a
Blueprint HTTP `healthCheckPath`; therefore the Blueprint intentionally omits that field on the
`pserv`. The authenticated `/health/ready` route is still the operational readiness check. See
[Private Services](https://render.com/docs/private-services),
[Private Network](https://render.com/docs/private-network), and the
[Blueprint specification](https://render.com/docs/blueprint-spec).

## Packaging and restart behavior

`services/ai-runtime/Dockerfile` pins Ollama and builds the existing
`@soko/ai-runtime` package. `scripts/start-inference.sh`:

1. verifies the storage mount and free-space threshold;
2. starts Ollama and waits for its engine endpoint;
3. installs the configured provider model only when `MODEL_AUTO_INSTALL=true`;
4. starts the authenticated Soko gateway;
5. forwards termination signals and exits the container if either required process exits.

With `MODEL_STORAGE_DURABLE=true`, readiness fails if production is configured without durable
storage. Render persistent disks require a paid service, are single-instance, and cannot be shared
across scaled replicas. See [Persistent Disks](https://render.com/docs/disks).

The initial `qwen2.5:0.5b` pull can take several minutes. It is a deployment policy operation, never
an owner-UI side effect. Ollama records the model digest and downloads its layers atomically; the
gateway reports the model only after `/api/tags` lists the completed model.

### Deterministic production build graph

Render runs the root `pnpm build:production` command. Its workspace phase:

1. builds every package under `packages/**` in dependency order;
2. compiles `@soko/ai-runtime` with its dependency output already present;
3. compiles `@soko/api`;
4. runs the production import and Render boundary checks.

The API service's Render build command installs the frozen workspace, runs the database migration
once, and then runs this production build. There is no duplicate pre-deploy migration command.

The public `@soko/ai-runtime` build script also builds `@soko/shared-types` first, so a direct
`pnpm --filter @soko/ai-runtime build` works from a clean checkout. The root workspace phase uses
the runtime's package-only build after building `packages/**`, avoiding a duplicate shared-types
build. The API intentionally does not declare `@soko/ai-runtime` as a dependency: backend
inference is reached through the authenticated private-service protocol, and importing the engine
into the public API would violate the deployment boundary.

The previous `@soko/api^...` filter selected only the API's declared shared-package dependencies.
Because the runtime is an independent service, a clean Render checkout skipped its build while a
developer checkout with a stale `services/ai-runtime/dist` could pass validation. The explicit
workspace sequence now emits and validates:

```text
services/ai-runtime/dist/index.js
services/ai-runtime/dist/index.d.ts
services/ai-runtime/dist/server.js
services/api/dist/index.js
```

The `packages/**` selector means a new shared workspace package with a build script participates
without adding another manually ordered command. Package manifests remain the source of dependency
ordering.

## Required configuration

When this service is enabled (uncommented in `render.yaml`), restore its `fromService` linkage so
the Blueprint generates and copies `INFERENCE_SERVICE_TOKEN` from the private service to the API,
instead of the `sync: false` placeholders used for the Cloudflare-backed deployment. Do not add the
token to a `VITE_` variable or frontend environment.

API:

```dotenv
BACKEND_INFERENCE_ENABLED=true
BACKEND_INFERENCE_BASE_URL=<Render hostport service reference>
BACKEND_INFERENCE_CONNECT_TIMEOUT_MS=5000
BACKEND_INFERENCE_TIMEOUT_MS=90000
BACKEND_INFERENCE_REQUIRED=true
BACKEND_INFERENCE_MODEL_ID=qwen2.5-0.5b-android
INFERENCE_SERVICE_TOKEN=<generated shared secret>
INFERENCE_CLOUD_FALLBACK_ENABLED=false
```

Private inference:

```dotenv
INFERENCE_ENGINE=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_HOST=127.0.0.1:11434
OLLAMA_NO_CLOUD=true
OLLAMA_MODELS=/var/lib/soko-models/ollama
MODEL_STORAGE_PATH=/var/lib/soko-models
MODEL_STORAGE_DURABLE=true
MODEL_AUTO_INSTALL=true
SOKO_PRIMARY_MODEL_ID=qwen2.5-0.5b-android
SOKO_PRIMARY_PROVIDER_MODEL_ID=qwen2.5:0.5b
INFERENCE_REQUEST_TIMEOUT_MS=90000
INFERENCE_SERVICE_TOKEN=<same generated secret>
```

Generated service-linked environment variables are documented under Render
[environment variables](https://render.com/docs/configure-environment-variables).

## Deployment order

1. Create a Neon development/staging branch and configure its pooled and direct URLs.
2. Apply the Blueprint so the private service and disk exist.
3. Let the API pre-deploy command apply migrations.
4. Wait for `soko-market-inference` logs to show the engine and gateway listening.
5. Run the authenticated readiness and real probe commands in the verification guide.
6. Deploy/redeploy the API after its private URL and token references resolve.
7. Verify API readiness, then test, activate, reload, and chat through the PWA.

Do not expose the private service publicly. If the engine exits, the supervisor terminates the
service and Render restarts it; the disk preserves installed model layers.

## Resource guidance and logs

Start with the Blueprint's paid `standard` service and 10 GB disk, then size CPU/RAM from measured
load latency and resident memory. A 0.5B quantized model is intentionally the primary mapping, but
actual memory depends on Ollama's build, context size, and concurrency.

Inspect logs for request IDs, model IDs, provider model IDs, latency, and stable error codes. Tokens,
prompts, cookies, and authorization headers are not logged.
