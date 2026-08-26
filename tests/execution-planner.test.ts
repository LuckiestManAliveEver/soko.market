import { describe, expect, it } from "vitest";
import {
  filterCandidates,
  generateCandidates,
  planExecution,
  resolveModelPreference,
  scoreCandidates,
  selectCandidate,
  defaultPlannerWeights,
  type ModelPreferenceCandidate,
  type PlannerInput,
  type PrecedenceInput,
  type ReconciledModel,
  type RuntimeHostCandidateInput
} from "../packages/execution-planner/src/index";

function preference(overrides: Partial<ModelPreferenceCandidate> = {}): ModelPreferenceCandidate {
  return {
    scope: "system",
    preferredModelIds: [],
    fallbackModelIds: [],
    requiredCapabilities: [],
    executionPreference: "balanced",
    qualityPreference: "balanced",
    allowCloudFallback: true,
    maxCostPerRequest: null,
    maxLatencyMs: null,
    minimumContextWindow: null,
    ...overrides
  };
}

function host(overrides: Partial<RuntimeHostCandidateInput> = {}): RuntimeHostCandidateInput {
  return {
    host: {
      id: "host-1",
      accountId: "account-1",
      ownerId: "user-1",
      name: "Test host",
      trustLevel: "owner-verified",
      brokerNodeId: null,
      declaredRuntimes: ["native-llama-cpp"],
      maxConcurrentJobs: 1,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z"
    },
    installations: [],
    online: true,
    warmModelIds: [],
    availableMemoryGb: 8,
    ...overrides
  };
}

function installation(modelId: string, runtimeHostId = "host-1") {
  return {
    id: `install-${modelId}`,
    runtimeHostId,
    accountId: "account-1",
    modelId,
    status: "installed" as const,
    installedAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z"
  };
}

function localModel(id: string, overrides: Partial<ReconciledModel> = {}): ReconciledModel {
  return {
    id,
    label: id,
    executionTarget: "local",
    capabilities: ["chat"],
    contextWindow: 8_192,
    minimumMemoryGb: 2,
    sources: ["aiModelRegistry"],
    ...overrides
  };
}

function precedenceAllNull(system: ModelPreferenceCandidate): PrecedenceInput {
  return { request: null, conversation: null, agent: null, user: null, system };
}

describe("execution planner precedence", () => {
  it("resolves system when nothing else is set", () => {
    const system = preference({ preferredModelIds: ["a"] });
    const result = resolveModelPreference(precedenceAllNull(system));
    expect(result.level).toBe("system");
    expect(result.preference).toEqual(system);
  });

  it("user beats system", () => {
    const system = preference({ preferredModelIds: ["system-model"] });
    const user = preference({ preferredModelIds: ["user-model"] });
    const result = resolveModelPreference({ ...precedenceAllNull(system), user });
    expect(result.level).toBe("user");
    expect(result.preference.preferredModelIds).toEqual(["user-model"]);
  });

  it("agent beats user and system", () => {
    const system = preference({ preferredModelIds: ["system-model"] });
    const user = preference({ preferredModelIds: ["user-model"] });
    const agent = preference({ preferredModelIds: ["agent-model"] });
    const result = resolveModelPreference({ ...precedenceAllNull(system), user, agent });
    expect(result.level).toBe("agent");
    expect(result.preference.preferredModelIds).toEqual(["agent-model"]);
  });

  it("conversation beats agent, user, and system", () => {
    const system = preference({ preferredModelIds: ["system-model"] });
    const agent = preference({ preferredModelIds: ["agent-model"] });
    const conversation = preference({ preferredModelIds: ["conversation-model"] });
    const result = resolveModelPreference({ ...precedenceAllNull(system), agent, conversation });
    expect(result.level).toBe("conversation");
    expect(result.preference.preferredModelIds).toEqual(["conversation-model"]);
  });

  it("request beats every other level", () => {
    const system = preference({ preferredModelIds: ["system-model"] });
    const conversation = preference({ preferredModelIds: ["conversation-model"] });
    const request = preference({ preferredModelIds: ["request-model"] });
    const result = resolveModelPreference({ ...precedenceAllNull(system), conversation, request });
    expect(result.level).toBe("request");
    expect(result.preference.preferredModelIds).toEqual(["request-model"]);
  });

  it("is deterministic - identical input always resolves the same level and preference", () => {
    const system = preference({ preferredModelIds: ["system-model"] });
    const agent = preference({ preferredModelIds: ["agent-model"] });
    const input: PrecedenceInput = { ...precedenceAllNull(system), agent };
    const first = resolveModelPreference(input);
    const second = resolveModelPreference(input);
    expect(first).toEqual(second);
  });
});

