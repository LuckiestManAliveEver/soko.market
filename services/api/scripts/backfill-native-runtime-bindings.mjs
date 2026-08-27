#!/usr/bin/env node
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export function planNativeRuntimeBackfill(input) {
  const actions = [];
  const ambiguous = [];
  const conflicts = [];
  const skipped = [];
  const activeByAgent = new Map();

  for (const envelope of input.agentModelBindings ?? []) {
    const binding = envelope.record ?? envelope;
    if (binding.status !== "active" || binding.lastVerificationStatus !== "passed") {
      skipped.push({
        source: "agent-model-binding",
        id: binding.id,
        reason: "not-active-and-verified"
      });
      continue;
    }
    const existing = activeByAgent.get(binding.agentId);
    if (existing !== undefined) {
      conflicts.push({
        source: "agent-model-binding",
        agentId: binding.agentId,
        ids: [existing.id, binding.id],
        reason: "multiple-active-bindings"
      });
      continue;
    }
    activeByAgent.set(binding.agentId, binding);
  }

  for (const binding of activeByAgent.values()) {
    const timestamp = binding.updatedAt ?? binding.activatedAt ?? new Date(0).toISOString();
    const nativeBindingId = `native:legacy:${binding.id}`;
    const primaryHostId = stableUuid(
      `native-runtime-host:${binding.accountId}:${binding.executionTarget}`
    );
    actions.push(
      action("agent", binding.agentId, {
        id: binding.agentId,
        businessId: binding.shopId,
        accountId: binding.accountId,
        name: "Soko business agent",
        provider: "soko-business-agent",
        packageRef: null,
        version: "1",
        runtimeContractVersion: "1",
        capabilities: ["tools", "mcp"],
        configuration: { requiredModelCapabilities: ["tool-routing"] },
        status: "active",
        createdAt: binding.createdAt ?? timestamp,
        updatedAt: timestamp
      }),
      modelAction(binding.modelId, binding.executionTarget, timestamp),
      hostAction(primaryHostId, binding, binding.executionTarget, timestamp),
      installationAction(binding.modelId, primaryHostId, timestamp),
      action("binding", nativeBindingId, {
        id: nativeBindingId,
        businessId: binding.shopId,
        accountId: binding.accountId,
        agentId: binding.agentId,
        name: "Migrated agent runtime",
        status: "active",
        isDefault: false,
        configuration: { source: "cp2_agent_model_bindings", legacyBindingId: binding.id },
        runtimeContractVersion: "1",
        createdAt: binding.createdAt ?? timestamp,
        updatedAt: timestamp,
        updatedBy: binding.updatedBy ?? "migration"
      }),
      roleAction(nativeBindingId, binding.modelId, "primary", 0, primaryHostId, timestamp)
    );
    if (binding.fallbackModelId) {
      const fallbackTarget = binding.fallbackModelId.startsWith("openai-")
        ? "openai"
        : binding.executionTarget;
      const fallbackHostId = stableUuid(
        `native-runtime-host:${binding.accountId}:${fallbackTarget}`
      );
      actions.push(
        modelAction(binding.fallbackModelId, fallbackTarget, timestamp),
        hostAction(fallbackHostId, binding, fallbackTarget, timestamp),
        installationAction(binding.fallbackModelId, fallbackHostId, timestamp),
        roleAction(
          nativeBindingId,
          binding.fallbackModelId,
          "fallback",
          0,
          fallbackHostId,
          timestamp
        )
      );
    }
  }

  for (const envelope of input.modelPreferences ?? []) {
    const preference = envelope.record ?? envelope;
    if (preference.scope !== "agent") {
      skipped.push({ source: "model-preference", id: preference.id, reason: "non-agent-scope" });
      continue;
    }
    if (activeByAgent.has(preference.scopeId)) continue;
    ambiguous.push({
      source: "model-preference",
      id: preference.id,
      scopeId: preference.scopeId,
      modelIds: [...(preference.preferredModelIds ?? []), ...(preference.fallbackModelIds ?? [])],
      reason: "preference-does-not-identify-a-verified-installation-or-execution-host"
    });
  }

  const deduped = new Map();
  for (const item of actions) deduped.set(`${item.kind}:${item.id}`, item);
  return { actions: [...deduped.values()], ambiguous, conflicts, skipped };
}

function action(kind, id, record) {
  return { kind, id, record };
}

