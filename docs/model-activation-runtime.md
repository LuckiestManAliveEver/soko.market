# Model activation and runtime binding

## Activation sequence

```mermaid
sequenceDiagram
    actor Owner
    participant Frontend
    participant API as Activation API
    participant Binding as Agent binding service
    participant Adapter as Model adapter
    participant DB as Database
    participant Chat as Chat runtime

    Owner->>Frontend: Test model
    Frontend->>API: POST /api/agents/:agentId/models/:modelId/test
    API->>Binding: Authorize shop and resolve canonical model
    Binding->>Adapter: healthCheck(SOKO_MODEL_OK)
    Adapter-->>Binding: Actual model, target, latency, completion
    Binding-->>Frontend: Verified health result
    Owner->>Frontend: Use with agent
    Frontend->>API: POST /api/agents/:agentId/models/:modelId/activate
    API->>Binding: Create verifying candidate
    Binding->>Adapter: Real health check
    Adapter-->>Binding: Verified completion
    Binding->>DB: Deactivate prior + persist active binding
    Binding-->>Frontend: Canonical active binding
    Owner->>Frontend: Send chat message
    Frontend->>Chat: Authenticated /v1/messages request
    Chat->>DB: Resolve active verified binding
    Chat->>Adapter: Compiled agent prompt + history + context
    Adapter-->>Chat: Model response and execution metadata
    Chat->>DB: Persist assistant response once
    Chat-->>Frontend: Response + internal runtime metadata
```

## Source of truth and states

The source of truth is `cp2_agent_model_bindings`, represented by
`AgentModelBindingSummary`. A model registry record means that a model can be selected or installed;
it does not mean the model is active for an agent.

- `verifying`: candidate health check is running.
- `active`: the candidate passed a real inference check and is the single active binding.
- `inactive`: a previously active binding replaced by a verified candidate.
- `failed`: verification returned an invalid result.
- `unavailable`: the configured runtime could not be reached.

Failed replacements are retained for diagnostics and do not deactivate the working binding.

## APIs

### Test without mutation

`POST /api/agents/:agentId/models/:modelId/test`

```json
{
  "shopId": "shop-id",
  "executionTarget": "backend"
}
```

The response contains the actual canonical model ID, provider, execution target, latency, bounded
preview, and verification timestamp.

### Activate

`POST /api/agents/:agentId/models/:modelId/activate`

```json
{
  "shopId": "shop-id",
  "executionTarget": "backend",
  "executionMode": "LOCAL_FIRST",
  "fallbackPolicy": "WHEN_LOCAL_UNAVAILABLE",
  "permissions": {
    "allowInstalledApp": false,
    "allowRemoteShopDevice": false,
    "allowOpenAIFallback": false
  },
  "fallbackModelId": null
}
```

The API authenticates the owner, verifies shop-agent ownership and the canonical model, validates
route permissions, runs real inference, and only then changes the active binding.

`GET /api/agents/:agentId/model-binding?shopId=:shopId` returns the canonical reload-safe state.

`DELETE /api/agents/:agentId/model-binding?shopId=:shopId` idempotently removes the active binding.
It returns `{ binding: null }`, keeps the historical row as `inactive` for auditability, and does
not remove device-local model files or change the independently configured cloud fallback.

## Adapter contract

`ModelRuntimeAdapter` in `services/api/src/inference/model-runtime.ts` provides:

- `canRun(context)` for target/model availability;
- `healthCheck(context)` for a real `SOKO_MODEL_OK` completion;
- `generate({ context, prompt })` for inference with model, provider, target, token and latency
  metadata.

The backend adapter uses the authenticated Soko private-inference gateway, not Ollama directly. It
calls `/health/ready`, `/v1/models/:modelId/probe`, and `/v1/chat/completions`, applies separate
connect and generation timeouts, supports caller cancellation, retries only readiness, and rejects
HTTP failures, empty output, malformed output, and provider-model identity mismatches.

The existing OpenAI provider is adapted without exposing its credential to the browser.

## Chat routing and fallback