describe("execution planner candidate filtering", () => {
  it("rejects with INSUFFICIENT_MEMORY when the host has less memory than the model needs", () => {
    const bigModel = localModel("big-model", { minimumMemoryGb: 16 });
    const registry = [bigModel];
    const smallHost = host({ availableMemoryGb: 4, installations: [installation("big-model")] });
    const raw = generateCandidates([smallHost], registry);
    const { accepted, rejected } = filterCandidates(raw, {
      preference: preference(),
      hosts: [smallHost],
      registry,
      constraints: {}
    });
    expect(accepted).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.rejectionReason).toBe("INSUFFICIENT_MEMORY");
  });

  it("rejects with TOOL_CAPABILITY_MISMATCH when requiresToolCalling and the model lacks tool-routing", () => {
    const chatOnlyModel = localModel("chat-only", { capabilities: ["chat"] });
    const registry = [chatOnlyModel];
    const oneHost = host({ installations: [installation("chat-only")] });
    const raw = generateCandidates([oneHost], registry);
    const { accepted, rejected } = filterCandidates(raw, {
      preference: preference(),
      hosts: [oneHost],
      registry,
      constraints: { requiresToolCalling: true }
    });
    expect(accepted).toHaveLength(0);
    expect(rejected[0]!.rejectionReason).toBe("TOOL_CAPABILITY_MISMATCH");
  });

  it("accepts a tool-capable model when requiresToolCalling is set", () => {
    const toolModel = localModel("tool-model", { capabilities: ["chat", "tool-routing"] });
    const registry = [toolModel];
    const oneHost = host({ installations: [installation("tool-model")] });
    const raw = generateCandidates([oneHost], registry);
    const { accepted, rejected } = filterCandidates(raw, {
      preference: preference(),
      hosts: [oneHost],
      registry,
      constraints: { requiresToolCalling: true }
    });
    expect(rejected).toHaveLength(0);
    expect(accepted).toHaveLength(1);
  });

  it("rejects with HOST_OFFLINE when the host is not reachable", () => {
    const model = localModel("model-a");
    const registry = [model];
    const offlineHost = host({ online: false, installations: [installation("model-a")] });
    const raw = generateCandidates([offlineHost], registry);
    const { accepted, rejected } = filterCandidates(raw, {
      preference: preference(),
      hosts: [offlineHost],
      registry,
      constraints: {}
    });
    expect(accepted).toHaveLength(0);
    expect(rejected[0]!.rejectionReason).toBe("HOST_OFFLINE");
  });

  it("rejects with CLOUD_FALLBACK_DISABLED when a cloud candidate exists but the preference forbids it", () => {
    const cloudModel = localModel("gpt-cloud", { executionTarget: "cloud", minimumMemoryGb: null });
    const registry = [cloudModel];
    const raw = generateCandidates([], registry);
    const { accepted, rejected } = filterCandidates(raw, {
      preference: preference({ allowCloudFallback: false }),
      hosts: [],
      registry,
      constraints: {}
    });
    expect(accepted).toHaveLength(0);
    expect(rejected[0]!.rejectionReason).toBe("CLOUD_FALLBACK_DISABLED");
  });

  it("accepts the same cloud candidate when the preference allows cloud fallback", () => {
    const cloudModel = localModel("gpt-cloud", { executionTarget: "cloud", minimumMemoryGb: null });
    const registry = [cloudModel];
    const raw = generateCandidates([], registry);
    const { accepted, rejected } = filterCandidates(raw, {
      preference: preference({ allowCloudFallback: true }),
      hosts: [],
      registry,
      constraints: {}
    });
    expect(rejected).toHaveLength(0);
    expect(accepted).toHaveLength(1);
  });

  it("rejects with CONTEXT_WINDOW_TOO_SMALL when the model's window is below the requirement", () => {
    const smallWindowModel = localModel("small-window", { contextWindow: 2_048 });
    const registry = [smallWindowModel];
    const oneHost = host({ installations: [installation("small-window")] });
    const raw = generateCandidates([oneHost], registry);
    const { rejected } = filterCandidates(raw, {
      preference: preference({ minimumContextWindow: 8_192 }),
      hosts: [oneHost],
      registry,
      constraints: {}
    });
    expect(rejected[0]!.rejectionReason).toBe("CONTEXT_WINDOW_TOO_SMALL");
  });

  it("manual required host: candidates on any other host are rejected with REQUIRED_HOST_MISMATCH (hard constraint)", () => {
    const model = localModel("model-a");
    const registry = [model];
    const hostA = host({
      host: { ...host().host, id: "host-a" },
      installations: [installation("model-a", "host-a")]
    });
    const hostB = host({
      host: { ...host().host, id: "host-b" },
      installations: [installation("model-a", "host-b")]
    });
    const raw = generateCandidates([hostA, hostB], registry);
    const { accepted, rejected } = filterCandidates(raw, {
      preference: preference(),
      hosts: [hostA, hostB],
      registry,
      constraints: { requiredHostId: "host-a" }
    });
    expect(accepted).toHaveLength(1);
    expect(accepted[0]!.hostId).toBe("host-a");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.hostId).toBe("host-b");
    expect(rejected[0]!.rejectionReason).toBe("REQUIRED_HOST_MISMATCH");
  });

  it("manual preferred host (soft): both hosts' candidates are accepted, unlike a required host", () => {
    const model = localModel("model-a");
    const registry = [model];
    const hostA = host({
      host: { ...host().host, id: "host-a" },
      installations: [installation("model-a", "host-a")]
    });
    const hostB = host({
      host: { ...host().host, id: "host-b" },
      installations: [installation("model-a", "host-b")]
    });
    const raw = generateCandidates([hostA, hostB], registry);
    const { accepted, rejected } = filterCandidates(raw, {
      preference: preference(),
      hosts: [hostA, hostB],
      registry,
      constraints: { preferredHostId: "host-a" } // soft - not required
    });
    expect(rejected).toHaveLength(0);
    expect(accepted).toHaveLength(2);
  });
});

