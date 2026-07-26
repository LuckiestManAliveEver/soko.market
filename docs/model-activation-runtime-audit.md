# Model activation runtime audit

## Scope and finding

The repository already had most of the individual pieces needed for local-first inference, but
they did not form one authoritative end-to-end path.

The exact broken link was between model selection and the server chat runtime:

- The canonical catalogue in `Cp2Store` listed `qwen2.5-0.5b-android` as an available local model.
- The owner UI treated the agent profile's `modelId` as an active backend selection when no
  installed model was attached.
- Installed-model assignments were scoped to `businessId + deviceId` and duplicated into browser
  storage. They represented device readiness, not one active model for an agent.
- `cp2_active_ai_models` represented only an optional OpenAI fallback.
- Production's `runtimeModelProviderResolver` knew only configured OpenAI models.
- `createRuntimeTurn` rewrote an unavailable requested model to `sokoclaw-local`, and an unavailable
  provider fell through to the deterministic command parser.

Consequently, an “Active” badge did not prove that a model was verified, persisted as the agent's
primary model, resolved by chat, or used for inference.

## Existing architecture audited

### Registry and persistence

- The canonical model catalogue is `aiModelRegistry` in `services/api/src/cp2/store.ts`.
- Installed GGUF records use `InstalledAgentModelSummary` and
  `cp2_installed_agent_models`.
- Legacy device assignments use `AgentModelAssignmentSummary` and
  `cp2_agent_model_assignments`.
- Agent identity, personality, instructions, skills, and the legacy model ID live in
  `BusinessAgentProfileSummary`.
- Normalized CP2 snapshots are persisted by `services/api/src/cp2/postgres-store.ts`.

### Ownership

- A business owns one current business agent profile.
- Membership checks are enforced through `requireAuthorizedSession`.
- Model operations require `membership:manage`; chat requires `business:read`.
- Installed models are additionally bound to account, user, and device.

### UI and feature flags

- `AgentProfileSurface` owns model installation, testing, assignment, and route controls.
- Browser inference is controlled at build time by
  `VITE_BROWSER_LOCAL_INFERENCE_ENABLED`.
- Native bridge, owner-node, and cloud fallback permissions are explicit client settings.
- Browser models download only after explicit enablement.

### Runtime and chat

- `/v1/messages` persists a user message and invokes `createAgentConversationMessage`.
- `createAgentConversationMessage` invokes `createRuntimeTurn`.
- `createRuntimeTurn` builds the shop runtime, retrieves context, compiles instructions and
  personality, asks the model for a typed response/tool proposal, enforces tool policy and
  confirmation, and persists one assistant message.
- `RuntimeModelProvider` was the pre-existing server adapter boundary.
- The browser has provider-neutral routing for browser WebGPU/WASM, installed-app llama.cpp,
  owner-node, and cloud fallback.

### Existing adapters

- OpenAI: server-side Responses API provider with allowlist, timeout, budget, and circuit breaker.
- Browser local: explicit lazy download with capability and cache checks.
- Installed app: web bridge contract through `window.SokoAgentModelRuntime`; ordinary browsers
  reject activation.
- Remote shop device: authenticated, tenant/model/agent-bound owner-node broker with heartbeat,
  signed jobs, correlation IDs, replay checks, and timeout.
- Backend Qwen: no production adapter existed before this change.

## Implemented source of truth

`AgentModelBindingSummary` and `cp2_agent_model_bindings` now represent agent-level activation.
Device assignments remain device readiness records and are not interpreted as a global backend
activation.

A binding records:

- agent, shop, account, and canonical model ID;
- `verifying`, `active`, `inactive`, `failed`, or `unavailable` status;
- execution target, mode, fallback policy, and explicit permissions;
- activation and verification timestamps;
- last verification result and bounded error metadata.

The database has a partial unique index allowing only one active binding per agent. Migration 040
preserves previously verified device assignments by migrating the newest ready assignment for each
agent.

## Resulting runtime boundary

When the server adapter system is configured, chat now requires an active verified binding. It no
longer substitutes `sokoclaw-local` for an unbound agent and no longer uses the deterministic parser
after a bound model fails. The parser and protected tool loop still run after a successful model
completion so existing confirmation gates remain authoritative.

The remaining platform-specific limits are explicit:

- Browser-local activation is unavailable when the deployment flag is off.
- Server activation cannot attest an ordinary browser's local cache.
- Installed-app activation returns `BRIDGE_UNAVAILABLE` unless a trusted bridge-backed adapter is
  supplied.
- Backend activation returns `RUNTIME_UNAVAILABLE` until a real inference endpoint is configured.
