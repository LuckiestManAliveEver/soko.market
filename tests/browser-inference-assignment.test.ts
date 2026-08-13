import { describe, expect, it } from "vitest";
import type { BrowserInferenceAssignmentSummary } from "../packages/shared-types/src";
import { buildApi } from "../services/api/src/app";
import { createCp2Store } from "../services/api/src/cp2/store";

const runtimeContract = {
  schemaVersion: 1,
  adapterId: "webllm",
  adapterVersion: "0.2.84",
  libraryRevision: "025bcaf3780fa8254f5e5efd3bfea0a5397248f4",
  runtime: "browser-webgpu",
  backend: "webgpu",
  streaming: true,
  cancellation: true,
  tokenCounting: "estimated",
  checkpointKinds: ["task-state"],
  nativeStateFormat: null
} as const;

const checkpointContract = {
  schemaVersion: 1,
  checkpointKind: "task-state",
  taskStateSchema: "soko.browser-task-state.v2",
  modelFamilyId: "smollm2-360m-instruct",
  sourceModelId: "smollm2-360m-instruct-webllm",
  sourceModelRevision: "3a622fd89e0216e8bb10c410c007c786baa8a033",
  sourceAdapterId: "webllm",
  promptRepresentation: "role-content-messages",
  portableAcrossAdapters: true
} as const;

describe("browser inference database assignment", () => {
  it("persists the portable runtime contract and execution health without prompt content", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });
    const owner = await createOwnerBusiness(app, "+254700001430");
    const readyAt = "2026-07-29T12:00:00.000Z";
    const assignment = await putJson<BrowserInferenceAssignmentSummary>(
      app,
      `/businesses/${owner.businessId}/browser-inference`,
      assignmentPayload(readyAt),
      owner.cookie
    );

    expect(assignment).toMatchObject({
      businessId: owner.businessId,
      deviceId: "browser-device-1",
      enabled: true,
      selectedModelId: checkpointContract.sourceModelId,
      modelFamilyId: checkpointContract.modelFamilyId,
      readinessStatus: "READY",
      lastSuccessfulInferenceAt: readyAt,
      runtimeContract,
      checkpointCompatibilityContract: checkpointContract
    });
    const persisted = store.snapshot().browserInferenceAssignments?.[0];
    expect(persisted).toEqual(assignment);
    expect(JSON.stringify(persisted)).not.toContain("systemPrompt");
    expect(JSON.stringify(persisted)).not.toContain('"messages"');
    expect(JSON.stringify(persisted)).not.toContain("generatedText");

    const executedAt = "2026-07-29T12:05:00.000Z";
    const executed = await postJson<BrowserInferenceAssignmentSummary>(
      app,
      `/businesses/${owner.businessId}/browser-inference/executions`,
      {
        deviceId: "browser-device-1",
        modelId: checkpointContract.sourceModelId,
        successful: true,
        errorCode: null,
        occurredAt: executedAt
      },
      owner.cookie
    );
    expect(executed.lastSuccessfulInferenceAt).toBe(executedAt);
    expect(executed.lastErrorCode).toBeNull();

    await app.close();
  });

  it("rejects contracts whose model, family, revision, and adapter identity do not match", async () => {
    const app = buildApi({ cp2: { store: createCp2Store() } });
    const owner = await createOwnerBusiness(app, "+254700001431");
    const response = await app.inject({
      method: "PUT",
      url: `/businesses/${owner.businessId}/browser-inference`,
      headers: { "content-type": "application/json", cookie: owner.cookie },
      payload: JSON.stringify({
        ...assignmentPayload("2026-07-29T12:00:00.000Z"),
        selectedModelId: "qwen2.5-0.5b-instruct-webllm"
      })
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "browser_inference_contract_mismatch" });
    await app.close();
  });

  it("rejects stale execution telemetry after a browser assignment is disabled", async () => {
    const app = buildApi({ cp2: { store: createCp2Store() } });
    const owner = await createOwnerBusiness(app, "+254700001433");
    await putJson(
      app,
      `/businesses/${owner.businessId}/browser-inference`,
      assignmentPayload("2026-07-29T12:00:00.000Z"),
      owner.cookie
    );
    await putJson(
      app,
      `/businesses/${owner.businessId}/browser-inference`,
      {
        ...assignmentPayload("2026-07-29T12:00:00.000Z"),
        enabled: false,
        readinessStatus: "ATTACHED"
      },
      owner.cookie
    );

    const response = await app.inject({
      method: "POST",
      url: `/businesses/${owner.businessId}/browser-inference/executions`,
      headers: { "content-type": "application/json", cookie: owner.cookie },
      payload: JSON.stringify({
        deviceId: "browser-device-1",
        modelId: checkpointContract.sourceModelId,
        successful: true,
        errorCode: null,
        occurredAt: "2026-07-29T12:05:00.000Z"
      })
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "browser_inference_assignment_inactive" });
    await app.close();
  });

  it("keeps browser and installed-model assignments separate and removes only browser metadata", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });
    const owner = await createOwnerBusiness(app, "+254700001432");
    await putJson(
      app,
      `/businesses/${owner.businessId}/browser-inference`,
      assignmentPayload("2026-07-29T12:00:00.000Z"),
      owner.cookie
    );

    const removed = await app.inject({
      method: "DELETE",
      url: `/businesses/${owner.businessId}/browser-inference?deviceId=browser-device-1`,
      headers: { cookie: owner.cookie }
    });
    expect(removed.statusCode).toBe(200);
    expect(store.snapshot().browserInferenceAssignments).toEqual([]);
    expect(store.snapshot().agentModelAssignments).toEqual([]);
    await app.close();
  });

  it("accepts a ready browser model proposal only through the canonical policy and confirmation pipeline", async () => {
    const app = buildApi({
      cp2: { store: createCp2Store({ modelRuntimeAdapterResolver: () => undefined }) }
    });
    const owner = await createOwnerBusiness(app, "+254700001434");
    await putJson(
      app,
      `/businesses/${owner.businessId}/browser-inference`,
      assignmentPayload("2026-07-29T12:00:00.000Z"),
      owner.cookie
    );

    const proposed = await postJson<{
      session: { id: string };
      turn: {
        status: string;
        model: { provider: string; executionTarget: string; modelId: string };
        plan: { toolName: string; confirmationToken: string | null; executedAt: string | null };
      };
    }>(
      app,
      `/businesses/${owner.businessId}/runtime/turns`,
      {
        message: "Handle this new stock item",
        clientInferenceCompletion: {
          requestId: "browser-request-1",
          runtime: "browser-webgpu",
          modelId: checkpointContract.sourceModelId,
          deviceId: "browser-device-1",
          outputText: JSON.stringify({
            type: "tool",
            toolName: "product.create",
            input: { name: "Local model tea", unit: "packet", quantity: 3 },
            reason: "Draft the product requested by the owner."
          }),
          durationMs: 820,
          promptTokens: 41,
          completionTokens: 22
        }
      },
      owner.cookie
    );

    expect(proposed.turn).toMatchObject({
      status: "needs_confirmation",
      model: {
        provider: "browser",
        executionTarget: "browser-local",
        modelId: checkpointContract.sourceModelId
      },
      plan: { toolName: "product.create", executedAt: null }
    });
    expect(proposed.turn.plan.confirmationToken).toEqual(expect.any(String));

    const confirmed = await postJson<{
      turn: { status: string; plan: { toolName: string; executedAt: string | null } };
    }>(
      app,
      `/businesses/${owner.businessId}/runtime/turns`,
      {
        runtimeSessionId: proposed.session.id,
        message: "confirm",
        confirmationToken: proposed.turn.plan.confirmationToken
      },
      owner.cookie
    );
    expect(confirmed.turn).toMatchObject({
      status: "completed",
      plan: { toolName: "product.create" }
    });
    expect(confirmed.turn.plan.executedAt).toEqual(expect.any(String));

    await app.close();
  });

  it("rejects client model output that does not match a ready device assignment", async () => {
    const app = buildApi({ cp2: { store: createCp2Store() } });
    const owner = await createOwnerBusiness(app, "+254700001435");
    const response = await app.inject({
      method: "POST",
      url: `/businesses/${owner.businessId}/runtime/turns`,
      headers: { "content-type": "application/json", cookie: owner.cookie },
      payload: JSON.stringify({
        message: "Handle this item",
        clientInferenceCompletion: {
          requestId: "forged-browser-request",
          runtime: "browser-webgpu",
          modelId: checkpointContract.sourceModelId,
          deviceId: "unknown-device",
          outputText: '{"type":"tool","toolName":"products.list","input":{}}',
          durationMs: 1
        }
      })
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "CLIENT_MODEL_ASSIGNMENT_NOT_READY" });
    await app.close();
  });
});

