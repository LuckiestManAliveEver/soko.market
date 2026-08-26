import { describe, expect, it } from "vitest";
import { createCp2Store } from "../services/api/src/cp2/store";
import { ExecutionFabricStore } from "../services/api/src/cp2/domains/execution-fabric/store";

function seedOwner(phone: string) {
  const store = createCp2Store();
  const auth = store.signupWithPhonePin({ destination: phone, pin: "1234" });
  const business = store.createBusiness({
    sessionId: auth.session.id,
    name: "Execution Fabric Test Shop",
    language: "en"
  });
  const businessId = business.business.id;
  // Establish a real, stored profile (not the freshly-computed default createDefaultBusinessAgentProfile
  // returns when none is stored yet, whose updatedAt is `new Date()` at read time and would make two
  // getAgentProfile() calls compare unequal even with zero real changes).
  store.updateAgentProfile({
    sessionId: auth.session.id,
    businessId,
    profile: {
      name: "Shopkeeper",
      description: "A friendly shop agent.",
      modelId: "qwen2.5-0.5b-android",
      role: "Shopkeeper",
      language: "en",
      personality: "Friendly and helpful.",
      instructions: "Help customers find products and answer questions.",
      knowledge: "General shop knowledge.",
      tools: [],
      integrations: [],
      contextScripts: [],
      status: "active"
    }
  });
  return { store, auth, businessId, accountId: auth.account.id };
}