describe("execution planner scoring and selection", () => {
  it("selects the preferred model when it is available on the preferred host", () => {
    const preferredModel = localModel("preferred-model");
    const otherModel = localModel("other-model");
    const registry = [preferredModel, otherModel];
    const oneHost = host({
      installations: [installation("preferred-model"), installation("other-model")]
    });
    const scored = scoreCandidates(
      generateCandidates([oneHost], registry).map((candidate) => candidate),
      {
        preference: preference({ preferredModelIds: ["preferred-model"] }),
        hosts: [oneHost],
        registry,
        weights: defaultPlannerWeights,
        requestOriginHostId: undefined,
        preferredHostId: undefined
      }
    );
    const selected = selectCandidate(scored);
    expect(selected?.modelId).toBe("preferred-model");
  });

  it("falls back to the next preferred model when the top preference is not installed anywhere", () => {
    const secondChoice = localModel("second-choice");
    const registry = [secondChoice];
    const oneHost = host({ installations: [installation("second-choice")] });
    const candidates = generateCandidates([oneHost], registry);
    const { accepted } = filterCandidates(candidates, {
      preference: preference({ preferredModelIds: ["not-installed-anywhere", "second-choice"] }),
      hosts: [oneHost],
      registry,
      constraints: {}
    });
    const scored = scoreCandidates(accepted, {
      preference: preference({ preferredModelIds: ["not-installed-anywhere", "second-choice"] }),
      hosts: [oneHost],
      registry,
      weights: defaultPlannerWeights,
      requestOriginHostId: undefined,
      preferredHostId: undefined
    });
    const selected = selectCandidate(scored);
    expect(selected?.modelId).toBe("second-choice");
  });

  it("local-first vs cloud-first policy changes which of two otherwise-equal candidates wins", () => {
    const localOption = localModel("local-option", { minimumMemoryGb: null });
    const cloudOption = localModel("cloud-option", { executionTarget: "cloud", minimumMemoryGb: null });
    const registry = [localOption, cloudOption];
    const oneHost = host({ installations: [installation("local-option")] });
    // Isolate the signal under test: zero every weight except `locality` (the one
    // executionPreference alignment feeds into), and keep neither model in any preference list,
    // so modelPreferenceRank/hostHealth/warmModel/latency/privacy/costPenalty cannot confound the
    // result - this test proves the policy signal itself flips the outcome, not that it
    // overpowers every other realistic signal (cost/privacy legitimately still favor local even
    // under a stated cloud-first policy in the default weighting, which is intentional).
    const isolatedWeights = {
      modelPreferenceRank: 0,
      locality: 1,
      hostHealth: 0,
      warmModel: 0,
      latency: 0,
      privacy: 0,
      costPenalty: 0
    };

    const localFirst = preference({ executionPreference: "local-first" });
    const localFirstCandidates = generateCandidates([oneHost], registry);
    const localFirstFiltered = filterCandidates(localFirstCandidates, {
      preference: localFirst,
      hosts: [oneHost],
      registry,
      constraints: {}
    });
    const localFirstScored = scoreCandidates(localFirstFiltered.accepted, {
      preference: localFirst,
      hosts: [oneHost],
      registry,
      weights: isolatedWeights,
      requestOriginHostId: undefined,
      preferredHostId: undefined
    });
    expect(selectCandidate(localFirstScored)?.modelId).toBe("local-option");

    const cloudFirst = preference({ executionPreference: "cloud-first" });
    const cloudFirstCandidates = generateCandidates([oneHost], registry);
    const cloudFirstFiltered = filterCandidates(cloudFirstCandidates, {
      preference: cloudFirst,
      hosts: [oneHost],
      registry,
      constraints: {}
    });
    const cloudFirstScored = scoreCandidates(cloudFirstFiltered.accepted, {
      preference: cloudFirst,
      hosts: [oneHost],
      registry,
      weights: isolatedWeights,
      requestOriginHostId: undefined,
      preferredHostId: undefined
    });
    expect(selectCandidate(cloudFirstScored)?.modelId).toBe("cloud-option");
  });

  it("warm-model affinity affects score when preference quality is otherwise close", () => {
    const modelA = localModel("model-a");
    const modelB = localModel("model-b");
    const registry = [modelA, modelB];
    const oneHost = host({
      installations: [installation("model-a"), installation("model-b")],
      warmModelIds: ["model-b"]
    });
    // Both models are equally preferred (same rank position is impossible for two ids in one
    // array, so use two separate single-preference calls to keep modelPreferenceRank identical:
    // neither is in preferredModelIds/fallbackModelIds at all, so both score 0 on that signal).
    const evenPreference = preference();
    const candidates = generateCandidates([oneHost], registry);
    const { accepted } = filterCandidates(candidates, {
      preference: evenPreference,
      hosts: [oneHost],
      registry,
      constraints: {}
    });
    const scored = scoreCandidates(accepted, {
      preference: evenPreference,
      hosts: [oneHost],
      registry,
      weights: defaultPlannerWeights,
      requestOriginHostId: undefined,
      preferredHostId: undefined
    });
    const selected = selectCandidate(scored);
    expect(selected?.modelId).toBe("model-b");
  });

  it("changing weights changes the resolved candidate (determinism/tunability requirement)", () => {
    // executionTarget "backend" (not "local"): a "local" model would need an actual host
    // installation to ever become a candidate (generateCandidates only creates local candidates
    // from real installations), and this test intentionally passes hosts: [] to keep the scenario
    // to exactly two directly-comparable non-host-bound candidates.
    const cheapButUnpreferred = localModel("cheap-model", {
      executionTarget: "backend",
      minimumMemoryGb: null
    });
    const preferredButExpensive = localModel("preferred-cloud", {
      executionTarget: "cloud",
      minimumMemoryGb: null
    });
    const registry = [cheapButUnpreferred, preferredButExpensive];
    const modelPreference = preference({
      preferredModelIds: ["preferred-cloud"],
      allowCloudFallback: true
    });
    const candidates = generateCandidates([], registry);
    const { accepted } = filterCandidates(candidates, {
      preference: modelPreference,
      hosts: [],
      registry,
      constraints: {}
    });

    const preferenceHeavyWeights = { ...defaultPlannerWeights, modelPreferenceRank: 10, costPenalty: 0 };
    const preferenceHeavyScored = scoreCandidates(accepted, {
      preference: modelPreference,
      hosts: [],
      registry,
      weights: preferenceHeavyWeights,
      requestOriginHostId: undefined,
      preferredHostId: undefined
    });
    expect(selectCandidate(preferenceHeavyScored)?.modelId).toBe("preferred-cloud");

    const costHeavyWeights = { ...defaultPlannerWeights, modelPreferenceRank: 0.1, costPenalty: 20 };
    const costHeavyScored = scoreCandidates(accepted, {
      preference: modelPreference,
      hosts: [],
      registry,
      weights: costHeavyWeights,
      requestOriginHostId: undefined,
      preferredHostId: undefined
    });
    expect(selectCandidate(costHeavyScored)?.modelId).toBe("cheap-model");
  });
});