function assignmentPayload(lastSuccessfulInferenceAt: string): Record<string, unknown> {
  return {
    deviceId: "browser-device-1",
    enabled: true,
    selectedModelId: checkpointContract.sourceModelId,
    modelFamilyId: checkpointContract.modelFamilyId,
    modelRevision: checkpointContract.sourceModelRevision,
    runtimeContract,
    checkpointCompatibilityContract: checkpointContract,
    deviceTier: "medium",
    readinessStatus: "READY",
    lastSuccessfulInferenceAt,
    lastErrorCode: null
  };
}

async function createOwnerBusiness(
  app: ReturnType<typeof buildApi>,
  contact: string
): Promise<{ businessId: string; cookie: string }> {
  const signup = await app.inject({
    method: "POST",
    url: "/auth/pin/signup",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({ method: "phone", contact, pin: "1234" })
  });
  const setCookie = signup.headers["set-cookie"];
  const cookieValue = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (cookieValue === undefined) throw new Error("Expected an authenticated session cookie.");
  const cookie = cookieValue.split(";")[0] ?? cookieValue;
  const business = await postJson<{ business: { id: string } }>(
    app,
    "/businesses",
    { name: "Browser Inference Shop", language: "en" },
    cookie
  );
  return { businessId: business.business.id, cookie };
}

async function putJson<T>(
  app: ReturnType<typeof buildApi>,
  url: string,
  payload: Record<string, unknown>,
  cookie: string
): Promise<T> {
  const response = await app.inject({
    method: "PUT",
    url,
    headers: { "content-type": "application/json", cookie },
    payload: JSON.stringify(payload)
  });
  expect(response.statusCode).toBe(200);
  return response.json<T>();
}

async function postJson<T>(
  app: ReturnType<typeof buildApi>,
  url: string,
  payload: Record<string, unknown>,
  cookie: string
): Promise<T> {
  const response = await app.inject({
    method: "POST",
    url,
    headers: { "content-type": "application/json", cookie },
    payload: JSON.stringify(payload)
  });
  expect(response.statusCode).toBe(200);
  return response.json<T>();
}
