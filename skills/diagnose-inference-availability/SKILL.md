---
name: diagnose-inference-availability
description: Diagnose Soko model-runtime unavailable or unreachable reports without confusing an intentionally unconfigured execution target with a network outage. Use for Soko inference health, model test, activation, and deployment-capability incidents.
---

# Diagnose Soko inference availability

Treat the API error code and the deployed execution-target contract as the sources of truth. A
catalogue model being downloadable does not mean a backend adapter is configured.

1. Read `docs/deployment/render-inference.md` and the active deployment manifest.
2. Locate the exact user-facing message and the request that produced it.
3. Capture the API error code before interpreting the failure.
4. Query `/health/ready`; inspect database and inference fields independently.
5. Check whether `BACKEND_INFERENCE_ENABLED`, its base URL, and its shared token are configured.
6. Confirm whether the model catalogue advertises `runtimeAvailability` for the requested target.
7. Classify `RUNTIME_NOT_CONFIGURED` as unconfigured and `INFERENCE_DISABLED` as disabled. Keep
   `RUNTIME_UNAVAILABLE` neutral because it can represent a configured runtime failure.
8. Reserve unreachable wording for `INFERENCE_SERVICE_UNREACHABLE`; report timeout,
   authentication, engine, model-installation, loading, storage, and response errors separately.
9. For self-hosted runtimes, use `pnpm inference:health` and `pnpm inference:probe` only after the
   required private URL and token are supplied. Do not expose the private runtime publicly.
10. Add a regression scenario to `tests/ai-eval/backend-runtime-status-scenarios.ts` whenever a new
    runtime error code reaches the UI.

Production already runs a private Render inference service (`soko-market-inference`, an
Ollama-backed Docker `pserv` declared in `render.yaml`, see `docs/deployment/render-inference.md`
and `docs/deployment/backend-inference-render.md`). `scripts/check-render-inference-boundaries.mjs`
enforces its _presence_ (required `render.yaml` fields, the private-service disk mount, the token)
and only blocks the API process itself from talking to Ollama/local model engines directly - it does
not forbid the service. Do not remove or bypass `soko-market-inference`, and do not reintroduce a
client-first/browser-only inference story; that architecture (WebLLM, Transformers.js, the native
GGUF bridge) was deliberately removed from `apps/web` in favor of the hosted-first Pi + SmolLM 360M
default. The docs under `docs/inference/webllm-runtime-contract.md`, `native-bridge.md`,
`model-manifest.md`, and `soko-web-inference-engine.md` describe that removed system and are
historical only.
