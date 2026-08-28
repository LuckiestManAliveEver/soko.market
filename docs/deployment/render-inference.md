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

The only model inference Render may perform is an explicitly selected cloud-provider model. There
is no automatic local-to-cloud escalation ("cloud fallback") anywhere in this codebase - see
docs/architecture/provider-neutral-runtime.md, "No implicit `"backend"` default". The current
provider boundary requires all of the following:

- `INFERENCE_CLOUD_PROVIDER=openai`;
- an allow-listed cloud model;
- a server-only provider key; and
- the shop owner explicitly activating that model for their agent (native runtime
  `ModelExecutionTarget: "openai"`, or the legacy `/api/agents/:agentId/models/:modelId/activate`
  route) - there is no separate "cloud consent" toggle; activating the model is the consent.

No prompt is ever sent to the cloud merely because a browser or backend model is slow, unavailable,
or fails - a failed model surfaces a routing error instead of silently retrying elsewhere.

## Enforcement

`pnpm check:render-inference-boundaries` fails if the Blueprint reintroduces a Render-local model
service, Ollama configuration, a backend inference URL, or local/browser model runtime imports in
the API. `tests/render-blueprint.test.ts` independently locks the deployment contract.

The `services/ai-runtime` package can remain as a non-Render development/self-hosting artifact. It
is not part of the production Render service graph.

See [Deploy Render without local inference](./render-without-inference.md) and
[Client-first inference architecture](../architecture/client-first-inference.md).
