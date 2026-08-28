import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { BrowserInferenceAssignmentSummary } from "../packages/shared-types/src";
import { buildApi } from "../services/api/src/app";
import { createCp2Store } from "../services/api/src/cp2/store";
import { activateGenericGlobalDefaultModel } from "./fixtures/native-runtime-test-helpers";

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

    // product.create is auto-accepted (no confirmation gate), so it can't prove the confirmation
    // pipeline here - create the product via the same browser-inference-completion mechanism this
    // test exercises (this store has no server-side model adapter configured, so a plain message
    // can't be parsed at all - every mutation here has to go through clientInferenceCompletion),
    // then use product.update (still confirmed) as the actual confirmation-pipeline proof.
    await postJson(
      app,
      `/businesses/${owner.businessId}/runtime/turns`,
      {
        message: "Handle this new stock item",
        clientInferenceCompletion: {
          requestId: "browser-request-0",
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
        message: "Update this stock item",
        clientInferenceCompletion: {
          requestId: "browser-request-1",
          runtime: "browser-webgpu",
          modelId: checkpointContract.sourceModelId,
          deviceId: "browser-device-1",
          outputText: JSON.stringify({
            type: "tool",
            toolName: "product.update",
            input: { productName: "Local model tea", quantity: 5 },
            reason: "Update the product requested by the owner."
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
      plan: { toolName: "product.update", executedAt: null }
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
      plan: { toolName: "product.update" }
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

  // The two tests above only prove the "no assignment for this device at all" branch of
  // requireReadyClientInferenceCompletion. The function's real job is comparing a completion
  // against an *existing* ready assignment field by field - these two prove the modelId and
  // runtime comparisons themselves reject a mismatch rather than trusting whatever a compromised
  // or buggy client reports, once a real ready assignment for that exact device does exist.
  it("rejects a browser completion whose modelId does not match the device's ready assignment", async () => {
    const app = buildApi({ cp2: { store: createCp2Store() } });
    const owner = await createOwnerBusiness(app, "+254700001437");
    await putJson(
      app,
      `/businesses/${owner.businessId}/browser-inference`,
      assignmentPayload("2026-07-29T12:00:00.000Z"),
      owner.cookie
    );

    const response = await app.inject({
      method: "POST",
      url: `/businesses/${owner.businessId}/runtime/turns`,
      headers: { "content-type": "application/json", cookie: owner.cookie },
      payload: JSON.stringify({
        message: "Handle this item",
        clientInferenceCompletion: {
          requestId: "modelid-mismatch-request",
          runtime: "browser-webgpu",
          modelId: "qwen2.5-0.5b-instruct-webllm", // assignment is for checkpointContract.sourceModelId
          deviceId: "browser-device-1",
          outputText: '{"type":"tool","toolName":"products.list","input":{}}',
          durationMs: 1
        }
      })
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "CLIENT_MODEL_ASSIGNMENT_NOT_READY" });
    await app.close();
  });

  it("rejects a browser completion whose runtime does not match the device's ready assignment", async () => {
    const app = buildApi({ cp2: { store: createCp2Store() } });
    const owner = await createOwnerBusiness(app, "+254700001438");
    await putJson(
      app,
      `/businesses/${owner.businessId}/browser-inference`,
      assignmentPayload("2026-07-29T12:00:00.000Z"), // runtimeContract.runtime is "browser-webgpu"
      owner.cookie
    );

    const response = await app.inject({
      method: "POST",
      url: `/businesses/${owner.businessId}/runtime/turns`,
      headers: { "content-type": "application/json", cookie: owner.cookie },
      payload: JSON.stringify({
        message: "Handle this item",
        clientInferenceCompletion: {
          requestId: "runtime-mismatch-request",
          runtime: "browser-wasm",
          modelId: checkpointContract.sourceModelId,
          deviceId: "browser-device-1",
          outputText: '{"type":"tool","toolName":"products.list","input":{}}',
          durationMs: 1
        }
      })
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "CLIENT_MODEL_ASSIGNMENT_NOT_READY" });
    await app.close();
  });

  // requireReadyClientInferenceCompletion has a second, entirely separate branch for a
  // clientInferenceCompletion carrying installationId (the installed native-app path, distinct
  // from the plain browser-tab path exercised above). It had no test coverage at all before this.
  it("accepts an installed-app completion only through a matching ready installation+assignment", async () => {
    const app = buildApi({
      cp2: { store: createCp2Store({ modelRuntimeAdapterResolver: () => undefined }) }
    });
    const owner = await createOwnerBusiness(app, "+254700001439");
    await registerInstalledModel(app, owner.cookie, {
      id: "installed-model-1",
      deviceId: "native-device-1",
      modelId: "custom:installed-model-1",
      runtimeBackend: "LLAMA_CPP_ANDROID"
    });
    await assignInstalledModel(app, owner.cookie, owner.businessId, {
      deviceId: "native-device-1",
      installationId: "installed-model-1",
      lastSuccessfulInferenceAt: "2026-07-29T12:00:00.000Z"
    });

    const proposed = await postJson<{
      turn: { status: string; plan: { toolName: string; confirmationToken: string | null } };
    }>(
      app,
      `/businesses/${owner.businessId}/runtime/turns`,
      {
        message: "Update this stock item",
        clientInferenceCompletion: {
          requestId: "native-request-1",
          runtime: "native-llama-cpp",
          modelId: "custom:installed-model-1",
          deviceId: "native-device-1",
          installationId: "installed-model-1",
          outputText: JSON.stringify({
            type: "tool",
            toolName: "product.update",
            input: { productName: "Some product", quantity: 5 },
            reason: "Update the product requested by the owner."
          }),
          durationMs: 700
        }
      },
      owner.cookie
    );
    expect(proposed.turn).toMatchObject({
      status: "needs_confirmation",
      plan: { toolName: "product.update" }
    });
    expect(proposed.turn.plan.confirmationToken).toEqual(expect.any(String));
    await app.close();
  });

  it("rejects an installed-app completion whose modelId does not match the ready installation", async () => {
    const app = buildApi({ cp2: { store: createCp2Store() } });
    const owner = await createOwnerBusiness(app, "+254700001440");
    await registerInstalledModel(app, owner.cookie, {
      id: "installed-model-2",
      deviceId: "native-device-2",
      modelId: "custom:installed-model-2",
      runtimeBackend: "LLAMA_CPP_ANDROID"
    });
    await assignInstalledModel(app, owner.cookie, owner.businessId, {
      deviceId: "native-device-2",
      installationId: "installed-model-2",
      lastSuccessfulInferenceAt: "2026-07-29T12:00:00.000Z"
    });

    const response = await app.inject({
      method: "POST",
      url: `/businesses/${owner.businessId}/runtime/turns`,
      headers: { "content-type": "application/json", cookie: owner.cookie },
      payload: JSON.stringify({
        message: "Handle this item",
        clientInferenceCompletion: {
          requestId: "native-modelid-mismatch",
          runtime: "native-llama-cpp",
          modelId: "custom:a-different-model", // installation is registered as custom:installed-model-2
          deviceId: "native-device-2",
          installationId: "installed-model-2",
          outputText: '{"type":"tool","toolName":"products.list","input":{}}',
          durationMs: 1
        }
      })
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "CLIENT_MODEL_ASSIGNMENT_NOT_READY" });
    await app.close();
  });

  it("rejects an installed-app completion whose runtime does not match the installation's backend", async () => {
    const app = buildApi({ cp2: { store: createCp2Store() } });
    const owner = await createOwnerBusiness(app, "+254700001441");
    await registerInstalledModel(app, owner.cookie, {
      id: "installed-model-3",
      deviceId: "native-device-3",
      modelId: "custom:installed-model-3",
      runtimeBackend: "LLAMA_CPP_ANDROID" // requires runtime "native-llama-cpp", not browser-wasm
    });
    await assignInstalledModel(app, owner.cookie, owner.businessId, {
      deviceId: "native-device-3",
      installationId: "installed-model-3",
      lastSuccessfulInferenceAt: "2026-07-29T12:00:00.000Z"
    });

    const response = await app.inject({
      method: "POST",
      url: `/businesses/${owner.businessId}/runtime/turns`,
      headers: { "content-type": "application/json", cookie: owner.cookie },
      payload: JSON.stringify({
        message: "Handle this item",
        clientInferenceCompletion: {
          requestId: "native-runtime-mismatch",
          runtime: "browser-wasm",
          modelId: "custom:installed-model-3",
          deviceId: "native-device-3",
          installationId: "installed-model-3",
          outputText: '{"type":"tool","toolName":"products.list","input":{}}',
          durationMs: 1
        }
      })
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "CLIENT_MODEL_ASSIGNMENT_NOT_READY" });
    await app.close();
  });

  it("delivers a browser workspace file through the authenticated runtime and conversation", async () => {
    const store = createCp2Store({ modelRuntimeAdapterResolver: () => undefined });
    // Global default model/host are seeded unavailable until a verified health check runs (see
    // services/api/src/index.ts's production startup gate); mirror that here so the resolver has
    // an available candidate to route to (the client supplies its own browser completion).
    activateGenericGlobalDefaultModel(store, new Date().toISOString());
    const app = buildApi({ cp2: { store } });
    const owner = await createOwnerBusiness(app, "+254700001436");
    await putJson(
      app,
      `/businesses/${owner.businessId}/browser-inference`,
      assignmentPayload("2026-07-29T12:00:00.000Z"),
      owner.cookie
    );
    const conversations = await getJson<{ conversations: Array<{ id: string }> }>(
      app,
      "/v1/conversations",
      owner.cookie
    );
    const conversationId = conversations.conversations[0]!.id;
    const bytes = Buffer.from("89504e470d0a1a0a00000000", "hex");
    const completion = await postJson<{
      turn: {
        response: string;
        toolResult: { attachments: Array<Record<string, unknown>> };
      };
    }>(
      app,
      `/businesses/${owner.businessId}/runtime/turns`,
      {
        conversationId,
        message: "Deliver the locally generated catalogue.",
        clientInferenceCompletion: {
          requestId: "browser-workspace-request-1",
          runtime: "browser-webgpu",
          modelId: checkpointContract.sourceModelId,
          deviceId: "browser-device-1",
          outputText: JSON.stringify({
            type: "tool",
            toolName: "workspace.deliver",
            input: { path: "generated/catalogue.png" },
            reason: "Deliver the generated catalogue."
          }),
          durationMs: 50,
          workspaceFiles: [
            {
              path: "generated/catalogue.png",
              contentBase64: bytes.toString("base64"),
              checksum: createHash("sha256").update(bytes).digest("hex")
            }
          ]
        }
      },
      owner.cookie
    );
    const attachments = completion.turn.toolResult.attachments;
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      name: "catalogue.png",
      mimeType: "image/png",
      source: "managed"
    });
    expect(store.snapshot().conversationAttachments?.[0]).not.toHaveProperty("contentBase64");

    const message = await postJson<{ content: { attachments?: Array<{ id: string }> } }>(
      app,
      "/v1/messages",
      {
        conversationId,
        clientMessageId: "browser-workspace-reply-1",
        author: "agent",
        content: { type: "text", text: completion.turn.response, attachments }
      },
      owner.cookie
    );
    expect(message.content.attachments).toHaveLength(1);
    const preview = await app.inject({
      method: "GET",
      url: `/v1/conversations/${conversationId}/attachments/${message.content.attachments![0]!.id}/preview`,
      headers: { cookie: owner.cookie }
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.rawPayload).toEqual(bytes);
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

async function registerInstalledModel(
  app: ReturnType<typeof buildApi>,
  cookie: string,
  overrides: { id: string; deviceId: string; modelId: string; runtimeBackend: string }
): Promise<void> {
  await postJson(
    app,
    "/v1/models/installed",
    {
      id: overrides.id,
      deviceId: overrides.deviceId,
      modelId: overrides.modelId,
      displayName: "Shop Model",
      provider: "custom",
      filename: `${overrides.id}.gguf`,
      format: "GGUF",
      quantization: "Q4_K_M",
      architecture: "llama",
      parameterCount: 500_000_000,
      contextLength: 2_048,
      fileSizeBytes: 400_000_000,
      license: "Apache-2.0",
      commercialUseAllowed: true,
      storageKey: `${overrides.id}.gguf`,
      runtimeBackend: overrides.runtimeBackend,
      installationStatus: "INSTALLED",
      compatibilityStatus: "COMPATIBLE",
      installedAt: "2026-07-29T00:00:00.000Z",
      lastVerifiedAt: "2026-07-29T00:00:00.000Z"
    },
    cookie
  );
}

async function assignInstalledModel(
  app: ReturnType<typeof buildApi>,
  cookie: string,
  businessId: string,
  overrides: { deviceId: string; installationId: string; lastSuccessfulInferenceAt: string }
): Promise<void> {
  await putJson(
    app,
    `/businesses/${businessId}/agent-model`,
    {
      deviceId: overrides.deviceId,
      installationId: overrides.installationId,
      preferredExecutionMode: "LOCAL_ONLY",
      fallbackPolicy: "NEVER",
      readinessStatus: "READY",
      lastSuccessfulInferenceAt: overrides.lastSuccessfulInferenceAt,
      lastErrorCode: null
    },
    cookie
  );
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
  expect(response.statusCode, response.body).toBe(200);
  return response.json<T>();
}

async function getJson<T>(
  app: ReturnType<typeof buildApi>,
  url: string,
  cookie: string
): Promise<T> {
  const response = await app.inject({ method: "GET", url, headers: { cookie } });
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
  expect(response.statusCode, response.body).toBe(200);
  return response.json<T>();
}
