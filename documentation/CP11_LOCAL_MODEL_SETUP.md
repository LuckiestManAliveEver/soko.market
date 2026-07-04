# CP11 Local Model Setup

CP11 supports a llama.cpp-compatible local model adapter behind the CP10 runtime contract.

The project does not download, license, quantize, or tune model files automatically. Operators choose and place model artifacts outside this repository.

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
maxTokens: 256
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
