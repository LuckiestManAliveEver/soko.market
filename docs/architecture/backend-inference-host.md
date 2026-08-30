# Backend inference host

## Boundary

`services/ai-runtime` is Soko's only backend inference facade. The API never imports Ollama or a
GGUF loader, and the PWA never calls Ollama. The production path is:

```text
Soko PWA -> public Soko API -> private authenticated ai-runtime -> loopback Ollama -> model
```

The ai-runtime process exposes its service port on `0.0.0.0`. Ollama binds to
`127.0.0.1:11434` inside the same container and is not exposed by the Docker image or Render.

## Identity mapping

The canonical model registry maps identity independently from execution:

```text
Soko model:       smollm2-360m
provider:         ollama
provider model:   smollm2:360m-instruct-q4_0
target:           backend (from the binding/host, not the model name)
```

The Ollama tag was verified against the Ollama library: it is the 362M instruct model using Q4_0,
approximately 229 MB with an 8192-token context window. The legacy
`smollm2-360m-android` ID remains an alias for persisted references; new backend/default records
use the provider-neutral ID.

## Authentication and routes

`/health/live` is a deliberately lightweight unauthenticated process liveness endpoint. Every
readiness/model/inference route requires `Authorization: Bearer <INFERENCE_SERVICE_TOKEN>`:

- `GET /health/ready`
- `GET /v1/models`
- `POST /v1/models/:id/probe`
- `POST /v1/chat/completions`

The token is generated and held in Render service configuration. It never appears in PWA/Vite
configuration, localStorage, database catalog rows, native model metadata, logs or telemetry.
Constant-time digest comparison is used for bearer validation.

## Storage and startup

`MODEL_STORAGE_PATH=/var/lib/soko-models` is the persistent mount and
`OLLAMA_MODELS=/var/lib/soko-models/ollama` stores Ollama's content-addressed blobs beneath it.
Neon contains metadata only.

The container supervisor:

1. creates the persistent model directory;
2. starts one loopback Ollama process;
3. waits for Ollama readiness with a bounded timeout;
4. checks whether the configured provider model is already present;
5. pulls it only when absent and bootstrap installation is enabled;
6. starts the authenticated ai-runtime process;
7. exits if either required process exits; and
8. forwards termination and waits for both children.

A restart with an intact disk follows the presence branch and does not download the model again.

## Health semantics

- API liveness: the public API process accepts requests.
- Database readiness: the API's normal `/health/ready` database check.
- Inference liveness: the private facade process is running.
- Inference readiness: durable storage is configured and the canonical primary model is installed.
- Model probe: a real generation returns the required marker.

The public API never makes inference readiness a process-start requirement when
`BACKEND_INFERENCE_REQUIRED=false`. Catalogue, authentication, orders and messaging remain
available during inference restart or model loading.

## Trust and tools

The inference host receives a bounded prompt and canonical model ID. It receives no database
credentials and has no business-data mutation API. Model output returns to the API as untrusted
text. The Soko API performs parsing, allow-list checks, authorization, confirmation, execution and
audit logging.
