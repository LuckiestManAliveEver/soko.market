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

Do not add an inference service to Render. That deployment is intentionally client-first and the
repository boundary checks enforce the absence of a Render-local Ollama service.
