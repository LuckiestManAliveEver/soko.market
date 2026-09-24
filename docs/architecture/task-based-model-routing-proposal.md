# Proposal: task-based automatic model routing

Status: **design only, not built.** Requested as one of three follow-ups after the Hugging Face
inference feature shipped (see `docs/implementation/huggingface-model-switching-report.md`). This is
scoped here, not implemented, because it is genuinely new capability the original task brief did not
require (its resolution hierarchy asks for a _manual_ task-level override, not automatic routing by
message content — see "Two related but distinct features" below), and because there are two
materially different ways to build it with a real, non-cosmetic tradeoff between them. Per this
repo's Confusion Protocol, that calls for a decision, not a unilateral pick.

## Two related but distinct features, not to be conflated

1. **Manual task-level override** — a user (or the client on their behalf) explicitly says "for this
   one task/conversation, use model X," then later removes that pin. This is what the original task
   brief's Part J actually names ("Set a temporary task-level override," "Remove an override"). It is
   close to already achievable: a conversation can already carry an explicit `runtimeBindingId`
   (`resolveRuntimeBinding`'s precedence tier 1), and a binding is already swappable via the existing
   activation endpoint. A dedicated task-level (narrower than conversation-level) override was not
   built in this pass and is a small, low-risk addition if wanted — a temporary in-memory or
   short-TTL override keyed by `(conversationId, taskId)` consulted before the conversation's
   `runtimeBindingId`, cleared on task completion or explicit removal.
2. **Automatic task-based routing** — no user action; the system classifies the incoming message
   (already happens today via `RuntimeParserIntent`, used for context-recipe/evidence selection, per
   `docs/architecture/context-recipes.md`) and picks a different model based on that classification -
   for example, routing "read a receipt" to a small local model but "explain this contract clause" to
   Qwen3-4B. **This is what "task-based auto-routing" means in the report's outstanding-limitations
   list, and what the rest of this document scopes.**

## Why this needs a decision, not just code

The existing native runtime binding graph (`cp2_native_runtime_bindings`,
`cp2_native_runtime_binding_models`) already models "one binding → several models" as ordered roles,
but the _only_ kind of role today is `primary` or `fallback`, and the _only_ reason to move down that
list is an **availability failure** at request time (`runtime-model-routing.ts`'s fallback path,
triggered by a real health/generation failure). Layering "pick a different model because of what the
message is about" onto that same mechanism means answering, concretely:

- Does a task-routed choice participate in the same fallback-on-failure chain, or is it a separate,
  earlier lookup that still falls through to the existing primary/fallback chain if it fails?
- Is the mapping (intent/capability → model) global per binding, or can it vary per business?
- What happens when the task-routed model is unavailable — silently fall through to primary (matches
  this codebase's "never fail routing over an unresolved target when possible" philosophy in
  `native-runtime-routing.ts`), or surface a distinct error?
- Does changing a business's task-route mapping require the same atomic-activation health-check
  ceremony as a normal model switch (`activateAgentModel`), or is it a lighter-weight preference edit
  since it never becomes the "primary" for cost-acceptance/UI-display purposes?

## Recommended design: a separate task-route lookup, not a new role kind

**Option A — extend the existing role enum** (`primary` | `fallback` → add `task:<key>`). Rejected as
the primary recommendation: `cp2_native_runtime_binding_models.role` is guarded by a DB `CHECK`
constraint and a deferred-trigger invariant ("exactly one enabled primary") that assumes exactly two
role kinds; extending it risks that invariant and touches the same table every existing
activation/fallback code path already depends on.

**Option B — a new, additive lookup table, recommended**:

```sql
create table if not exists cp2_native_runtime_task_routes (
  id uuid primary key,
  runtime_binding_id uuid not null references cp2_native_runtime_bindings(id) on delete cascade,
  -- RuntimeParserIntent value, or a model capability string (e.g. "reasoning") - exact key space
  -- is a decision point (see "Open questions" below), not resolved by this proposal.
  route_key text not null,
  model_id text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (runtime_binding_id, route_key)
);
```

Resolution change (`resolveNativeRuntimeModelProvider` in `native-runtime-routing.ts`): before
falling back to `nativeResolution.primary`, check whether the classified `RuntimeParserIntent` for
this turn has a matching row for the current binding. If yes and that model is available (same
`ModelRuntimeAdapter.canRun` check already used elsewhere), route to it; if the row exists but the
model is unavailable, or no row exists, fall through to the existing primary/fallback chain
unchanged. This keeps every existing caller and every existing test that doesn't pass a task-route
context completely unaffected — the same backward-compatibility shape this session's BYO-credential
change used (new optional inputs, no-op when omitted).

New endpoints, matching Part J's own naming and this repo's existing REST conventions:

- `PUT /api/agents/:agentId/task-routes/:routeKey` `{modelId}` — set or replace a route (an owner-
  level write, likely `membership:manage` like every other binding mutation).
- `DELETE /api/agents/:agentId/task-routes/:routeKey` — remove one.
- `GET /api/agents/:agentId/task-routes` — list current overrides for display.

## Open questions to resolve before building (ask, don't guess)

1. **Route key space**: `RuntimeParserIntent` values (a closed, already-classified set) or free-form
   model _capability_ strings (e.g. "reasoning", matching `AiModelSummary.capabilities`)? The former
   is precise but requires a route per intent; the latter is coarser but composes with "any model
   that declares this capability," which may be what's actually wanted ("route reasoning-heavy work
   to whichever capable model is active" rather than "route intent X to model Y specifically").
2. **Per-business or platform-wide default routes**: should the platform ship a sensible default
   mapping (e.g., every business's reasoning-tagged intents prefer Qwen3-4B when available), with a
   business able to override it — mirroring the existing platform-default-then-override pattern this
   codebase already uses everywhere else (`repositoryDefaultRuntimePolicy`, `PLATFORM_DEFAULT_MODEL_ID`)?
3. **Cost acceptance**: a task-route can silently swap a business onto a merchant-funded model
   (Qwen3-4B) for specific messages without going through the explicit-confirmation activation flow
   this session added to `QuickRuntimeSwitcher.tsx`/`AgentModelPanel.tsx`. If a task-route may point
   at a merchant-funded model, does setting the route itself require the same cost-acceptance gate as
   activating that model directly, so a business can't be billed by a route it set without realizing
   the target model isn't free?

## Estimate

Given the additive design above and reuse of every existing health-check/availability mechanism, this
is a contained, one-migration, one-new-resolver-branch feature — comparable in size to the BYO-
credential wiring this session completed (roughly one migration, one store method, one route set, a
handful of unit and integration tests). The blocking factor is answering the three questions above,
not implementation effort.
