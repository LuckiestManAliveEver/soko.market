# Render inference boundary

## Production rule

Render is not a local-model runtime. `render.yaml` provisions no Ollama/private inference service,
model disk, model downloader, or `BACKEND_INFERENCE_*` connection. The API stores verified OSS
agent manifests and account backup copies of GGUF files in the existing Neon database, but Render
never loads or executes those files. Device inference still runs from a private local copy; the
separate WebGPU/WASM browser-model cache remains device-local and runs in the browser worker.

The Render API remains the authenticated control plane for sessions, business data, message
persistence, and governed tool execution. For a tool request, the browser may send its completed
structured proposal to the API for authorization and execution; the API does not regenerate that
proposal.

## Cloud models

The only model inference Render may perform is an explicitly enabled cloud-provider request. The
current provider boundary requires all of the following:

- `INFERENCE_CLIENT_FIRST=true`;
- `INFERENCE_CLOUD_FALLBACK_ENABLED=true`;
- `INFERENCE_CLOUD_PROVIDER=openai`;
- an allow-listed cloud model;
- a server-only provider key; and
- explicit user consent and model selection in the client.

The browser deployment may keep `VITE_INFERENCE_CLOUD_FALLBACK_ENABLED=false` to make cloud routing
unavailable to users. No prompt is sent to the cloud merely because a browser model is slow,
unavailable, or fails.

## Enforcement

`pnpm check:render-inference-boundaries` fails if the Blueprint reintroduces a Render-local model
service, Ollama configuration, a backend inference URL, or local/browser model runtime imports in
the API. `tests/render-blueprint.test.ts` independently locks the deployment contract.

The `services/ai-runtime` package can remain as a non-Render development/self-hosting artifact. It
is not part of the production Render service graph.

See [Deploy Render without local inference](./render-without-inference.md) and
[Client-first inference architecture](../architecture/client-first-inference.md).