Normal server agent chat:

1. authenticates the account and resolves the shop;
2. loads the single active verified binding;
3. loads the agent profile, personality, instructions, context, memory, and enabled skills;
4. resolves the adapter from the saved model and execution target;
5. performs inference;
6. parses the typed response/tool proposal;
7. applies role, policy, and confirmation gates;
8. persists one assistant response;
9. returns internal model/binding/target/latency metadata.

An unbound agent returns `AGENT_MODEL_NOT_CONFIGURED`. An unavailable bound adapter returns
`AGENT_MODEL_UNAVAILABLE`.

OpenAI fallback requires all of:

- an explicitly saved fallback model;
- `allowOpenAIFallback: true`;
- an enabled server provider and allowlisted model;
- a qualifying primary failure under the saved fallback policy.

Authentication, authorization, tenant, invalid request, policy, confirmation, and malformed-output
failures never qualify.

## Local runtime limitations

- Browser-local inference is build-time gated. When disabled, the UI renders no interactive
  checkbox and no model is downloaded.
- Browser downloads remain explicit and lazy.
- The installed-app web contract remains `window.SokoAgentModelRuntime`. A native Android bridge is
  not implemented in this repository, so server activation reports `BRIDGE_UNAVAILABLE`.
- Owner-node inference remains restricted to authenticated, current-heartbeat devices registered
  for the same tenant, agent, and model.

## Environment

Frontend build-time:

- `VITE_BROWSER_LOCAL_INFERENCE_ENABLED`
- `VITE_INFERENCE_CLIENT_FIRST`
- `VITE_INFERENCE_NATIVE_BRIDGE_ENABLED`
- `VITE_INFERENCE_OWNER_NODE_ENABLED`
- `VITE_INFERENCE_CLOUD_FALLBACK_ENABLED`

Server runtime:

- `BACKEND_INFERENCE_ENABLED`
- `BACKEND_INFERENCE_BASE_URL`
- `BACKEND_INFERENCE_TIMEOUT_MS`
- `BACKEND_INFERENCE_CONNECT_TIMEOUT_MS`
- `BACKEND_INFERENCE_REQUIRED`
- `BACKEND_INFERENCE_MODEL_ID`
- `INFERENCE_SERVICE_TOKEN`
- existing `INFERENCE_OWNER_NODE_*` and `INFERENCE_CLOUD_*` settings
- `OPENAI_API_KEY` only when explicitly enabling allowlisted OpenAI fallback

`BACKEND_INFERENCE_BASE_URL` is required when backend inference is enabled. Paid fallback is not
enabled by these binding changes.

## Local verification

1. Run an Ollama-compatible server and load the configured provider model.
2. Set `BACKEND_INFERENCE_ENABLED=true` and configure the backend variables.
3. Run `pnpm db:migrate`.
4. Start the API and web app.
5. Open Agent model settings.
6. Test Qwen, activate it, reload, and confirm the binding remains active.
7. Send a chat message and inspect the owner status for model, route, and latency.
8. Stop the inference process and confirm chat returns an actionable unavailable error without
   substituting another provider.

## Render verification

Render configures backend inference through the private `soko-market-inference` service reference.
Deploy migration 040 and the private service, run the real probe, then call the model test endpoint
before activation. Keep OpenAI fallback disabled unless the API key, allowlist, selected fallback
model, and owner permission are all intentionally configured.

## Troubleshooting

- `RUNTIME_UNAVAILABLE`: endpoint disabled, unreachable, or model adapter absent.
- `MODEL_NOT_INSTALLED`: configured provider model is not installed on the backend.
- `MODEL_IDENTITY_MISMATCH`: the backend responded using a different model.
- `MODEL_HEALTH_CHECK_FAILED`: inference completed without the readiness marker.
- `INFERENCE_TIMEOUT`: increase the timeout only after checking load time and host capacity.
- `BRIDGE_UNAVAILABLE`: open the supported installed app after its native bridge is implemented.
- `BROWSER_RUNTIME_DISABLED`: use a deployment built with browser inference enabled.
