import { describe, expect, it } from "vitest";
import type { InstalledAgentModelSummary } from "../packages/shared-types/src/index";
import { createCp2Store } from "../services/api/src/cp2/store";

function seedOwner(phone: string) {
  const store = createCp2Store();
  const auth = store.signupWithPhonePin({ destination: phone, pin: "2468" });
  const created = store.createBusiness({
    sessionId: auth.session.id,
    name: "Local Model Shop",
    language: "en"
  });
  return { store, auth, businessId: created.business.id };
}

function model(
  id: string,
  overrides: Partial<Omit<InstalledAgentModelSummary, "accountId" | "userId">> = {}
): Omit<InstalledAgentModelSummary, "accountId" | "userId"> {
  return {
    id,
    deviceId: "device-a",
    modelId: `custom:${id}`,
    displayName: "Shop Model",
    provider: "custom",
    repositoryId: null,
    filename: `${id}.gguf`,
    format: "GGUF",
    quantization: "Q4_K_M",
    architecture: "llama",
    parameterCount: 500_000_000,
    contextLength: 2_048,
    fileSizeBytes: 400_000_000,
    checksum: null,
    license: "Apache-2.0",
    commercialUseAllowed: true,
    storageKey: `${id}.gguf`,
    runtimeBackend: "LLAMA_CPP_ANDROID",
    installationStatus: "INSTALLED",
    compatibilityStatus: "COMPATIBLE",
    installedAt: "2026-07-19T00:00:00.000Z",
    lastVerifiedAt: "2026-07-19T00:00:00.000Z",
    validationError: null,
    ...overrides
  };
}

