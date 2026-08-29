# ADR: DB-hosted, operator-editable model and agent catalog

## Context

`aiModelRegistry` (the model catalog) and `defaultAgentDefinition` (the built-in agent fallback
template) were hardcoded arrays/constants in application source. Every device reached them through
the existing `GET /v1/ai-models` endpoint, so they were already served centrally, but their content
could only change by shipping a new build - an operator could not add, edit, or disable a catalog
entry without a code change and redeploy. The browser additionally kept its own hand-maintained
duplicate (`defaultOfflineAiModels`) for offline resilience, which had already drifted from the
server copy and was being merged as `primary` into successful fetches, silently overriding live
data with stale text for the two model ids it duplicated.

## Decision

Move the catalog into two DB-hosted tables, `cp2_model_catalog` and `cp2_agent_catalog`
(`infra/db/migrations/071_platform_catalog.sql`), seeded with today's exact bootstrap content so no
deployment's served catalog changes as a result of this migration. `Cp2Store` reads/writes these
tables as its runtime source of truth and falls back to the hardcoded constants in memory when a
fresh test store or unexpectedly empty loaded collection needs a safe bootstrap. New
`PUT`/`DELETE /v1/platform/model-catalog/:modelId` and `/v1/platform/agent-catalog/:id` routes let
an authorized operator edit the catalog without a redeploy; `GET /v1/ai-models` (unchanged path,
every device already calls it) and the new `GET /v1/platform/agent-catalog` serve the result.

Catalog writes require a new `PlatformOperatorGrant` (`cp2_platform_operators`), a deployment-level
authority distinct from every existing shop-scoped `BusinessRole`. It is granted only by
`services/api/scripts/grant-platform-operator.mjs`, run directly against the database - no API
route can create, extend, or self-grant it. API instances cache grants at startup and must be
restarted after either a grant or a revocation. This matches this codebase's pattern of keeping
destructive/privileged operations in operator-run scripts (`backfill-native-runtime-bindings.mjs`,
`purge-all-users.sql`) rather than behind application-level admin UI.

The browser's `defaultOfflineAiModels` stays, narrowed to only the fetch-failure fallback path; it
no longer participates in a successful fetch's result.

## Alternatives considered

- Reuse `cp2_native_runtime_models`/`cp2_native_runtime_agents`: rejected. Those tables are the
  per-shop _runtime graph_ (bindings, hosts, installations) and only ever gain rows once a model is
  actually activated/provisioned for some shop - they have never held the full static catalog, and
  their `NativeRuntimeModelSummary`/`NativeRuntimeAgentSummary` shapes lack most of
  `AiModelSummary`'s fields (license, download URL, file size, ...). Reusing them would require
  either losing that metadata or growing their `configuration` bag to carry a second, differently-
  shaped concept alongside the graph data it already holds.
- A single JSON config file loaded at boot: rejected. Would need its own deploy/redeploy path to
  change, defeating the purpose, and a running fleet of API instances would drift until every
  instance restarted.
- No new authorization tier; require existing shop `owner` role: rejected. The catalog is global,
  not shop-scoped - any shop owner being able to edit every other shop's available models/agents is
  a real cross-tenant authorization gap, not a convenience.
- Delete `defaultOfflineAiModels` entirely instead of narrowing its use: rejected. It is a
  legitimate, small, offline-only fallback for when `GET /v1/ai-models` cannot be reached at all: a
  real product requirement (see `docs/adr/ADR-hosted-first-zero-setup-ai.md`'s "Offline Behavior"),
  not the duplication problem. The problem was specifically that it also overrode live data on a
  _successful_ fetch.

## Consequences

An operator can change what models/agents a deployment offers without a redeploy. Every existing
consumer of `aiModelRegistry`/`defaultAgentDefinition` inside `services/api` now reads through
`AgentRuntimeDomainDeps.listModelCatalog`/`resolveCatalogModel`/`resolveAgentCatalogEntry` instead
of the module-level constants directly; the constants remain as bootstrap/reseed defaults only.
`isAgentDefinitionId` widened from one hardcoded id to any `builtin:<slug>`, so a second built-in
agent template is now representable without a schema or type change.

The browser's offline fallback list can no longer silently win over live catalog data on a
successful load - a real behavior fix, not just a refactor.

## Security implications

`requirePlatformOperator` is checked on every catalog write; `GET` routes are read-only and require
only an authenticated session (the same data every device already receives via `GET
/v1/ai-models`). Grant/revoke has no API surface at all - only a script run with direct database
access, so its trust boundary is "whoever can run commands against the production database," the
same boundary every other operator script in this codebase already assumes.

## Migration impact

Migration 071 is purely additive (three new tables, two seeded with today's exact content); no
existing table or column changes. `purge-all-users.sql` preserves the two global catalog tables so
operator-authored deployment configuration survives a registered-user purge, while
`cp2_platform_operators` is deleted because its grants belong to purged accounts. All three remain
explicitly classified by the script's normalized-table coverage test.
