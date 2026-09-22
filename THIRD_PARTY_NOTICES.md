# Third-party notices

## Receipt OCR

The receipt OCR worker is self-hosted and uses the following third-party components:

- PaddleOCR 2.8.1 — Apache 2.0 — primary OCR engine.
- PaddlePaddle 2.6.2 — Apache 2.0 — PaddleOCR runtime.
- Tesseract OCR — Apache 2.0 — fallback OCR engine.
- pytesseract 0.3.13 — Apache 2.0 package wrapper — Python integration for Tesseract.
- Pillow 10.4.0 — HPND-style Pillow license — image loading for fallback OCR.
- OpenCV Python headless 4.10.0.84 — Apache 2.0 — image processing dependency.
- redis-py 5.0.8 — MIT — queue/client support.

No required paid OCR API is used by the default production receipt OCR flow.

## Authentication

- libphonenumber-js 1.13.9 — MIT — E.164 parsing and normalization.
- @simplewebauthn/server 13.3.2 — MIT — WebAuthn/passkey ceremony validation.
- @simplewebauthn/browser 13.3.0 — MIT — browser passkey ceremony support.

Phone numbers are normalized only; the authentication system does not perform SMS verification.

## Computer runtime (browser automation)

- Playwright 1.61.1 — Apache License 2.0 — drives the isolated Chromium instance inside
  `services/computer-worker` (docs/architecture/computer-runtime.md). Used as a library
  dependency and through its `mcr.microsoft.com/playwright` base Docker image; no Playwright
  source was copied into this repository. Chromium itself is distributed under the BSD-style
  Chromium license via that same base image.
- Fastify 5.x — MIT — already a direct dependency of `@soko/api`; reused unmodified as the
  computer worker's own minimal HTTP server.

No code from Stagehand, Browser Use, Browser Use Web UI, Open Operator, Skyvern, or BrowserCode
was copied into this repository. Those projects were reviewed only as architectural references
(see `docs/adr/ADR-computer-runtime-ownership.md`) for the provider-adapter and human-takeover
patterns; Soko's `ComputerRuntimeProvider` contract (`packages/computer-runtime/src/provider.ts`)
is an original, provider-neutral interface, and the shipped provider talks to Playwright directly
rather than depending on any of those frameworks' own libraries.

## Optional on-device AI models

Soko can download these optional GGUF weights directly from Hugging Face into private device
storage. The weights are not distributed in this repository or uploaded to Soko:

- HuggingFaceTB SmolLM2 360M Instruct GGUF — Apache License 2.0.
- Qwen Qwen2.5 0.5B Instruct GGUF — Apache License 2.0.
- Qwen Qwen2.5 1.5B Instruct GGUF — Apache License 2.0.

The in-app catalog links to each upstream model card and license. Custom models are user-supplied;
their licenses and commercial-use terms remain the user's responsibility.