function modelAction(modelId, executionTarget, timestamp) {
  return action("model", modelId, {
    id: modelId,
    name: modelId,
    provider: modelId.startsWith("openai-") ? "openai" : "local",
    providerModelId: modelId,
    runtimeContractVersion: "1",
    capabilities: ["chat", "tool-routing"],
    configuration: { source: "legacy-binding", executionTarget },
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

function hostAction(id, binding, executionTarget, timestamp) {
  return action("host", id, {
    id,
    businessId: binding.shopId,
    accountId: binding.accountId,
    type: executionTarget,
    name: `${executionTarget} runtime`,
    endpoint: null,
    status: "available",
    capabilities: [executionTarget],
    configuration: { executionTarget, source: "verified-legacy-binding" },
    credentialReference: executionTarget === "openai" ? "env:OPENAI_API_KEY" : null,
    lastKnownHealthyAt: binding.lastVerifiedAt,
    createdAt: binding.createdAt ?? timestamp,
    updatedAt: timestamp
  });
}

function installationAction(modelId, hostId, timestamp) {
  const id = stableUuid(`native-runtime-installation:${modelId}:${hostId}`);
  return action("installation", id, {
    id,
    modelId,
    executionHostId: hostId,
    status: "available",
    configuration: { source: "verified-legacy-binding" },
    lastKnownHealthyAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

function roleAction(bindingId, modelId, role, priority, hostId, timestamp) {
  const id = stableUuid(`native-runtime-role:${bindingId}:${role}:${priority}:${modelId}`);
  return action("role", id, {
    id,
    runtimeBindingId: bindingId,
    modelId,
    role,
    priority,
    executionHostId: hostId,
    configuration: {},
    enabled: true,
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

function stableUuid(value) {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16] ?? "0", 16) % 4];
  const compact = hex.join("");
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

async function readSources(client) {
  const [bindings, preferences] = await Promise.all([
    client.query("select record from cp2_agent_model_bindings order by entity_id"),
    client.query("select record from cp2_model_preferences order by entity_id")
  ]);
  return { agentModelBindings: bindings.rows, modelPreferences: preferences.rows };
}

const tableForKind = {
  agent: "cp2_native_runtime_agents",
  model: "cp2_native_runtime_models",
  host: "cp2_native_execution_hosts",
  installation: "cp2_native_model_installations",
  binding: "cp2_native_runtime_bindings",
  role: "cp2_native_runtime_binding_models"
};

async function applyPlan(client, plan) {
  await client.query("begin");
  try {
    await client.query("select pg_advisory_xact_lock(hashtext('soko.native_runtime_backfill'))");
    await client.query("set constraints all deferred");
    for (const item of plan.actions) {
      const table = tableForKind[item.kind];
      const record = item.record;
      const parentId =
        item.kind === "installation"
          ? record.executionHostId
          : item.kind === "binding"
            ? record.agentId
            : item.kind === "role"
              ? record.runtimeBindingId
              : null;
      await client.query(
        `insert into ${table} (entity_id, business_id, account_id, parent_id, record, updated_at)
         values ($1, $2, $3, $4, $5::jsonb, now())
         on conflict (entity_id) do update set
           business_id = excluded.business_id, account_id = excluded.account_id,
           parent_id = excluded.parent_id, record = excluded.record, updated_at = now()`,
        [
          item.id,
          record.businessId ?? null,
          record.accountId ?? null,
          parentId,
          JSON.stringify(record)
        ]
      );
    }
    for (const item of plan.actions.filter((candidate) => candidate.kind === "binding")) {
      await client.query(
        `update cp2_conversations set record = jsonb_set(record, '{runtimeBindingId}', to_jsonb($1::text), true)
         where business_id = $2 and account_id = $3`,
        [item.id, item.record.businessId, item.record.accountId]
      );
      await client.query(
        `update conversations set runtime_binding_id = $1
         where active_shop_id::text = $2 and account_id::text = $3`,
        [item.id, item.record.businessId, item.record.accountId]
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

export function formatBackfillReport(plan, dryRun) {
  return JSON.stringify(
    {
      dryRun,
      createsOrUpdates: plan.actions,
      ambiguousMappings: plan.ambiguous,
      conflicts: plan.conflicts,
      skipped: plan.skipped
    },
    null,
    2
  );
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const plan = planNativeRuntimeBackfill(await readSources(pool));
    console.log(formatBackfillReport(plan, dryRun));
    if (dryRun) return;
    if (plan.conflicts.length > 0 || plan.ambiguous.length > 0) {
      throw new Error(
        "Backfill has conflicts or ambiguous mappings; resolve them before applying."
      );
    }
    await applyPlan(pool, plan);
  } finally {
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