describe("execution planner end-to-end (planExecution)", () => {
  it("produces a full plan naming the resolved precedence level and a full audit trail of rejections", () => {
    const winner = localModel("winner");
    const registry = [winner];
    const oneHost = host({ installations: [installation("winner")] });
    const input: PlannerInput = {
      precedence: precedenceAllNull(preference({ preferredModelIds: ["winner"] })),
      hosts: [oneHost],
      registry,
      constraints: {},
      weights: defaultPlannerWeights
    };
    const plan = planExecution(input);
    expect(plan.resolvedPrecedenceLevel).toBe("system");
    expect(plan.selected?.modelId).toBe("winner");
    expect(plan.rejected).toEqual([]);
    expect(plan.generatedAt).toEqual(expect.any(String));
  });

  it("returns selected: null (not a thrown error) when every candidate is rejected", () => {
    const onlyModel = localModel("only-model", { minimumMemoryGb: 64 });
    const registry = [onlyModel];
    const tinyHost = host({ availableMemoryGb: 1, installations: [installation("only-model")] });
    const plan = planExecution({
      precedence: precedenceAllNull(preference()),
      hosts: [tinyHost],
      registry,
      constraints: {},
      weights: defaultPlannerWeights
    });
    expect(plan.selected).toBeNull();
    expect(plan.rejected).toHaveLength(1);
    expect(plan.rejected[0]!.rejectionReason).toBe("INSUFFICIENT_MEMORY");
  });

  it("buildExecutionPlan never includes the selected candidate inside alternatives", () => {
    const modelA = localModel("model-a");
    const modelB = localModel("model-b");
    const registry = [modelA, modelB];
    const oneHost = host({ installations: [installation("model-a"), installation("model-b")] });
    const plan = planExecution({
      precedence: precedenceAllNull(preference({ preferredModelIds: ["model-a"] })),
      hosts: [oneHost],
      registry,
      constraints: {},
      weights: defaultPlannerWeights
    });
    expect(plan.selected?.modelId).toBe("model-a");
    expect(plan.alternatives.some((candidate) => candidate.modelId === "model-a")).toBe(false);
    expect(plan.alternatives.some((candidate) => candidate.modelId === "model-b")).toBe(true);
  });
});

describe("buildExecutionPlan / selectCandidate determinism", () => {
  it("selectCandidate breaks a score tie deterministically by hostId then modelId", () => {
    const tiedWeights = { ...defaultPlannerWeights, modelPreferenceRank: 0, warmModel: 0, hostHealth: 0 };
    const candidates = scoreCandidates(
      [
        { hostId: "host-z", host: null, modelId: "model-a", model: localModel("model-a") },
        { hostId: "host-a", host: null, modelId: "model-a", model: localModel("model-a") }
      ],
      {
        preference: preference(),
        hosts: [],
        registry: [],
        weights: tiedWeights,
        requestOriginHostId: undefined,
        preferredHostId: undefined
      }
    );
    const first = selectCandidate(candidates);
    const second = selectCandidate([...candidates].reverse());
    expect(first).toEqual(second);
    expect(first?.hostId).toBe("host-a");
  });
});