describe("agent model assignments", () => {
  it("attaches a verified compatible installation and survives restart", () => {
    const { store, auth, businessId } = seedOwner("+254700700001");
    const cloudFallbackBeforeBinding = store.getActiveAiModel({
      sessionId: auth.session.id,
      businessId
    });
    store.registerInstalledAgentModel({
      sessionId: auth.session.id,
      model: model("valid-model")
    });
    const assignment = store.assignAgentModel({
      sessionId: auth.session.id,
      businessId,
      deviceId: "device-a",
      installationId: "valid-model",
      preferredExecutionMode: "LOCAL_ONLY",
      fallbackPolicy: "NEVER",
      readinessStatus: "READY",
      lastSuccessfulInferenceAt: "2026-07-19T00:01:00.000Z",
      lastErrorCode: null
    });
    const restored = createCp2Store();
    restored.hydrateSnapshot(store.snapshot());

    expect(assignment).toMatchObject({
      activeModelInstallationId: "valid-model",
      preferredExecutionMode: "LOCAL_ONLY",
      fallbackPolicy: "NEVER"
    });
    expect(store.getActiveAiModel({ sessionId: auth.session.id, businessId }).modelId).toBe(
      cloudFallbackBeforeBinding.modelId
    );
    expect(
      restored.getAgentModelAssignment({
        sessionId: auth.session.id,
        businessId,
        deviceId: "device-a"
      })
    ).toEqual(assignment);
  });

  it.each([
    ["missing", undefined, "model_installation_not_found"],
    [
      "incompatible",
      model("incompatible", { compatibilityStatus: "INCOMPATIBLE" }),
      "model_incompatible"
    ],
    [
      "restricted",
      model("restricted", { commercialUseAllowed: false }),
      "model_license_restricted"
    ],
    ["corrupt", model("corrupt", { installationStatus: "CORRUPT" }), "model_not_installed"]
  ])("rejects a %s installation", (_label, installation, code) => {
    const { store, auth, businessId } = seedOwner(
      `+2547007${String(code.length).padStart(5, "0")}`
    );
    if (installation !== undefined) {
      store.registerInstalledAgentModel({ sessionId: auth.session.id, model: installation });
    }

    expect(() =>
      store.assignAgentModel({
        sessionId: auth.session.id,
        businessId,
        deviceId: "device-a",
        installationId: installation?.id ?? "missing",
        preferredExecutionMode: "LOCAL_FIRST",
        fallbackPolicy: "WHEN_LOCAL_UNAVAILABLE",
        readinessStatus: "READY",
        lastSuccessfulInferenceAt: "2026-07-19T00:01:00.000Z",
        lastErrorCode: null
      })
    ).toThrowError(expect.objectContaining({ code }));
  });

  it("enforces user and device ownership", () => {
    const owner = seedOwner("+254700700010");
    const other = owner.store.signupWithPhonePin({
      destination: "+254700700011",
      pin: "2468"
    });
    owner.store.registerInstalledAgentModel({
      sessionId: owner.auth.session.id,
      model: model("private-model")
    });

    expect(
      owner.store.listInstalledAgentModels({
        sessionId: owner.auth.session.id,
        deviceId: "another-device"
      })
    ).toEqual([]);
    expect(() =>
      owner.store.assignAgentModel({
        sessionId: other.session.id,
        businessId: owner.businessId,
        deviceId: "device-a",
        installationId: "private-model",
        preferredExecutionMode: "LOCAL_FIRST",
        fallbackPolicy: "WHEN_LOCAL_UNAVAILABLE",
        readinessStatus: "READY",
        lastSuccessfulInferenceAt: "2026-07-19T00:01:00.000Z",
        lastErrorCode: null
      })
    ).toThrowError(expect.objectContaining({ code: "membership_required" }));
  });

  it("normalizes signed package metadata and rejects incomplete or malformed integrity data", () => {
    const { store, auth } = seedOwner("+254700700012");
    const signed = store.registerInstalledAgentModel({
      sessionId: auth.session.id,
      model: model("signed-model", {
        checksum: `sha256:${"A".repeat(64)}`,
        packageManifestVersion: "1.0",
        packageSignature: "base64-ed25519-signature",
        packageSigningKeyId: "soko-model-key-1"
      })
    });
    expect(signed).toMatchObject({
      checksum: "a".repeat(64),
      packageManifestVersion: "1.0",
      packageSigningKeyId: "soko-model-key-1"
    });

    for (const [overrides, code] of [
      [{ checksum: "not-a-sha256" }, "model_checksum_invalid"],
      [{ checksum: "a".repeat(64), packageManifestVersion: "1.0" }, "model_package_incomplete"],
      [
        {
          checksum: "a".repeat(64),
          packageManifestVersion: "2.0",
          packageSignature: "signature",
          packageSigningKeyId: "key"
        },
        "model_package_version_unsupported"
      ]
    ] as const) {
      expect(() =>
        store.registerInstalledAgentModel({
          sessionId: auth.session.id,
          model: model(`invalid-${code}`, overrides)
        })
      ).toThrowError(expect.objectContaining({ code }));
    }
  });

  it("does not activate an attached model before a successful inference", () => {
    const { store, auth, businessId } = seedOwner("+254700700020");
    store.registerInstalledAgentModel({
      sessionId: auth.session.id,
      model: model("untested-model")
    });

    const previousActiveModel = store.getActiveAiModel({
      sessionId: auth.session.id,
      businessId
    });
    const assignment = store.assignAgentModel({
      sessionId: auth.session.id,
      businessId,
      deviceId: "device-a",
      installationId: "untested-model",
      preferredExecutionMode: "LOCAL_FIRST",
      fallbackPolicy: "WHEN_LOCAL_UNAVAILABLE",
      readinessStatus: "LOADING",
      lastSuccessfulInferenceAt: null,
      lastErrorCode: null
    });

    expect(assignment).toMatchObject({
      activeModelInstallationId: "untested-model",
      modelId: "custom:untested-model",
      readinessStatus: "LOADING"
    });
    expect(store.getActiveAiModel({ sessionId: auth.session.id, businessId }).modelId).toBe(
      previousActiveModel.modelId
    );
  });

  it("still requires a successful inference timestamp to promote a binding", () => {
    const { store, auth, businessId } = seedOwner("+254700700021");
    store.registerInstalledAgentModel({
      sessionId: auth.session.id,
      model: model("untested-ready-model")
    });

    expect(() =>
      store.assignAgentModel({
        sessionId: auth.session.id,
        businessId,
        deviceId: "device-a",
        installationId: "untested-ready-model",
        preferredExecutionMode: "LOCAL_FIRST",
        fallbackPolicy: "WHEN_LOCAL_UNAVAILABLE",
        readinessStatus: "READY",
        lastSuccessfulInferenceAt: null,
        lastErrorCode: null
      })
    ).toThrowError(expect.objectContaining({ code: "agent_model_not_ready" }));
  });
});
