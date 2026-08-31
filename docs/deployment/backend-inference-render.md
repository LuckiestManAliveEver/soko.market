# Deploy backend inference on Render

## Topology

`render.yaml` declares `soko-market-inference` as a Docker private service in Oregon, beside the
Oregon API. Render private services have no public URL. The API receives the service's private
`hostport` through a `fromService` reference and prefixes `http://` in API configuration. A shared
token is generated on the inference service and copied to the API through `fromService.envVarKey`.

The service uses `services/ai-runtime/Dockerfile` and exposes only the ai-runtime port. Ollama is
loopback-only inside the container.

## Required configuration

Inference service:

```text
NODE_ENV=production
AI_RUNTIME_HOST=0.0.0.0
PORT=<Render port>
INFERENCE_ENGINE=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_HOST=127.0.0.1:11434
MODEL_STORAGE_PATH=/var/lib/soko-models
MODEL_STORAGE_DURABLE=true
OLLAMA_MODELS=/var/lib/soko-models/ollama
MODEL_AUTO_INSTALL=true
SOKO_PRIMARY_MODEL_ID=smollm2-360m
SOKO_PRIMARY_PROVIDER_MODEL_ID=smollm2:360m-instruct-q4_0
INFERENCE_SERVICE_TOKEN=<generated>
```

API service:

```text
BACKEND_INFERENCE_ENABLED=true
BACKEND_INFERENCE_REQUIRED=true
BACKEND_INFERENCE_MODEL_ID=smollm2-360m
BACKEND_INFERENCE_BASE_URL=<private inference host:port reference>
INFERENCE_SERVICE_TOKEN=<copied generated secret>
```

The persistent disk is mounted at `/var/lib/soko-models`. Five GB leaves comfortable room for the
229 MB initial model, Ollama metadata and an operator-staged replacement; the disk may be grown but
not shrunk. A persistent disk belongs to one service instance, so horizontal inference scaling
requires an explicit replicated model-storage strategy and is outside this initial topology.

## Health and rollout

Private service health is checked through process liveness during deployment; authenticated
readiness and model probes are exercised by the deployment verification script because Render's
platform health probe cannot carry the bearer token.

Roll out in this order:

1. sync the Blueprint and allow the private service/disk/token to be created;
2. watch startup until Ollama is ready and the model presence/pull step succeeds;
3. call authenticated `/health/ready` and `/v1/models/smollm2-360m/probe` from trusted backend
   infrastructure;
4. deploy/start the API with the private host reference;
5. verify API readiness remains healthy;
6. run a fresh-account/shop/conversation first-chat smoke test;
7. confirm the tenant binding records Pi, SmolLM and the backend host;
8. restart inference, verify the presence branch skips downloading, then repeat readiness/chat.

The first model pull can take longer than an ordinary restart. Startup errors are fatal and name
the failed phase without printing the token.

## Verification

Use the repository's production checks plus:

```sh
pnpm build:production
docker build -f services/ai-runtime/Dockerfile -t soko-ai-runtime .
INFERENCE_BASE_URL=http://<private-host> \
INFERENCE_SERVICE_TOKEN=<token> pnpm inference:health
INFERENCE_BASE_URL=http://<private-host> \
INFERENCE_SERVICE_TOKEN=<token> \
SOKO_MODEL_ID=smollm2-360m pnpm inference:probe
pnpm verify:production-runtime
```

The deployment smoke test must prove model persistence by checking startup logs before and after a
restart and must verify the actual `POST /v1/messages` flow, not only mocked adapter tests.

## Failure and rollback

Production sets `BACKEND_INFERENCE_REQUIRED=true`, so API readiness fails while the promised
zero-setup default host/model is unavailable. An emergency commerce-only rollback may explicitly
set it to `false`; turns bound to the unavailable backend then fail with normalized retryable
runtime errors, and Soko does not silently substitute a provider/model.

Rollback options are independent:

- set `BACKEND_INFERENCE_ENABLED=false` to detach the adapter while leaving the service/disk for
  diagnosis;
- change the platform agent adapter from Pi to another registered adapter;
- change the platform model/provider mapping and bootstrap model;
- roll back the API build while retaining forward-compatible alias/catalog rows.

Never delete the disk as part of an application rollback. Never place the service token in a
browser-facing variable, database row, command output or log bundle.
