import { describe, expect, it } from "vitest";
import {
  formatBackfillReport,
  planNativeRuntimeBackfill
} from "../services/api/scripts/backfill-native-runtime-bindings.mjs";

const verifiedBinding = {
  id: "legacy-binding-1",
  agentId: "agent-1",
  shopId: "shop-1",
  accountId: "account-1",
  modelId: "qwen2.5-0.5b-android",
  fallbackModelId: "openai-fast",
  executionTarget: "backend",
  status: "active",
  lastVerificationStatus: "passed",
  lastVerifiedAt: "2026-08-27T12:00:00.000Z",
  createdAt: "2026-08-27T11:00:00.000Z",
  updatedAt: "2026-08-27T12:00:00.000Z",
  updatedBy: "user-1"
};

describe("native runtime backfill", () => {
  it("maps verified bindings to stable independent entities and ordered roles", () => {
    const plan = planNativeRuntimeBackfill({ agentModelBindings: [{ record: verifiedBinding }] });
    expect(plan.conflicts).toEqual([]);
    expect(plan.ambiguous).toEqual([]);
    expect(plan.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "agent", id: "agent-1" }),
        expect.objectContaining({ kind: "model", id: "qwen2.5-0.5b-android" }),
        expect.objectContaining({ kind: "model", id: "openai-fast" }),
        expect.objectContaining({
          kind: "binding",
          id: "native:legacy:legacy-binding-1"
        }),
        expect.objectContaining({
          kind: "role",
          record: expect.objectContaining({ role: "primary", priority: 0 })
        }),
        expect.objectContaining({
          kind: "role",
          record: expect.objectContaining({ role: "fallback", priority: 0 })
        })
      ])
    );
  });

  it("is idempotent and never produces duplicate natural entities", () => {
    const first = planNativeRuntimeBackfill({ agentModelBindings: [{ record: verifiedBinding }] });
    const second = planNativeRuntimeBackfill({ agentModelBindings: [{ record: verifiedBinding }] });
    expect(second.actions).toEqual(first.actions);
    expect(new Set(first.actions.map((item) => `${item.kind}:${item.id}`)).size).toBe(
      first.actions.length
    );
  });

  it("archives Fabric preferences deterministically without claiming availability", () => {
    const plan = planNativeRuntimeBackfill({
      modelPreferences: [
        {
          record: {
            id: "preference-1",
            scope: "agent",
            scopeId: "agent-2",
            preferredModelIds: ["smollm2-360m-android"],
            fallbackModelIds: []
          }
        }
      ]
    });
    expect(plan.ambiguous).toEqual([]);
    expect(plan.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "agent",
          id: "native:retired-preference-agent:preference-1",
          record: expect.objectContaining({ status: "inactive" })
        }),
        expect.objectContaining({
          kind: "binding",
          id: "native:retired-preference:preference-1",
          record: expect.objectContaining({ status: "draft" })
        }),
        expect.objectContaining({
          kind: "role",
          record: expect.objectContaining({
            modelId: "smollm2-360m-android",
            role: "primary",
            executionHostId: null
          })
        })
      ])
    );
  });

  it("migrates Fabric hosts and installations as unavailable until native verification", () => {
    const plan = planNativeRuntimeBackfill({
      runtimeHosts: [
        {
          account_id: "account-1",
          record: { id: "host-1", name: "Owner node", declaredRuntimes: ["ollama"] }
        }
      ],
      runtimeModelInstallations: [
        {
          record: {
            id: "installation-1",
            modelId: "model-1",
            runtimeHostId: "host-1"
          }
        }
      ]
    });

    expect(plan.ambiguous).toEqual([]);
    expect(plan.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "host",
          id: "host-1",
          record: expect.objectContaining({ status: "unavailable", accountId: "account-1" })
        }),
        expect.objectContaining({
          kind: "installation",
          id: "installation-1",
          record: expect.objectContaining({ status: "unavailable", modelId: "model-1" })
        })
      ])
    );
  });

  it("reports conflicting active legacy bindings and dry-run output is mutation-free", () => {
    const plan = planNativeRuntimeBackfill({
      agentModelBindings: [
        { record: verifiedBinding },
        { record: { ...verifiedBinding, id: "legacy-binding-2" } }
      ]
    });
    expect(plan.conflicts).toHaveLength(1);
    const before = structuredClone(plan);
    const output = formatBackfillReport(plan, true);
    expect(JSON.parse(output)).toMatchObject({ dryRun: true, conflicts: [{}] });
    expect(plan).toEqual(before);
  });
});