describe("ExecutionFabricStore - basic CRUD", () => {
  it("creates and retrieves a model preference at a given scope", () => {
    const fabric = new ExecutionFabricStore();
    const created = fabric.createModelPreference({
      tenantId: "business-1",
      scope: "agent",
      scopeId: "business-1",
      preferredModelIds: ["model-a"],
      fallbackModelIds: [],
      requiredCapabilities: [],
      executionPreference: "balanced",
      qualityPreference: "balanced",
      allowCloudFallback: true,
      maxCostPerRequest: null,
      maxLatencyMs: null,
      minimumContextWindow: null,
      updatedBy: "user-1"
    });
    expect(created.preferredModelIds).toEqual(["model-a"]);
    const fetched = fabric.getModelPreference("business-1", "agent", "business-1");
    expect(fetched).toEqual(created);
  });

  it("upserts in place - re-creating at the same scope updates rather than duplicates", () => {
    const fabric = new ExecutionFabricStore();
    const first = fabric.createModelPreference({
      tenantId: "business-1",
      scope: "agent",
      scopeId: "business-1",
      preferredModelIds: ["model-a"],
      fallbackModelIds: [],
      requiredCapabilities: [],
      executionPreference: "balanced",
      qualityPreference: "balanced",
      allowCloudFallback: true,
      maxCostPerRequest: null,
      maxLatencyMs: null,
      minimumContextWindow: null,
      updatedBy: "user-1"
    });
    const second = fabric.createModelPreference({
      tenantId: "business-1",
      scope: "agent",
      scopeId: "business-1",
      preferredModelIds: ["model-b"],
      fallbackModelIds: [],
      requiredCapabilities: [],
      executionPreference: "balanced",
      qualityPreference: "balanced",
      allowCloudFallback: true,
      maxCostPerRequest: null,
      maxLatencyMs: null,
      minimumContextWindow: null,
      updatedBy: "user-1"
    });
    expect(second.id).toBe(first.id);
    expect(fabric.listModelPreferences("business-1")).toHaveLength(1);
    expect(fabric.listModelPreferences("business-1")[0]!.preferredModelIds).toEqual(["model-b"]);
  });

  it("rejects a model preference with no preferred and no fallback models", () => {
    const fabric = new ExecutionFabricStore();
    expect(() =>
      fabric.createModelPreference({
        tenantId: "business-1",
        scope: "system",
        scopeId: "system",
        preferredModelIds: [],
        fallbackModelIds: [],
        requiredCapabilities: [],
        executionPreference: "balanced",
        qualityPreference: "balanced",
        allowCloudFallback: true,
        maxCostPerRequest: null,
        maxLatencyMs: null,
        minimumContextWindow: null,
        updatedBy: "user-1"
      })
    ).toThrowError(expect.objectContaining({ code: "model_preference_empty" }));
  });

  it("registers a runtime host with identity + declared capabilities only, no liveness field", () => {
    const fabric = new ExecutionFabricStore();
    const host = fabric.registerRuntimeHost({
      accountId: "account-1",
      ownerId: "user-1",
      name: "Julien's laptop",
      trustLevel: "owner-verified",
      declaredRuntimes: ["native-llama-cpp"],
      maxConcurrentJobs: 2
    });
    expect(host).toMatchObject({
      accountId: "account-1",
      name: "Julien's laptop",
      trustLevel: "owner-verified"
    });
    expect(host).not.toHaveProperty("online");
    expect(host).not.toHaveProperty("lastHeartbeatAt");
    expect(fabric.getRuntimeHost(host.id)).toEqual(host);
    expect(fabric.listRuntimeHosts("account-1")).toEqual([host]);
  });

  it("installs a model on a host and lists only installed (not removed) installations", () => {
    const fabric = new ExecutionFabricStore();
    const host = fabric.registerRuntimeHost({
      accountId: "account-1",
      ownerId: "user-1",
      name: "Host",
      trustLevel: "owner-verified",
      declaredRuntimes: [],
      maxConcurrentJobs: 1
    });
    const installation = fabric.installRuntimeModel({
      runtimeHostId: host.id,
      accountId: "account-1",
      modelId: "qwen2.5-0.5b-android"
    });
    expect(installation.status).toBe("installed");
    expect(fabric.listRuntimeModelInstallations(host.id)).toEqual([installation]);

    fabric.removeRuntimeModelInstallation(installation.id, "account-1");
    expect(fabric.listRuntimeModelInstallations(host.id)).toEqual([]);
  });

  it("rejects installing a model on a host owned by a different account", () => {
    const fabric = new ExecutionFabricStore();
    const host = fabric.registerRuntimeHost({
      accountId: "account-1",
      ownerId: "user-1",
      name: "Host",
      trustLevel: "owner-verified",
      declaredRuntimes: [],
      maxConcurrentJobs: 1
    });
    expect(() =>
      fabric.installRuntimeModel({
        runtimeHostId: host.id,
        accountId: "account-2",
        modelId: "qwen2.5-0.5b-android"
      })
    ).toThrowError(expect.objectContaining({ code: "runtime_host_not_found" }));
  });
});

