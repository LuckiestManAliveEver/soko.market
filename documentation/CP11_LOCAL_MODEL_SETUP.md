# CP11 Local Model Setup

CP11 supports a llama.cpp-compatible local model adapter behind the CP10 runtime contract.

The browser model library can predownload curated GGUF weights into Android origin-private storage.
API operators still place the model served by their llama.cpp endpoint outside this repository.
The browser download is storage preparation only; the current PWA does not execute the GGUF file
itself.

## Android 2GB Profile

Use a predownloaded small open-source GGUF model outside this repository. The
default Soko local profile is:

```text
tinyllama-1.1b-chat-q4-k-m-android
```

Recommended artifact shape:

```text
TinyLlama-1.1B-Chat-v1.0 Q4_K_M GGUF
```

This profile is intended for constrained Android devices around 2GB RAM. Keep
context and output short so the operating system, app shell, llama.cpp runtime,
and model weights can coexist.

Suggested llama.cpp server flags:

```bash
llama-server \
  --model /path/to/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf \
  --host 127.0.0.1 \
  --port 8080 \
  --ctx-size 1024 \
  --threads 2
```

Then enable the adapter for the API:

```text
LOCAL_MODEL_ENABLED=true
LOCAL_MODEL_ENDPOINT=http://127.0.0.1:8080
LOCAL_MODEL_PROFILE=tinyllama-1.1b-chat-q4-k-m-android
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

A loopback endpoint is shown as a built-in llama.cpp option. A non-loopback endpoint is shown as
hosted. Both use the same bounded runtime contract, and the option remains disabled unless
`LOCAL_MODEL_ENABLED=true`.

## Hosted OpenAI Models

The `openai-fast` and `openai-reasoning` agent profiles use the OpenAI Responses API. Enable them
on the API service with:

```text
OPENAI_API_KEY=...
OPENAI_FAST_MODEL=gpt-5-mini
OPENAI_REASONING_MODEL=gpt-5.2
```

The API key remains server-side. `OPENAI_FAST_MODEL` and `OPENAI_REASONING_MODEL` are optional and
allow operators to change the concrete model behind each stable Soko profile.

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

Unsupported tools, malformed JSON, timeouts, unavailable adapters, and empty completions fall back
to deterministic CP10 runtime behavior. The runtime response includes the selected provider status
and an error code; the messaging interface surfaces that fallback instead of implying that the
model processed the message.

## Safety Boundaries

- Prompt context uses business-scoped counts and role metadata, not full product, customer, supplier, invoice, payment, or import records.
- Model output is parsed into bounded runtime shapes before verification.
- Business mutations still route only through deterministic validators and tool adapters.
- High and critical risk tools still require explicit confirmation.
- Runtime telemetry records adapter status, latency, error codes, and fallback decisions without raw prompt or output text.
