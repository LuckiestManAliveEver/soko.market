# Render inference boundary

Production uses the private `soko-market-inference` service declared in `render.yaml`. The public
API receives only its Render-private host/port and a generated service token. Ollama and its model
disk exist only inside the inference container; neither Ollama's port, the private service, nor the
token is exposed to the PWA.

The API remains the authenticated control plane for sessions, business data, message persistence,
tool allow-lists, authorization, confirmation and audit. Model output is untrusted input to that
boundary. The inference service has no business-data or tool-execution authority.

`pnpm check:render-inference-boundaries` enforces separation: API source cannot import a local
model engine, the Blueprint must use a private Docker service and persistent model disk, and no
browser environment variable may contain the inference token.

The default backend path is Pi plus canonical model `smollm2-360m`, mapped at the provider edge to
Ollama tag `smollm2:360m-instruct-q4_0`. Other agent adapters, models and execution targets remain
valid explicit selections. There is no implicit provider substitution.

Operational configuration, verification and rollback are in
[backend-inference-render.md](./backend-inference-render.md). Architecture and precedence are in
[swappable-agent-model-runtime.md](../architecture/swappable-agent-model-runtime.md).