describe("swappability invariants", () => {
  it("changing agent (a different business/profile) does not mutate an existing RuntimeModelInstallation", () => {
    const owner = seedOwner("+254700900001");
    const fabric = new ExecutionFabricStore();
    const host = fabric.registerRuntimeHost({
      accountId: owner.accountId,
      ownerId: owner.auth.user.id,
      name: "Host",
      trustLevel: "owner-verified",
      declaredRuntimes: [],
      maxConcurrentJobs: 1
    });
    const installation = fabric.installRuntimeModel({
      runtimeHostId: host.id,
      accountId: owner.accountId,
      modelId: "qwen2.5-0.5b-android"
    });
    const before = fabric.listRuntimeModelInstallations(host.id);
    expect(before).toEqual([installation]);

    // "Change agent": update the business agent profile through the real, unrelated Cp2Store.
    owner.store.updateAgentProfile({
      sessionId: owner.auth.session.id,
      businessId: owner.businessId,
      profile: {
        name: "Renamed Agent",
        description: "A friendly shop agent.",
        modelId: "qwen2.5-1.5b-android",
        role: "Shopkeeper",
        language: "en",
        personality: "Friendly and helpful.",
        instructions: "Help customers find products and answer questions.",
        knowledge: "General shop knowledge.",
        tools: [],
        integrations: [],
        contextScripts: [],
        status: "active"
      }
    });

    const after = fabric.listRuntimeModelInstallations(host.id);
    expect(after).toEqual(before);
  });

  it("changing a model preference does not mutate the agent profile", () => {
    const owner = seedOwner("+254700900002");
    const fabric = new ExecutionFabricStore();
    const beforeProfile = owner.store.getAgentProfile({
      sessionId: owner.auth.session.id,
      businessId: owner.businessId
    });

    fabric.createModelPreference({
      tenantId: owner.businessId,
      scope: "agent",
      scopeId: owner.businessId,
      preferredModelIds: ["qwen2.5-0.5b-android"],
      fallbackModelIds: [],
      requiredCapabilities: [],
      executionPreference: "local-first",
      qualityPreference: "balanced",
      allowCloudFallback: false,
      maxCostPerRequest: null,
      maxLatencyMs: null,
      minimumContextWindow: null,
      updatedBy: owner.auth.user.id
    });

    const afterProfile = owner.store.getAgentProfile({
      sessionId: owner.auth.session.id,
      businessId: owner.businessId
    });
    expect(afterProfile).toEqual(beforeProfile);
  });

  it("changing/adding a runtime host does not mutate the agent profile or an existing model preference", () => {
    const owner = seedOwner("+254700900003");
    const fabric = new ExecutionFabricStore();
    const preference = fabric.createModelPreference({
      tenantId: owner.businessId,
      scope: "agent",
      scopeId: owner.businessId,
      preferredModelIds: ["qwen2.5-0.5b-android"],
      fallbackModelIds: [],
      requiredCapabilities: [],
      executionPreference: "balanced",
      qualityPreference: "balanced",
      allowCloudFallback: true,
      maxCostPerRequest: null,
      maxLatencyMs: null,
      minimumContextWindow: null,
      updatedBy: owner.auth.user.id
    });
    const beforeProfile = owner.store.getAgentProfile({
      sessionId: owner.auth.session.id,
      businessId: owner.businessId
    });

    fabric.registerRuntimeHost({
      accountId: owner.accountId,
      ownerId: owner.auth.user.id,
      name: "A brand-new device",
      trustLevel: "unverified",
      declaredRuntimes: ["browser-wasm"],
      maxConcurrentJobs: 1
    });

    expect(fabric.getModelPreference(owner.businessId, "agent", owner.businessId)).toEqual(
      preference
    );
    expect(
      owner.store.getAgentProfile({ sessionId: owner.auth.session.id, businessId: owner.businessId })
    ).toEqual(beforeProfile);
  });

  it("a new device/client accessing an existing agent needs no new agent record and installs no model unless explicitly asked", () => {
    const owner = seedOwner("+254700900004");
    const fabric = new ExecutionFabricStore();
    const beforeProfile = owner.store.getAgentProfile({
      sessionId: owner.auth.session.id,
      businessId: owner.businessId
    });

    // A second device belonging to the same account "shows up" - registering it is independent of
    // the agent entirely, and by itself installs no model.
    const secondDevice = fabric.registerRuntimeHost({
      accountId: owner.accountId,
      ownerId: owner.auth.user.id,
      name: "Second device",
      trustLevel: "unverified",
      declaredRuntimes: ["browser-wasm"],
      maxConcurrentJobs: 1
    });

    expect(
      owner.store.getAgentProfile({ sessionId: owner.auth.session.id, businessId: owner.businessId })
    ).toEqual(beforeProfile);
    expect(fabric.listRuntimeModelInstallations(secondDevice.id)).toEqual([]);

    // Only an explicit install call creates a RuntimeModelInstallation - never implicit.
    const installation = fabric.installRuntimeModel({
      runtimeHostId: secondDevice.id,
      accountId: owner.accountId,
      modelId: "qwen2.5-0.5b-android"
    });
    expect(fabric.listRuntimeModelInstallations(secondDevice.id)).toEqual([installation]);
  });
});
