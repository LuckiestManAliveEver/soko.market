# Self-hosted backend model-runtime verification

These checks cover the `services/ai-runtime` deployment with a real installed model, including the
production Render Blueprint's private inference service. Mocked tests do not satisfy live runtime
verification.

## Prerequisites

Keep secrets in the shell or secret manager:

```bash
export SOKO_API_URL=https://api.soko.market
export SOKO_INFERENCE_URL=http://<private-host>:<port>
export INFERENCE_SERVICE_TOKEN=<internal-token>
export SOKO_TEST_TOKEN=<authenticated-session-token-or-cookie>
export SOKO_TEST_SHOP_ID=<shop-id>
export SOKO_MODEL_ID=smollm2-360m
```

Keep the inference hostname private to the API network. Do not make it public just to run `curl`.

## Individual checks

From a shell with private-network access:

```bash
curl --fail --silent --show-error \
  -H "Authorization: Bearer $INFERENCE_SERVICE_TOKEN" \
  "$SOKO_INFERENCE_URL/health/ready"

curl --fail --silent --show-error -X POST \
  -H "Authorization: Bearer $INFERENCE_SERVICE_TOKEN" \
  "$SOKO_INFERENCE_URL/v1/models/$SOKO_MODEL_ID/probe"
```

The second command performs a real generation and must return `ok: true` with the canonical and
provider model IDs. Readiness alone is not a model probe.

Public API readiness:

```bash
curl --fail --silent --show-error "$SOKO_API_URL/health/ready"
```

Resolve the inherited default through the authenticated canonical API, then send a turn. The test
shop must have no explicit runtime override. If `SOKO_TEST_TOKEN` is only a token value, use the
application's actual cookie name as shown by the login flow:

```bash
curl --fail --silent --show-error \
  -H "Cookie: $SOKO_TEST_TOKEN" \
  "$SOKO_API_URL/businesses/$SOKO_TEST_SHOP_ID/runtime/effective"

curl --fail --silent --show-error -X POST \
  -H "Content-Type: application/json" \
  -H "Cookie: $SOKO_TEST_TOKEN" \
  --data '{"message":"Reply briefly and identify the selected model."}' \
  "$SOKO_API_URL/businesses/$SOKO_TEST_SHOP_ID/runtime/turns"
```

The effective runtime must report Pi, the configured model, a non-empty backend host id,
`source: "default"`, and `ready: true`. The chat result must identify that same model, `backend`,
and a non-empty inference request ID.

## One-command gate

After the variables above are set:

```bash
pnpm verify:production-runtime
```

The script checks API/Neon readiness, inference readiness, a real probe, the canonical effective
default runtime, and one real chat request. It exits non-zero at the first failed stage and emits
`DEFAULT_RUNTIME_UNAVAILABLE` when the default graph or adapter is not executable.

The equivalent opt-in Vitest flow also performs activation and reload verification:

```bash
pnpm test:live-model-runtime
```

## Final self-hosted deployment sequence

1. Apply Neon-compatible migrations.
2. Deploy the self-hosted private inference service and durable model storage.
3. Confirm authenticated inference readiness.
4. Confirm the real model probe.
5. Configure the API private hostname and shared token.
6. Deploy the API and confirm database readiness.
7. Resolve the default runtime and require Pi + SmolLM + backend + `ready: true`.
8. Open the PWA and confirm settings show the same effective runtime.
9. Send one real chat message and verify response metadata.

Record each live result separately. A structural build cannot be reported as a live Neon,
activation, probe, or chat pass.
