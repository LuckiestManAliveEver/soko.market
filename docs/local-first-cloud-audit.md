# Local-First Cloud Audit

Status: implementation inventory for `SOKO_RUNTIME_MODE=local`.

## KEEP_REQUIRED

- Neon Postgres: `DATABASE_URL`/`DIRECT_DATABASE_URL`; durable catalogue, accounts, runtime metadata, and business state remain Postgres-backed.
- GitHub: source control only, not an application runtime dependency.

## KEEP_OPTIONAL

- Local computer/browser automation can be reintroduced later as a localhost-only process. No remote computer runtime is supported.

## REPLACE_LOCAL

- Vercel inference: previous `VERCEL_INFERENCE_URL`/`SOKO_INFERENCE_SERVICE_TOKEN` API-to-ai-runtime path is replaced in local mode by direct Ollama access.
- Hosted/model object storage: `NEON_MODEL_STORAGE_*` is bypassed in local mode; Ollama owns local model files.
- Redis/render key-value: replaced by process memory for local rate-limit and transient inference counters with `LOCAL_CACHE_MODE=memory`.
- OCR worker runtime: removed from API infrastructure. OCR may return later only as a model/tool capability that supplies trusted extracted text.

## REMOVE

- Runtime support for Render services, Render private hostnames, Render deploy webhooks, hosted Redis, hosted OCR, local OCR worker, hosted ZeroClaw, Vercel AI runtime, remote inference relay, Neon model object storage, OpenAI, Anthropic, Z.ai, Gemini, Hugging Face hosted inference, hosted llama.cpp, and paid/provider-routed cloud inference.
- Cloud/provider env vars now fail fast at API boot instead of being interpreted as optional integrations.
- Failed Ollama inference reports local unavailability rather than falling back to any hosted provider.

## HISTORICAL_ONLY

- `render.yaml`, `deployment.md`, `.do/inference.yaml`, `docs/deployment/**`, `docs/runtime/vercel-inference-audit.md`, and `services/ai-runtime/**` are historical/retired artifacts and are no longer part of the active workspace or local runtime.

## Findings By Area

- Boot-time cloud dependencies: `services/api/src/config.ts` previously made `VERCEL_INFERENCE_URL` canonical when `INFERENCE_REQUIRED=true`, required `NEON_MODEL_STORAGE_*` when Vercel was configured, and defaulted Redis in non-production. Local mode now makes Ollama the only inference provider and memory the only cache mode.
- Runtime cloud dependencies: provider integrations are removed from API startup. `OPENAI_*`, `ANTHROPIC_*`, `ZAI_*`, `HF_*`, `VERCEL_*`, `ZEROCLAW_*`, `REDIS_URL`, Render webhook, and remote computer runtime variables are rejected.
- Build-time cloud dependencies: Vercel/Render docs and scripts remain historical/production. Local build should not require cloud credentials.
- Health/readiness dependencies: readiness may require inference only when `INFERENCE_REQUIRED=true`; local inference health checks Ollama `/api/tags`.
- Frontend dependencies: development should use localhost API configuration or Vite proxy; hard-coded `soko.market` references are brand/public URL defaults and production docs unless used for runtime API calls.
- Inference dependencies: local runtime uses `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, and `LOCAL_INFERENCE_TIMEOUT_MS`; Vercel and Neon artifact storage are not part of local mode.
- Authentication dependencies: localhost origins must be allowed through `WEB_ORIGINS`; cookies should use `COOKIE_SECURE=false` in local env.
- OCR dependencies: no OCR worker is configured or started by the API. Receipt/product tools can still use caller-supplied extracted text.
- Caching/rate-limit dependencies: `LOCAL_CACHE_MODE=memory` avoids Redis for local startup.
- Object-storage dependencies: conversation/file storage remains separate; model artifact object storage is bypassed locally.
- Agent-runtime dependencies: built-in Soko runtime remains available; ZeroClaw is optional.
