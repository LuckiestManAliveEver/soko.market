# Agent model runtime connection

Soko keeps one business agent and one messenger pipeline. Installed GGUF files live in OPFS under
the existing `soko-ai-models` private directory. The browser stores a device-scoped installation
record and assignment; the API stores only safe installation metadata and the assignment. A raw
Android filesystem path is never sent to the API or telemetry.

## Runtime boundary

The web application calls `window.SokoAgentModelRuntime`, an Android-injected llama.cpp bridge with
`inspect`, `load`, `generate`, `unload`, and `health` operations. Descriptors contain an opaque OPFS
storage key, not a native path. The PWA does not claim readiness when that bridge is absent:
installation can still complete, but attach/test reports `RUNTIME_UNAVAILABLE`.

The bridge should:

- resolve the opaque storage key through app-private storage;
- limit context to the descriptor/context request and use conservative thread counts;
- inspect available memory before allocating model buffers;
- keep one loaded conversational model and single-flight duplicate loads;
- honor cancellation and release native buffers on unload or process teardown;
- return safe error codes without logging prompts, messages, private paths, or customer data.

Readiness is established only by real inference of `Reply with exactly: SOKO_MODEL_READY`. The
test result is configuration metadata and is not written into the customer conversation.

## Activation lifecycle and source of truth

Activation is a request-scoped finite state machine: `idle` → `validating` →
`creating_runtime` → `loading_model` → `binding_agent` → `active`, with terminal
`failed` and `offline_blocked` states. A request owns one `AbortController`; API operations are
bounded to 45 seconds and bridge loading emits `MODEL_LOAD_STARTED`, heartbeat/progress,
`MODEL_READY`, or `MODEL_LOAD_FAILED`. Cancelling, navigating away, a timeout, or a newer request
aborts the old request and prevents its stale completion from changing UI state.

The server assignment is the online source of truth. The device assignment is its scoped offline
mirror, keyed by business and device. The mirror is written only after the model file validates,
the runtime positively acknowledges readiness, and the hidden readiness inference succeeds. While
offline, a fully installed GGUF model can use the trusted native bridge and a `local:` runtime
session ID; that ready mirror is synchronized on reconnect. Server-only models stop in
`offline_blocked` and are never inserted into the business mutation queue.

Online activation probes the authenticated API instead of trusting `navigator.onLine`, creates or
restores a non-empty managed runtime session, and then persists the ready binding. A page reload
revalidates server runtime liveness through `RuntimeManager` and lazily reloads/tests the local
model. Failed activation never overwrites the previous ready assignment. Missing/corrupt OPFS bytes
change installation metadata to failed/corrupt and require a new download.

The application service worker handles interactive model/assignment/runtime mutations network
only. On connection failure it returns typed `interactive_model_offline` HTTP 503 JSON with
`Cache-Control: no-store`; it has no Background Sync handler and never caches authenticated model
activation responses.

## Manual Android/PWA verification

1. Install an Apache-2.0 GGUF from **Android model library** and confirm the UI says it is installed
   but not attached.
2. Reload the app and confirm the same installation appears without a duplicate file.
3. Open **Agent model** → **Choose model** and verify compatible models sort first, while
   incompatible/restricted models are disabled with a reason.
4. Tap **Use with this agent** with the native bridge disabled. Confirm activation fails with
   `RUNTIME_UNAVAILABLE`, no Ready label appears, and the previous assignment remains active.
5. Enable the Android llama.cpp bridge, attach again, and inspect native logs to confirm one load
   and one readiness generation. Confirm the UI reports the exact attached model as Ready.
6. Force-close and restart Android. Open Agent settings and confirm the device assignment is
   restored; send a message and confirm lazy runtime reinitialization.
7. Set **Local only**, disable networking, restart the app, and send a message. Confirm no API
   inference request occurs and the response status identifies `<model> · Local · In use`.
8. Set **Local first** with each fallback policy. Force the matching local error and confirm cloud
   inference happens only when the selected policy permits it, with a visible fallback reason.
9. Corrupt or delete the GGUF file. Confirm test/chat shows File missing or Failed without crashing
   the chat, and cloud is not used in Local only mode.
10. Switch between two installed models. Force the second model's readiness test to fail and
    confirm the first model remains assigned and its runtime handle is usable.
11. Remove the active model from the agent, then remove its file. Confirm native buffers unload,
    the assignment clears, and existing cloud behavior is restored.
12. Repeat on a low-memory Android device or emulator. Confirm unsafe loads stop with
    `INSUFFICIENT_MEMORY` and the application remains responsive.
13. Start activation and tap **Cancel activation**; confirm the button returns to retry and a late
    bridge/API response does not change the selected model.
14. With the PWA offline, activate a fully installed model and send a short chat message; confirm
    the native model supplies the visible reply. Then try a hosted fallback and confirm the exact
    “Connect to the internet to activate this model.” message appears with no queued mutation.

## Platform limitation

This repository does not contain an Android application/native llama.cpp implementation or a
browser GGUF engine. A normal browser PWA can install and validate a GGUF file in OPFS, but cannot
execute that GGUF until a supported `SokoAgentModelRuntime` bridge is provided.

Browser-local inference is a separate backend inside the same Soko agent router. It uses a
Transformers.js ONNX model through WebGPU or WASM and does not execute the installed GGUF. It is
disabled by default, requires explicit user consent, and preserves the native bridge as a fallback.
CI mocks only the heavy engine boundary; it does not fake a successful runtime in production.
