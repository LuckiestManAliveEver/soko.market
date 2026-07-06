# CP11 Local Model Setup

CP11 supports a llama.cpp-compatible local model adapter behind the CP10 runtime contract.

The project does not download, license, quantize, or tune model files automatically. Operators choose and place model artifacts outside this repository.

## Android 2GB Profile

Use a predownloaded small open-source GGUF model outside this repository. The
default Soko local profile is:

```text
qwen2.5-0.5b-instruct-q4_0-android-2gb
```

Recommended artifact shape:

```text
Qwen2.5-0.5B-Instruct Q4_0 GGUF
```

This profile is intended for constrained Android devices around 2GB RAM. Keep
context and output short so the operating system, app shell, llama.cpp runtime,
and model weights can coexist.

Suggested llama.cpp server flags:

```bash
llama-server \
  --model /path/to/Qwen2.5-0.5B-Instruct-Q4_0.gguf \
  --host 127.0.0.1 \
  --port 8080 \
  --ctx-size 1024 \
  --threads 2
```

Then enable the adapter for the API:

```text
LOCAL_MODEL_ENABLED=true
LOCAL_MODEL_ENDPOINT=http://127.0.0.1:8080
LOCAL_MODEL_PROFILE=qwen2.5-0.5b-instruct-q4_0-android-2gb
LOCAL_MODEL_TIMEOUT_MS=8000
LOCAL_MODEL_MAX_TOKENS=128
LOCAL_MODEL_TEMPERATURE=0
```

## Expected Local Server

Run a llama.cpp-compatible HTTP server that exposes `/completion`.

Example shape:

```bash
llama-server --model /path/to/model.gguf --host 127.0.0.1 --port 8080
```

Then configure the runtime adapter with:

```text
endpoint: http://127.0.0.1:8080
timeoutMs: 8000
temperature: 0
maxTokens: 128
```

The adapter normalizes the endpoint to `/completion`.

## Output Contract

The local model must return only one JSON object in `content`.

Tool proposal:

```json
{ "type": "tool", "toolName": "products.list", "input": {}, "reason": "List products." }
```

Clarification:

```json
{ "type": "clarification", "message": "Which product should I draft?" }
```

Read-only response:

```json
{ "type": "response", "message": "I can help with products, invoices, payments, and imports." }
```

Unsupported tools, malformed JSON, timeouts, unavailable adapters, and empty completions fall back to deterministic CP10 runtime behavior.

## Safety Boundaries

- Prompt context uses business-scoped counts and role metadata, not full product, customer, supplier, invoice, payment, or import records.
- Model output is parsed into bounded runtime shapes before verification.
- Business mutations still route only through deterministic validators and tool adapters.
- High and critical risk tools still require explicit confirmation.
- Runtime telemetry records adapter status, latency, error codes, and fallback decisions without raw prompt or output text.
