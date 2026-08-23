# Self-hosted backend model-runtime verification

These checks apply only to a deliberately self-hosted `services/ai-runtime` deployment with a real
installed model. The production Render Blueprint does not deploy this service or set
`BACKEND_INFERENCE_*`; use the browser-inference checks in `render-inference.md` for Render.
Mocked tests do not satisfy live self-hosted verification.

## Prerequisites

Keep secrets in the shell or secret manager:

```bash
export SOKO_API_URL=https://api.soko.market
export SOKO_INFERENCE_URL=http://<private-host>:<port>
export INFERENCE_SERVICE_TOKEN=<internal-token>
export SOKO_TEST_TOKEN=<authenticated-session-token-or-cookie>
export SOKO_TEST_AGENT_ID=<agent-id>
export SOKO_TEST_SHOP_ID=<shop-id>
export SOKO_MODEL_ID=qwen2.5-0.5b-android
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

Test then activate through the authenticated API. If `SOKO_TEST_TOKEN` is only a token value, use
the application's actual cookie name as shown by the login flow:

```bash
curl --fail --silent --show-error -X POST \
  -H "Content-Type: application/json" \
  -H "Cookie: $SOKO_TEST_TOKEN" \
  --data "{\"shopId\":\"$SOKO_TEST_SHOP_ID\",\"executionTarget\":\"backend\"}" \
  "$SOKO_API_URL/api/agents/$SOKO_TEST_AGENT_ID/models/$SOKO_MODEL_ID/test"

curl --fail --silent --show-error -X POST \
  -H "Content-Type: application/json" \
  -H "Cookie: $SOKO_TEST_TOKEN" \
  --data "{\"shopId\":\"$SOKO_TEST_SHOP_ID\",\"executionTarget\":\"backend\",\"executionMode\":\"LOCAL_FIRST\",\"fallbackPolicy\":\"WHEN_LOCAL_UNAVAILABLE\",\"permissions\":{\"allowInstalledApp\":false,\"allowRemoteShopDevice\":false,\"allowOpenAIFallback\":false},\"fallbackModelId\":null}" \
  "$SOKO_API_URL/api/agents/$SOKO_TEST_AGENT_ID/models/$SOKO_MODEL_ID/activate"

curl --fail --silent --show-error \
  -H "Cookie: $SOKO_TEST_TOKEN" \
  "$SOKO_API_URL/api/agents/$SOKO_TEST_AGENT_ID/model-binding?shopId=$SOKO_TEST_SHOP_ID"

curl --fail --silent --show-error -X POST \
  -H "Content-Type: application/json" \
  -H "Cookie: $SOKO_TEST_TOKEN" \
  --data '{"message":"Reply briefly and identify the selected model."}' \
  "$SOKO_API_URL/businesses/$SOKO_TEST_SHOP_ID/runtime/turns"
```

The binding must be `active` and `passed`; the chat result must identify
`qwen2.5-0.5b-android`, `qwen2.5:0.5b`, `backend`, and a non-empty inference request ID.

## One-command gate

After the variables above are set:

```bash
pnpm verify:production-runtime
```

The script checks API/Neon readiness, inference readiness, a real probe, the persisted binding, and
one real chat request. It exits non-zero at the first failed stage.

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
7. Open the PWA and test the model.
8. Activate it for the intended agent.
9. Reload the PWA and confirm the binding remains active.
10. Send one real chat message and verify response metadata.

Record each live result separately. A structural build cannot be reported as a live Neon,
activation, probe, or chat pass.
