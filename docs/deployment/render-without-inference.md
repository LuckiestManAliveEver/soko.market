# Operating Render while inference is unavailable

This runbook replaces the former “Render without inference” topology. The private inference
service is now part of the production Blueprint, but API availability is intentionally independent
from model readiness.

`BACKEND_INFERENCE_REQUIRED=false` means authentication, catalogue, ordering, messaging and
governed non-model operations remain online while Ollama starts, pulls a model, or is unavailable.
Affected turns return normalized retryable runtime errors; the API does not silently choose a
different model/provider.

For a planned inference outage:

1. keep the inference disk and generated service token intact;
2. set `BACKEND_INFERENCE_ENABLED=false` on the API or deploy the previous application build;
3. confirm `/health/ready` on the API remains healthy;
4. restore the inference service, run its authenticated `/health/ready` and model probe;
5. re-enable the API adapter and run a first-chat smoke test.

Do not copy `INFERENCE_SERVICE_TOKEN`, the private hostname, `OLLAMA_*`, or model filesystem paths
into any `VITE_*` variable. Browser-local, installed-app and owner-node runtimes remain separate
optional targets and are unaffected by a backend inference outage.

See [backend-inference-render.md](./backend-inference-render.md) for the full deployment runbook.
