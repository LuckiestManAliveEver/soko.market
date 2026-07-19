# Native llama.cpp bridge

The web application never attempts to run native llama.cpp directly. It feature-detects
`globalThis.sokoNativeInference`, validates the required methods, and otherwise uses a safe
unavailable bridge.

An installed Capacitor, Tauri, Electron, or Android shell may expose:

- `getStatus()`
- `listModels()`
- `loadModel(modelId)`
- `generate(request, onChunk)`
- `cancel(requestId)`

The shell must validate every field against the shared inference contracts. Model IDs resolve
through an app-owned allow-list; remote callers may not supply arbitrary file paths. The bridge
must expose no shell command, filesystem, database credential, or general code-execution
primitive.

For a loopback transport, bind to loopback only, authenticate every request with an app-generated
short-lived token, restrict allowed origins to the installed app origin, reject replay, and rotate
the token when the app restarts. Never accept a job for another tenant or an agent not assigned to
the device.

Native inference remains behind `VITE_INFERENCE_NATIVE_BRIDGE_ENABLED` plus per-user permission.
Detection alone is not consent.
