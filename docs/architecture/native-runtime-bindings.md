# Native runtime bindings

## Repository architecture before cutover

Soko had three overlapping persisted concepts. `cp2_agent_model_bindings` held one verified
server model and one optional OpenAI fallback. The feature-flagged Execution Fabric held
preferences, host identities, and installations in separate CP2 envelopes. Conversations and
runtime sessions did not reference either concept. With `EXECUTION_FABRIC_ENABLED=true`, the
model-preference UI wrote ranking hints but no verified host or installation, while chat bypassed
the durable legacy binding and replanned each turn.

That split caused the observed unbound activation behavior: the flagged “Use with Agent” surface
wrote `cp2_model_preferences`, but the activation/readiness path looked for an active
`cp2_agent_model_bindings` record. A preference could therefore appear saved in the UI while the
agent remained structurally unbound. It was not a missing model-catalog row or a foreign-key
failure.

## Native graph

Migration `063_native_runtime_bindings.sql` adds normalized CP2 envelopes for independent agents,
models, execution hosts, installations, runtime bindings, and generic binding-model roles. A
conversation stores `runtimeBindingId`; `cp2_conversations.runtime_binding_id` is a generated,
foreign-keyed projection of that authoritative JSON record. The relational compatibility
`conversations` table receives the same nullable foreign key.

The in-process `NativeRuntimeBindingStore` resolves:

```text
conversation -> runtime binding -> agent -> enabled model roles
             -> model installation -> execution host -> existing adapter
```

Roles are arbitrary strings. `primary` and ordered `fallback` roles have database uniqueness
guards. A deferred constraint trigger requires exactly one enabled primary before an active
binding transaction commits. Existing `cp2_runtime_sessions` and `cp2_runtime_turns` already
provide runtime-instance lifecycle, so no duplicate runtime-instance table was added.

## Availability and compatibility

Resolution performs no HTTP requests. A candidate is available only when:

- the binding, agent, and model are active;
- the binding-model relation is enabled;
- a matching installation is persisted as `available`; and
- its execution host is persisted as `available`.

`lastKnownHealthyAt` records the observation that produced availability; activation writes it only
after the existing adapter health check succeeds. Missing and unavailable records produce explicit
codes. The resolver compares runtime contract versions and the agent's declared
`requiredModelCapabilities` with model capabilities. It never silently substitutes an arbitrary
provider. Persisted fallbacks are tried by numeric priority and stable role ID.

Endpoints remain credential-free. Host records may contain an opaque `credentialReference` such
as `env:OPENAI_API_KEY`; raw credentials are rejected from endpoint-shaped data by migration
constraints and are never copied into binding configuration.

## Default and activation

The global default is the existing `builtin:soko-agent:v1` plus `sokoclaw-local` on the in-process
API host. This is the only repository runtime that works without assuming an optional OpenAI key,
backend inference deployment, browser capability, or installed device. It is deliberately not Pi,
SmolLM, or Qwen. Qwen remains the catalog's recommended downloadable/backend model and becomes a
business binding only after its real adapter health check passes.

The existing “Use with agent” API now writes both the legacy rollback record and the native graph
in the same CP2 snapshot transaction, then rebinds the account's shop/agent conversations. Removing
the model deactivates the native binding and returns affected conversations to the global default.
New conversations accept an authorized explicit binding or receive the active shop binding/global
default on the server.

## Fabric migration and backfill

`EXECUTION_FABRIC_ENABLED` remains a temporary rollback kill switch. Native resolution is the
default production path. Legacy files are marked `TODO(remove-after-fabric-migration)`, and the
boundary check rejects new Fabric imports outside the fixed rollback allowlist.

Run the backfill after migration:

```bash
pnpm db:backfill-native-runtime --dry-run
pnpm db:backfill-native-runtime
```

The script maps only active, successfully verified legacy bindings because those records prove a
model/target health observation. Stable IDs and upserts make it idempotent. Agent-scoped Fabric
preferences without a verified binding are reported as ambiguous: they do not prove an execution
host or installation, so the script refuses to guess. Non-agent preferences and inactive/unverified
bindings are reported as skipped; multiple active bindings are reported as conflicts. Apply mode
refuses to run while ambiguous mappings or conflicts remain.

## Observability

Runtime turn telemetry records the conversation, native binding, agent, configured primary,
actually selected model, fallback reason, host, and installation IDs. It does not record prompts,
credentials, or host secrets.
