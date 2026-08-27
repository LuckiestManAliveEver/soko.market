import { describe, expect, it, vi } from "vitest";
import type {
  ConversationSummary,
  NativeExecutionHostSummary,
  NativeModelInstallationSummary,
  NativeRuntimeAgentSummary,
  NativeRuntimeBindingModelSummary,
  NativeRuntimeBindingSummary,
  NativeRuntimeModelSummary
} from "../packages/shared-types/src";
import {
  globalDefaultRuntimeBindingId,
  NativeRuntimeBindingStore
} from "../services/api/src/cp2/domains/native-runtime/store";

const timestamp = "2026-08-27T12:00:00.000Z";

describe("native runtime binding resolver", () => {
  it("resolves an explicit binding, installation, host, ordered fallbacks, and auxiliaries", () => {
    const graph = graphStore();
    const resolved = graph.store.resolveRuntimeBinding("conversation-1", graph.conversations);

    expect(resolved.usedGlobalDefault).toBe(false);
    expect(resolved.binding.id).toBe("binding-1");
    expect(resolved.agent.id).toBe("agent-1");
    expect(resolved.primary.model.id).toBe("model-primary");
    expect(resolved.primary.installation?.id).toBe("installation-primary");
    expect(resolved.primary.host?.id).toBe("host-primary");
    expect(resolved.fallbacks.map((candidate) => candidate.model.id)).toEqual([
      "model-fallback-0",
      "model-fallback-1"
    ]);
    expect(resolved.auxiliaries.verifier?.[0]?.model.id).toBe("model-verifier");
    expect(resolved.selected.model.id).toBe("model-primary");
  });

  it("uses the global default when a legacy conversation has no binding", () => {
    const store = new NativeRuntimeBindingStore();
    const conversation = conversationRecord(null);
    const resolved = store.resolveRuntimeBinding(
      conversation.id,
      new Map([[conversation.id, conversation]])
    );
    expect(resolved.usedGlobalDefault).toBe(true);
    expect(resolved.binding.id).toBe(globalDefaultRuntimeBindingId);
    expect(resolved.selected.model.id).toBe("sokoclaw-local");
  });

  it("returns an explicit error when no global default exists", () => {
    const store = new NativeRuntimeBindingStore();
    store.clear();
    const conversation = conversationRecord(null);
    expect(() =>
      store.resolveRuntimeBinding(conversation.id, new Map([[conversation.id, conversation]]))
    ).toThrowError(expect.objectContaining({ code: "RUNTIME_DEFAULT_MISSING" }));
  });

  it("rejects inactive bindings and missing agents", () => {
    const inactive = graphStore();
    inactive.store.bindingsMap.set("binding-1", {
      ...(inactive.store.bindingsMap.get("binding-1") as NativeRuntimeBindingSummary),
      status: "inactive"
    });
    expect(() =>
      inactive.store.resolveRuntimeBinding("conversation-1", inactive.conversations)
    ).toThrowError(expect.objectContaining({ code: "RUNTIME_BINDING_INACTIVE" }));

    const missingAgent = graphStore();
    missingAgent.store.agentsMap.delete("agent-1");
    expect(() =>
      missingAgent.store.resolveRuntimeBinding("conversation-1", missingAgent.conversations)
    ).toThrowError(expect.objectContaining({ code: "RUNTIME_AGENT_UNAVAILABLE" }));
  });

  it("rejects missing or disabled primary roles", () => {
    for (const mode of ["missing", "disabled"] as const) {
      const graph = graphStore();
      const primary = [...graph.store.bindingModelsMap.values()].find(
        (role) => role.runtimeBindingId === "binding-1" && role.role === "primary"
      ) as NativeRuntimeBindingModelSummary;
      if (mode === "missing") graph.store.bindingModelsMap.delete(primary.id);
      else graph.store.bindingModelsMap.set(primary.id, { ...primary, enabled: false });
      expect(() =>
        graph.store.resolveRuntimeBinding("conversation-1", graph.conversations)
      ).toThrowError(expect.objectContaining({ code: "RUNTIME_PRIMARY_INVALID" }));
    }
  });

  it("selects fallbacks deterministically as persisted availability changes", () => {
    const graph = graphStore();
    setHostStatus(graph.store, "host-primary", "unavailable");
    let resolved = graph.store.resolveRuntimeBinding("conversation-1", graph.conversations);
    expect(resolved.selected.model.id).toBe("model-fallback-0");
    expect(resolved.fallbackUsed).toBe(true);
    expect(resolved.fallbackReason).toBe("EXECUTION_HOST_UNAVAILABLE");

    setInstallationStatus(graph.store, "installation-fallback-0", "unavailable");
    resolved = graph.store.resolveRuntimeBinding("conversation-1", graph.conversations);
    expect(resolved.selected.model.id).toBe("model-fallback-1");

    setHostStatus(graph.store, "host-fallback-1", "unavailable");
    expect(() =>
      graph.store.resolveRuntimeBinding("conversation-1", graph.conversations)
    ).toThrowError(expect.objectContaining({ code: "RUNTIME_MODELS_UNAVAILABLE" }));
  });

  it("reports missing installations and hosts as unavailable without probing the network", () => {
    const graph = graphStore();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("network forbidden"));
    graph.store.installationsMap.delete("installation-primary");
    setInstallationStatus(graph.store, "installation-fallback-0", "unavailable");
    graph.store.hostsMap.delete("host-fallback-1");
    expect(() =>
      graph.store.resolveRuntimeBinding("conversation-1", graph.conversations)
    ).toThrowError(expect.objectContaining({ code: "RUNTIME_MODELS_UNAVAILABLE" }));
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("rejects incompatible agent/model contracts", () => {
    const graph = graphStore();
    const model = graph.store.modelsMap.get("model-primary") as NativeRuntimeModelSummary;
    graph.store.modelsMap.set(model.id, { ...model, capabilities: ["chat"] });
    expect(() =>
      graph.store.resolveRuntimeBinding("conversation-1", graph.conversations)
    ).toThrowError(expect.objectContaining({ code: "RUNTIME_CONTRACT_INCOMPATIBLE" }));
  });

  it("preserves an authorized explicit assignment and rejects cross-account bindings", () => {
    const graph = graphStore();
    expect(
      graph.store.assignConversationBinding({
        accountId: "account-1",
        activeShopId: "business-1",
        requestedBindingId: "binding-1"
      })
    ).toBe("binding-1");
    expect(() =>
      graph.store.assignConversationBinding({
        accountId: "account-2",
        activeShopId: "business-1",
        requestedBindingId: "binding-1"
      })
    ).toThrowError(expect.objectContaining({ code: "RUNTIME_BINDING_FORBIDDEN" }));
  });
});

function graphStore() {
  const store = new NativeRuntimeBindingStore();
  store.clear();
  store.agentsMap.set("agent-1", agentRecord());
  for (const modelId of [
    "model-primary",
    "model-fallback-0",
    "model-fallback-1",
    "model-verifier"
  ]) {
    store.modelsMap.set(modelId, modelRecord(modelId));
  }
  for (const hostId of ["host-primary", "host-fallback-0", "host-fallback-1", "host-verifier"]) {
    store.hostsMap.set(hostId, hostRecord(hostId));
  }
  for (const [installationId, modelId, hostId] of [
    ["installation-primary", "model-primary", "host-primary"],
    ["installation-fallback-0", "model-fallback-0", "host-fallback-0"],
    ["installation-fallback-1", "model-fallback-1", "host-fallback-1"],
    ["installation-verifier", "model-verifier", "host-verifier"]
  ]) {
    store.installationsMap.set(installationId, installationRecord(installationId, modelId, hostId));
  }
  store.bindingsMap.set("binding-1", bindingRecord());
  for (const role of [
    roleRecord("primary-role", "model-primary", "primary", 0, "host-primary"),
    roleRecord("fallback-role-1", "model-fallback-1", "fallback", 1, "host-fallback-1"),
    roleRecord("fallback-role-0", "model-fallback-0", "fallback", 0, "host-fallback-0"),
    roleRecord("verifier-role", "model-verifier", "verifier", 0, "host-verifier")
  ]) {
    store.bindingModelsMap.set(role.id, role);
  }
  const conversation = conversationRecord("binding-1");
  return { store, conversations: new Map([[conversation.id, conversation]]) };
}

function agentRecord(): NativeRuntimeAgentSummary {
  return {
    id: "agent-1",
    businessId: "business-1",
    accountId: "account-1",
    name: "Agent",
    provider: "test",
    packageRef: null,
    version: "1",
    runtimeContractVersion: "1",
    capabilities: ["tools"],
    configuration: { requiredModelCapabilities: ["tool-routing"] },
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function modelRecord(id: string): NativeRuntimeModelSummary {
  return {
    id,
    name: id,
    provider: "test",
    providerModelId: id,
    runtimeContractVersion: "1",
    capabilities: ["chat", "tool-routing"],
    configuration: { executionTarget: "backend" },
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function hostRecord(id: string): NativeExecutionHostSummary {
  return {
    id,
    businessId: "business-1",
    accountId: "account-1",
    type: "backend",
    name: id,
    endpoint: null,
    status: "available",
    capabilities: ["backend"],
    configuration: {},
    credentialReference: null,
    lastKnownHealthyAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function installationRecord(
  id: string,
  modelId: string,
  executionHostId: string
): NativeModelInstallationSummary {
  return {
    id,
    modelId,
    executionHostId,
    status: "available",
    configuration: {},
    lastKnownHealthyAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function bindingRecord(): NativeRuntimeBindingSummary {
  return {
    id: "binding-1",
    businessId: "business-1",
    accountId: "account-1",
    agentId: "agent-1",
    name: "Binding",
    status: "active",
    isDefault: false,
    configuration: {},
    runtimeContractVersion: "1",
    createdAt: timestamp,
    updatedAt: timestamp,
    updatedBy: "user-1"
  };
}

function roleRecord(
  id: string,
  modelId: string,
  role: string,
  priority: number,
  executionHostId: string
): NativeRuntimeBindingModelSummary {
  return {
    id,
    runtimeBindingId: "binding-1",
    modelId,
    role,
    priority,
    executionHostId,
    configuration: {},
    enabled: true,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function conversationRecord(runtimeBindingId: string | null): ConversationSummary {
  return {
    id: "conversation-1",
    accountId: "account-1",
    kind: "personal",
    activeShopId: "business-1",
    runtimeBindingId,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function setHostStatus(
  store: NativeRuntimeBindingStore,
  id: string,
  status: NativeExecutionHostSummary["status"]
) {
  store.hostsMap.set(id, { ...(store.hostsMap.get(id) as NativeExecutionHostSummary), status });
}

function setInstallationStatus(
  store: NativeRuntimeBindingStore,
  id: string,
  status: NativeModelInstallationSummary["status"]
) {
  store.installationsMap.set(id, {
    ...(store.installationsMap.get(id) as NativeModelInstallationSummary),
    status
  });
}
