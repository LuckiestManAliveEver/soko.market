/**
 * Twelfth domain slice of in-process modularization for services/api/src/cp2/routes.ts (see
 * docs/architecture/routes-modularization-roadmap.md). Owns the AI-model catalogue/installation
 * routes, agent-model bindings, browser-inference assignments, agent profile/runtime metadata
 * (context sources, owner corrections, feedback, recall effectiveness), and runtime
 * sessions/turns - everything that calls into `domains/agent-runtime/store.ts`'s
 * `AgentRuntimeDomain` on the store.ts side, which this file's routes were already delegating to
 * before this extraction.
 *
 * Split into two clusters in the original file (AI-models/agent-model/browser-inference/agent
 * profile at one point, runtime sessions/turns much later, right after commerce's registration
 * call) - both clusters are combined into a single `registerAgentRuntimeRoutes` call here, matching
 * every other domain's single-registration-point convention.
 *
 * `parseRuntimeTurnBody` and `RuntimeTurnBody` are exported since the messaging domain's
 * `POST /v1/messages` route (still in routes.ts) parses an embedded agent-authored turn via
 * `parseRuntimeTurnBody(agent)`, and routes.ts's own `CreateMessageBody` interface references
 * `RuntimeTurnBody` directly - the same cross-domain re-export pattern used for
 * `parseProductBody` (sales) and `parseLogisticsBody` (logistics).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type {
  AgentContextSource,
  AgentEvaluationPolicy,
  AgentInstructions,
  AgentMemoryPolicy,
  AgentModelBindingPermissions,
  AgentModelFallbackPolicy,
  AgentModelReadinessStatus,
  AgentModelRuntimeBackend,
  AgentOwnerCorrection,
  AgentPersonality,
  AgentSkillBinding,
  BrowserCheckpointCompatibilityContract,
  BrowserDeviceTier,
  BrowserRuntimeContract,
  ClientInferenceCompletion,
  InstalledAgentModelSummary,
  ModelCompatibilityStatus,
  ModelExecutionTarget,
  ModelInstallationStatus,
  PreferredExecutionMode,
  RuntimeRecallEscalation,
  OssAgentSummary
} from "@soko/shared-types";
import { Cp2Error } from "../../cp2-error.js";
import { type Cp2Store, isSupportedLanguage, readSessionCookie } from "../../store.js";
import type { GitHubModelCatalog } from "../../github-model-catalog.js";
import type { HuggingFaceModelCatalog } from "../../huggingface-model-catalog.js";
import type { GitHubAgentCatalog } from "../../github-agent-catalog.js";
import type { HuggingFaceAgentCatalog } from "../../huggingface-agent-catalog.js";
import type { BusinessAgentProfileInput } from "./shared.js";
import { defaultAgentDefinitionId, isAgentDefinitionId } from "@soko/shared-types";
import { runtimeToolRegistry } from "@soko/tool-core";
import { parseRuntimeRecallEscalation, parseRuntimeTurnBody } from "./runtime-turn-request.js";
export { parseRuntimeTurnBody } from "./runtime-turn-request.js";
import {
  parseBoolean,
  parseIntegerString,
  parseIsoTimestamp,
  parseNullableString,
  parseOptionalString,
  parsePositiveInteger,
  parseRequestBody,
  parseString,
  parseStringArray,
  sendCp2Error,
  type BusinessParams
} from "../../route-helpers.js";

interface AiModelSearchQuery {
  search?: string;
}

interface InstalledModelQuery {
  deviceId?: string;
}

interface InstalledModelParams {
  installationId: string;
}

interface InstalledModelBody {
  id?: unknown;
  deviceId?: unknown;
  modelId?: unknown;
  displayName?: unknown;
  provider?: unknown;
  repositoryId?: unknown;
  filename?: unknown;
  format?: unknown;
  quantization?: unknown;
  architecture?: unknown;
  parameterCount?: unknown;
  contextLength?: unknown;
  fileSizeBytes?: unknown;
  checksum?: unknown;
  packageManifestVersion?: unknown;
  packageSignature?: unknown;
  packageSigningKeyId?: unknown;
  license?: unknown;
  commercialUseAllowed?: unknown;
  storageKey?: unknown;
  runtimeBackend?: unknown;
  installationStatus?: unknown;
  compatibilityStatus?: unknown;
  installedAt?: unknown;
  lastVerifiedAt?: unknown;
  validationError?: unknown;
}

interface InstalledModelValidationBody {
  deviceId?: unknown;
  installationStatus?: unknown;
  compatibilityStatus?: unknown;
  validationError?: unknown;
}

interface InstalledAgentManifestBody {
  agent?: unknown;
  installedAt?: unknown;
}

interface ModelArtifactChunkParams extends InstalledModelParams {
  chunkIndex: string;
}

interface ModelArtifactChunkBody {
  contentBase64?: unknown;
}

interface AgentModelQuery {
  deviceId?: string;
}

interface AgentModelAssignmentBody {
  deviceId?: unknown;
  installationId?: unknown;
  preferredExecutionMode?: unknown;
  fallbackPolicy?: unknown;
  readinessStatus?: unknown;
  lastSuccessfulInferenceAt?: unknown;
  lastErrorCode?: unknown;
}

interface BrowserInferenceAssignmentBody {
  deviceId?: unknown;
  enabled?: unknown;
  selectedModelId?: unknown;
  modelFamilyId?: unknown;
  modelRevision?: unknown;
  runtimeContract?: unknown;
  checkpointCompatibilityContract?: unknown;
  deviceTier?: unknown;
  readinessStatus?: unknown;
  lastSuccessfulInferenceAt?: unknown;
  lastErrorCode?: unknown;
}

interface BrowserInferenceExecutionBody {
  deviceId?: unknown;
  modelId?: unknown;
  successful?: unknown;
  errorCode?: unknown;
  occurredAt?: unknown;
}

interface AgentModelOperationParams {
  agentId: string;
  modelId: string;
}

interface AgentModelBindingParams {
  agentId: string;
}

interface AgentModelBindingQuery {
  shopId?: string;
}

interface AgentModelTestBody {
  shopId?: unknown;
  executionTarget?: unknown;
}

interface AgentModelActivationBody extends AgentModelTestBody {
  executionMode?: unknown;
  fallbackPolicy?: unknown;
  permissions?: unknown;
  fallbackModelId?: unknown;
}

interface AiModelActivationBody {
  modelId?: string;
}

interface AgentProfileBody {
  agentDefinitionId?: string;
  name?: string;
  description?: string;
  modelId?: string;
  role?: string;
  language?: string;
  personality?: string;
  instructions?: string;
  knowledge?: string;
  tools?: unknown;
  integrations?: unknown;
  contextScripts?: unknown;
  status?: string;
  personalityConfig?: unknown;
  instructionPolicy?: unknown;
  skillBindings?: unknown;
  memoryPolicy?: unknown;
  evaluationPolicy?: unknown;
  supportedLanguages?: unknown;
  businessCategory?: string;
  publicIntroduction?: string;
}

interface AgentContextSourceBody {
  id?: string;
  type?: string;
  title?: string;
  content?: string;
  sensitivity?: string;
  customerVisible?: boolean;
  status?: string;
}

interface AgentCorrectionBody {
  correction?: string;
  category?: string;
  sourceMessageId?: string | null;
  promoteToInstruction?: boolean;
}

interface AgentFeedbackBody {
  messageId?: string | null;
  correct?: boolean;
  reason?: string | null;
}

interface RuntimeVersionParams extends BusinessParams {
  version: string;
}

interface AgentCorrectionParams extends BusinessParams {
  correctionId: string;
}

interface RuntimeSessionParams extends BusinessParams {
  runtimeSessionId: string;
}

interface RuntimeSessionBody {
  idempotencyKey?: unknown;
}

export interface RuntimeTurnBody {
  runtimeSessionId?: string;
  conversationId?: string;
  message?: string;
  confirmationToken?: string;
  recallEscalation?: RuntimeRecallEscalation;
  clientInferenceCompletion?: ClientInferenceCompletion;
}

interface RecallEffectivenessBody {
  sourceIds?: unknown;
  outcome?: unknown;
  localRuntime?: unknown;
  modelId?: unknown;
}

export function registerAgentRuntimeRoutes(
  app: FastifyInstance,
  store: Cp2Store,
  githubModelCatalog: GitHubModelCatalog,
  huggingFaceModelCatalog: HuggingFaceModelCatalog,
  githubAgentCatalog: GitHubAgentCatalog,
  huggingFaceAgentCatalog: HuggingFaceAgentCatalog
): void {
  app.get("/v1/oss-agents/installed", async (request, reply) => {
    try {
      return {
        manifests: await store.listAccountOssAgentManifests({
          sessionId: readSessionCookie(request.headers.cookie)
        })
      };
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.post(
    "/v1/oss-agents/installed",
    async (request: FastifyRequest<{ Body: InstalledAgentManifestBody }>, reply) => {
      try {
        return await store.installAccountOssAgentManifest({
          sessionId: readSessionCookie(request.headers.cookie),
          agent: parseOssAgentSummary(request.body.agent),
          ...(request.body.installedAt === undefined
            ? {}
            : { installedAt: parseIsoTimestamp(request.body.installedAt, "installedAt") })
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/v1/ai-models",
    async (request: FastifyRequest<{ Querystring: AiModelSearchQuery }>, reply) => {
      try {
        return { models: store.listAiModels(request.query.search) };
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/v1/ai-models/github",
    async (request: FastifyRequest<{ Querystring: AiModelSearchQuery }>, reply) => {
      try {
        return await githubModelCatalog.searchModels(request.query.search);
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/v1/ai-models/huggingface",
    async (request: FastifyRequest<{ Querystring: AiModelSearchQuery }>, reply) => {
      try {
        return await huggingFaceModelCatalog.searchModels(request.query.search);
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/v1/oss-agents/github",
    async (request: FastifyRequest<{ Querystring: AiModelSearchQuery }>, reply) => {
      try {
        return await githubAgentCatalog.searchAgents(request.query.search);
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/v1/oss-agents/huggingface",
    async (request: FastifyRequest<{ Querystring: AiModelSearchQuery }>, reply) => {
      try {
        return await huggingFaceAgentCatalog.searchAgents(request.query.search);
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/v1/models/installed",
    async (request: FastifyRequest<{ Querystring: InstalledModelQuery }>, reply) => {
      try {
        return {
          models: store.listInstalledAgentModels({
            sessionId: readSessionCookie(request.headers.cookie),
            ...(request.query.deviceId === undefined
              ? {}
              : { deviceId: parseString(request.query.deviceId, "deviceId") })
          })
        };
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/v1/models/installed",
    async (request: FastifyRequest<{ Body: InstalledModelBody }>, reply) => {
      try {
        return store.registerInstalledAgentModel({
          sessionId: readSessionCookie(request.headers.cookie),
          model: parseInstalledModelBody(request.body)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get("/v1/model-artifacts", async (request, reply) => {
    try {
      return {
        artifacts: await store.listAccountModelArtifacts({
          sessionId: readSessionCookie(request.headers.cookie)
        })
      };
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.post(
    "/v1/model-artifacts",
    async (request: FastifyRequest<{ Body: InstalledModelBody }>, reply) => {
      try {
        return await store.beginAccountModelArtifact({
          sessionId: readSessionCookie(request.headers.cookie),
          model: parseInstalledModelBody(request.body)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.put(
    "/v1/model-artifacts/:installationId/chunks/:chunkIndex",
    async (
      request: FastifyRequest<{
        Params: ModelArtifactChunkParams;
        Body: ModelArtifactChunkBody;
      }>,
      reply
    ) => {
      try {
        const encoded = parseString(request.body.contentBase64, "contentBase64");
        if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded)) {
          throw new Cp2Error(400, "model_artifact_chunk_invalid", "Model chunk is invalid.");
        }
        return await store.putAccountModelArtifactChunk({
          sessionId: readSessionCookie(request.headers.cookie),
          artifactId: request.params.installationId,
          chunkIndex: Number(parseIntegerString(request.params.chunkIndex, "chunkIndex")),
          bytes: Buffer.from(encoded, "base64")
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/v1/model-artifacts/:installationId/complete",
    async (request: FastifyRequest<{ Params: InstalledModelParams }>, reply) => {
      try {
        return await store.completeAccountModelArtifact({
          sessionId: readSessionCookie(request.headers.cookie),
          artifactId: request.params.installationId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/v1/model-artifacts/:installationId/chunks/:chunkIndex",
    async (request: FastifyRequest<{ Params: ModelArtifactChunkParams }>, reply) => {
      try {
        const bytes = await store.getAccountModelArtifactChunk({
          sessionId: readSessionCookie(request.headers.cookie),
          artifactId: request.params.installationId,
          chunkIndex: Number(parseIntegerString(request.params.chunkIndex, "chunkIndex"))
        });
        return { contentBase64: bytes.toString("base64") };
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/v1/models/:installationId/validate",
    async (
      request: FastifyRequest<{
        Params: InstalledModelParams;
        Body: InstalledModelValidationBody;
      }>,
      reply
    ) => {
      try {
        return store.validateInstalledAgentModel({
          sessionId: readSessionCookie(request.headers.cookie),
          installationId: request.params.installationId,
          deviceId: parseString(request.body.deviceId, "deviceId"),
          installationStatus: parseModelInstallationStatus(request.body.installationStatus),
          compatibilityStatus: parseModelCompatibilityStatus(request.body.compatibilityStatus),
          validationError: parseNullableString(request.body.validationError)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/ai-model",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.getActiveAiModel({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.put(
    "/businesses/:businessId/ai-model",
    async (
      request: FastifyRequest<{ Params: BusinessParams; Body: AiModelActivationBody }>,
      reply
    ) => {
      try {
        return store.activateAiModel({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          modelId: parseString(request.body.modelId, "modelId")
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/agent-model",
    async (
      request: FastifyRequest<{ Params: BusinessParams; Querystring: AgentModelQuery }>,
      reply
    ) => {
      try {
        return store.getAgentModelAssignment({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          deviceId: parseString(request.query.deviceId, "deviceId")
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.put(
    "/businesses/:businessId/agent-model",
    async (
      request: FastifyRequest<{ Params: BusinessParams; Body: AgentModelAssignmentBody }>,
      reply
    ) => {
      try {
        return store.assignAgentModel({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          deviceId: parseString(request.body.deviceId, "deviceId"),
          installationId: parseString(request.body.installationId, "installationId"),
          preferredExecutionMode: parsePreferredExecutionMode(request.body.preferredExecutionMode),
          fallbackPolicy: parseAgentModelFallbackPolicy(request.body.fallbackPolicy),
          readinessStatus: parseAgentModelReadinessStatus(request.body.readinessStatus),
          lastSuccessfulInferenceAt: parseNullableString(request.body.lastSuccessfulInferenceAt),
          lastErrorCode: parseNullableString(request.body.lastErrorCode)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.delete(
    "/businesses/:businessId/agent-model",
    async (
      request: FastifyRequest<{ Params: BusinessParams; Querystring: AgentModelQuery }>,
      reply
    ) => {
      try {
        return store.removeAgentModelAssignment({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          deviceId: parseString(request.query.deviceId, "deviceId")
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/browser-inference",
    async (
      request: FastifyRequest<{ Params: BusinessParams; Querystring: AgentModelQuery }>,
      reply
    ) => {
      try {
        return {
          assignment: store.getBrowserInferenceAssignment({
            sessionId: readSessionCookie(request.headers.cookie),
            businessId: request.params.businessId,
            deviceId: parseString(request.query.deviceId, "deviceId")
          })
        };
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.put(
    "/businesses/:businessId/browser-inference",
    async (
      request: FastifyRequest<{
        Params: BusinessParams;
        Body: BrowserInferenceAssignmentBody;
      }>,
      reply
    ) => {
      try {
        return store.upsertBrowserInferenceAssignment({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          deviceId: parseString(request.body.deviceId, "deviceId"),
          enabled: parseBoolean(request.body.enabled, "enabled"),
          selectedModelId: parseNullableString(request.body.selectedModelId),
          modelFamilyId: parseNullableString(request.body.modelFamilyId),
          modelRevision: parseNullableString(request.body.modelRevision),
          runtimeContract: parseBrowserRuntimeContract(request.body.runtimeContract),
          checkpointCompatibilityContract: parseBrowserCheckpointContract(
            request.body.checkpointCompatibilityContract
          ),
          deviceTier: parseBrowserDeviceTier(request.body.deviceTier),
          readinessStatus: parseAgentModelReadinessStatus(request.body.readinessStatus),
          lastSuccessfulInferenceAt: parseNullableString(request.body.lastSuccessfulInferenceAt),
          lastErrorCode: parseNullableString(request.body.lastErrorCode)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/browser-inference/executions",
    async (
      request: FastifyRequest<{
        Params: BusinessParams;
        Body: BrowserInferenceExecutionBody;
      }>,
      reply
    ) => {
      try {
        return store.recordBrowserInferenceExecution({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          deviceId: parseString(request.body.deviceId, "deviceId"),
          modelId: parseString(request.body.modelId, "modelId"),
          successful: parseBoolean(request.body.successful, "successful"),
          errorCode: parseNullableString(request.body.errorCode),
          occurredAt: parseString(request.body.occurredAt, "occurredAt")
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.delete(
    "/businesses/:businessId/browser-inference",
    async (
      request: FastifyRequest<{ Params: BusinessParams; Querystring: AgentModelQuery }>,
      reply
    ) => {
      try {
        return store.removeBrowserInferenceAssignment({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          deviceId: parseString(request.query.deviceId, "deviceId")
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/api/agents/:agentId/model-binding",
    async (
      request: FastifyRequest<{
        Params: AgentModelBindingParams;
        Querystring: AgentModelBindingQuery;
      }>,
      reply
    ) => {
      try {
        return {
          binding: store.getActiveAgentModelBinding({
            sessionId: readSessionCookie(request.headers.cookie),
            businessId: parseString(request.query.shopId, "shopId"),
            agentId: parseString(request.params.agentId, "agentId")
          })
        };
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.delete(
    "/api/agents/:agentId/model-binding",
    async (
      request: FastifyRequest<{
        Params: AgentModelBindingParams;
        Querystring: AgentModelBindingQuery;
      }>,
      reply
    ) => {
      const requestId = request.id;
      const shopId = parseString(request.query.shopId, "shopId");
      const agentId = parseString(request.params.agentId, "agentId");
      request.log.info(
        { event: "model.binding_removal_started", requestId, shopId, agentId },
        "Agent model binding removal started."
      );
      try {
        const result = store.removeAgentModelBinding({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: shopId,
          agentId
        });
        request.log.info(
          {
            event: "model.binding_removed",
            requestId,
            shopId,
            agentId,
            bindingId: result.removedBindingId
          },
          "Agent model binding removed."
        );
        return result;
      } catch (error) {
        request.log.warn(
          {
            event: "model.binding_removal_failed",
            requestId,
            shopId,
            agentId,
            errorCode: error instanceof Cp2Error ? error.code : "MODEL_BINDING_REMOVAL_FAILED"
          },
          "Agent model binding removal failed."
        );
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/api/agents/:agentId/models/:modelId/test",
    async (
      request: FastifyRequest<{
        Params: AgentModelOperationParams;
        Body: AgentModelTestBody;
      }>,
      reply
    ) => {
      const requestId = request.id;
      const shopId = parseString(request.body.shopId, "shopId");
      const agentId = parseString(request.params.agentId, "agentId");
      const modelId = parseString(request.params.modelId, "modelId");
      const executionTarget = parseModelExecutionTarget(request.body.executionTarget);
      const requestAbort = observeRequestAbort(request, reply);
      request.log.info(
        { event: "model.test_started", requestId, shopId, agentId, modelId, executionTarget },
        "Model test started."
      );
      try {
        const healthCheck = await store.testAgentModel({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: shopId,
          agentId,
          modelId,
          executionTarget,
          signal: requestAbort.signal
        });
        request.log.info(
          {
            event: "model.test_succeeded",
            requestId,
            shopId,
            agentId,
            modelId: healthCheck.modelId,
            executionTarget: healthCheck.executionTarget,
            latencyMs: healthCheck.latencyMs
          },
          "Model test succeeded."
        );
        return { healthCheck };
      } catch (error) {
        request.log.warn(
          {
            event: "model.test_failed",
            requestId,
            shopId,
            agentId,
            modelId,
            executionTarget,
            errorCode: error instanceof Cp2Error ? error.code : "MODEL_TEST_FAILED"
          },
          "Model test failed."
        );
        return sendCp2Error(reply, error);
      } finally {
        requestAbort.cleanup();
      }
    }
  );

  app.post(
    "/api/agents/:agentId/models/:modelId/activate",
    async (
      request: FastifyRequest<{
        Params: AgentModelOperationParams;
        Body: AgentModelActivationBody;
      }>,
      reply
    ) => {
      const requestId = request.id;
      const shopId = parseString(request.body.shopId, "shopId");
      const agentId = parseString(request.params.agentId, "agentId");
      const modelId = parseString(request.params.modelId, "modelId");
      const executionTarget = parseModelExecutionTarget(request.body.executionTarget);
      const requestAbort = observeRequestAbort(request, reply);
      request.log.info(
        {
          event: "model.activation_started",
          requestId,
          shopId,
          agentId,
          modelId,
          executionTarget
        },
        "Model activation started."
      );
      try {
        const result = await store.activateAgentModel({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: shopId,
          agentId,
          modelId,
          executionTarget,
          executionMode: parsePreferredExecutionMode(request.body.executionMode),
          fallbackPolicy: parseAgentModelFallbackPolicy(request.body.fallbackPolicy),
          permissions: parseAgentModelBindingPermissions(request.body.permissions),
          fallbackModelId: parseNullableString(request.body.fallbackModelId),
          signal: requestAbort.signal,
          onStage: (stage, elapsedMs) => {
            request.log.info(
              {
                event: "model.activation_stage",
                requestId,
                shopId,
                agentId,
                modelId,
                executionTarget,
                stage,
                elapsedMs
              },
              "Model activation stage completed."
            );
          }
        });
        request.log.info(
          {
            event: "model.activation_succeeded",
            requestId,
            shopId,
            agentId,
            modelId: result.binding.modelId,
            bindingId: result.binding.id,
            executionTarget: result.binding.executionTarget,
            latencyMs: result.healthCheck.latencyMs
          },
          "Model activation succeeded."
        );
        return result;
      } catch (error) {
        request.log.warn(
          {
            event: "model.activation_failed",
            requestId,
            shopId,
            agentId,
            modelId,
            executionTarget,
            errorCode: error instanceof Cp2Error ? error.code : "MODEL_ACTIVATION_FAILED"
          },
          "Model activation failed."
        );
        return sendCp2Error(reply, error);
      } finally {
        requestAbort.cleanup();
      }
    }
  );

  app.get(
    "/businesses/:businessId/agent-profile",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.getAgentProfile({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.put(
    "/businesses/:businessId/agent-profile",
    async (request: FastifyRequest<{ Params: BusinessParams; Body: AgentProfileBody }>, reply) => {
      try {
        return store.updateAgentProfile({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          profile: parseAgentProfileBody(request.body)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/agent-runtime",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.getAgentRuntime({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/agent-runtime/readiness",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.getAgentRuntimeReadiness({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/agent-runtime/versions",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.listAgentRuntimeVersions({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/agent-runtime/versions/:version/rollback",
    async (request: FastifyRequest<{ Params: RuntimeVersionParams }>, reply) => {
      try {
        return store.rollbackAgentRuntimeVersion({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          version: parseIntegerString(request.params.version, "version")
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/agent-runtime/context-sources",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.listAgentContextSources({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/agent-runtime/context-sources",
    async (
      request: FastifyRequest<{ Params: BusinessParams; Body: AgentContextSourceBody }>,
      reply
    ) => {
      try {
        const body = parseAgentContextSourceBody(request.body);
        return store.upsertAgentContextSource({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          ...body
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/agent-runtime/corrections",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.listAgentOwnerCorrections({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/agent-runtime/corrections",
    async (
      request: FastifyRequest<{ Params: BusinessParams; Body: AgentCorrectionBody }>,
      reply
    ) => {
      try {
        const body = parseAgentCorrectionBody(request.body);
        return store.submitAgentOwnerCorrection({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          ...body
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/agent-runtime/corrections/:correctionId/disable",
    async (request: FastifyRequest<{ Params: AgentCorrectionParams }>, reply) => {
      try {
        return store.disableAgentOwnerCorrection({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          correctionId: parseString(request.params.correctionId, "correctionId")
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/agent-runtime/evaluations",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.getAgentEvaluationSummary({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/agent-runtime/feedback",
    async (request: FastifyRequest<{ Params: BusinessParams; Body: AgentFeedbackBody }>, reply) => {
      try {
        const body = parseAgentFeedbackBody(request.body);
        return store.submitAgentFeedback({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          ...body
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/agent-runtime/recall/effectiveness",
    async (
      request: FastifyRequest<{ Params: BusinessParams; Body: RecallEffectivenessBody }>,
      reply
    ) => {
      try {
        const body = parseRecallEffectivenessBody(request.body);
        return store.recordRecallEffectiveness({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          ...body
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/runtime/sessions",
    async (
      request: FastifyRequest<{ Params: BusinessParams; Body: RuntimeSessionBody }>,
      reply
    ) => {
      const sessionId = readSessionCookie(request.headers.cookie);
      request.log.info(
        {
          event: "agent.runtime_session_create_started",
          businessId: request.params.businessId,
          requestCorrelationId: request.id,
          accessCredentialPresent: sessionId !== null
        },
        "Runtime session creation started."
      );
      try {
        const body = request.body === undefined ? {} : parseRequestBody(request.body);
        const idempotencyKey = parseOptionalString(body.idempotencyKey);
        const created = store.createRuntimeSession({
          sessionId,
          businessId: request.params.businessId,
          ...(idempotencyKey === undefined ? {} : { idempotencyKey })
        });
        request.log.info(
          {
            event: "agent.runtime_session_create_completed",
            businessId: created.businessId,
            userId: created.userId,
            runtimeSessionId: created.id,
            requestCorrelationId: request.id,
            authenticationOutcome: "authenticated"
          },
          "Runtime session creation completed."
        );
        return created;
      } catch (error) {
        request.log.warn(
          {
            event: "agent.runtime_session_create_rejected",
            businessId: request.params.businessId,
            requestCorrelationId: request.id,
            authenticationOutcome:
              error instanceof Cp2Error && error.statusCode === 401
                ? "rejected"
                : error instanceof Cp2Error && error.statusCode === 403
                  ? "authenticated"
                  : "not_confirmed",
            code: error instanceof Cp2Error ? error.code : "runtime_session_create_failed"
          },
          "Runtime session creation rejected."
        );
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/runtime/sessions",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.listRuntimeSessions({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/runtime/sessions/:runtimeSessionId/turns",
    async (request: FastifyRequest<{ Params: RuntimeSessionParams }>, reply) => {
      try {
        return store.listRuntimeTurns({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          runtimeSessionId: request.params.runtimeSessionId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/runtime/turns",
    async (request: FastifyRequest<{ Params: BusinessParams; Body: RuntimeTurnBody }>, reply) => {
      try {
        return await store.createRuntimeTurn({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          ...parseRuntimeTurnBody(request.body)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );
}

function parseAgentProfileBody(body: AgentProfileBody): BusinessAgentProfileInput {
  const agentDefinitionId = body.agentDefinitionId ?? defaultAgentDefinitionId;
  if (!isAgentDefinitionId(agentDefinitionId)) {
    throw new Cp2Error(
      400,
      "agent_definition_invalid",
      "Agent definition is not in the approved catalogue."
    );
  }
  const language = parseString(body.language, "language");
  if (!isSupportedLanguage(language)) {
    throw new Cp2Error(400, "language_invalid", "language is not supported.");
  }
  const status = parseString(body.status, "status");
  if (status !== "active" && status !== "draft") {
    throw new Cp2Error(400, "agent_status_invalid", "Agent status is invalid.");
  }

  const personalityConfig =
    body.personalityConfig === undefined
      ? undefined
      : (parseRequestBody(body.personalityConfig) as unknown as AgentPersonality);
  const instructionPolicy =
    body.instructionPolicy === undefined
      ? undefined
      : (parseRequestBody(body.instructionPolicy) as unknown as AgentInstructions);
  const skillBindings =
    body.skillBindings === undefined
      ? undefined
      : parseStructuredArray<AgentSkillBinding>(
          body.skillBindings,
          "skillBindings",
          Object.keys(runtimeToolRegistry).length
        );
  const memoryPolicy =
    body.memoryPolicy === undefined
      ? undefined
      : (parseRequestBody(body.memoryPolicy) as unknown as AgentMemoryPolicy);
  const evaluationPolicy =
    body.evaluationPolicy === undefined
      ? undefined
      : (parseRequestBody(body.evaluationPolicy) as unknown as AgentEvaluationPolicy);
  const supportedLanguages =
    body.supportedLanguages === undefined
      ? undefined
      : parseStringArray(body.supportedLanguages, "supportedLanguages", 2).map((item) => {
          if (!isSupportedLanguage(item)) {
            throw new Cp2Error(400, "language_invalid", "language is not supported.");
          }
          return item;
        });
  return {
    agentDefinitionId,
    name: parseString(body.name, "name"),
    description: parseString(body.description, "description"),
    modelId: parseString(body.modelId, "modelId"),
    role: parseString(body.role, "role"),
    language,
    personality: parseString(body.personality, "personality"),
    instructions: parseString(body.instructions, "instructions"),
    knowledge: parseString(body.knowledge, "knowledge"),
    tools: parseStringArray(body.tools, "tools", 24),
    integrations: parseStringArray(body.integrations, "integrations", 24),
    contextScripts: parseStringArray(body.contextScripts, "contextScripts", 12),
    ...(personalityConfig === undefined ? {} : { personalityConfig }),
    ...(instructionPolicy === undefined ? {} : { instructionPolicy }),
    ...(skillBindings === undefined ? {} : { skillBindings }),
    ...(memoryPolicy === undefined ? {} : { memoryPolicy }),
    ...(evaluationPolicy === undefined ? {} : { evaluationPolicy }),
    ...(supportedLanguages === undefined ? {} : { supportedLanguages }),
    ...(body.businessCategory === undefined
      ? {}
      : { businessCategory: parseString(body.businessCategory, "businessCategory") }),
    ...(body.publicIntroduction === undefined
      ? {}
      : { publicIntroduction: parseString(body.publicIntroduction, "publicIntroduction") }),
    status
  };
}

function parseAgentContextSourceBody(body: AgentContextSourceBody | null | undefined): {
  sourceId?: string;
  type: AgentContextSource["type"];
  title: string;
  content: string;
  sensitivity: AgentContextSource["sensitivity"];
  customerVisible: boolean;
  status: AgentContextSource["status"];
} {
  const record = parseRequestBody(body);
  const type = parseString(record.type, "type");
  const sensitivity = parseString(record.sensitivity, "sensitivity");
  const status = parseString(record.status, "status");
  const types: AgentContextSource["type"][] = [
    "catalogue",
    "inventory",
    "customer",
    "supplier",
    "receipt",
    "order",
    "policy",
    "document",
    "conversation",
    "context_script",
    "owner_note"
  ];
  if (!types.includes(type as AgentContextSource["type"])) {
    throw new Cp2Error(400, "context_source_type_invalid", "Context source type is invalid.");
  }
  if (!["public", "internal", "confidential", "restricted"].includes(sensitivity)) {
    throw new Cp2Error(
      400,
      "context_source_sensitivity_invalid",
      "Context source sensitivity is invalid."
    );
  }
  if (!["active", "disabled", "archived"].includes(status)) {
    throw new Cp2Error(400, "context_source_status_invalid", "Context source status is invalid.");
  }
  return {
    ...(record.id === undefined ? {} : { sourceId: parseString(record.id, "id") }),
    type: type as AgentContextSource["type"],
    title: parseString(record.title, "title"),
    content: parseString(record.content, "content"),
    sensitivity: sensitivity as AgentContextSource["sensitivity"],
    customerVisible: parseBoolean(record.customerVisible, "customerVisible"),
    status: status as AgentContextSource["status"]
  };
}

function parseAgentCorrectionBody(body: AgentCorrectionBody | null | undefined): {
  correction: string;
  category: AgentOwnerCorrection["category"];
  sourceMessageId?: string | null;
  promoteToInstruction: boolean;
} {
  const record = parseRequestBody(body);
  const category = parseString(record.category, "category");
  if (!["instruction", "business_fact", "memory", "response"].includes(category)) {
    throw new Cp2Error(400, "agent_correction_category_invalid", "Correction category is invalid.");
  }
  return {
    correction: parseString(record.correction, "correction"),
    category: category as AgentOwnerCorrection["category"],
    ...(record.sourceMessageId === undefined
      ? {}
      : { sourceMessageId: parseNullableString(record.sourceMessageId) }),
    promoteToInstruction: parseBoolean(record.promoteToInstruction, "promoteToInstruction")
  };
}

function parseAgentFeedbackBody(body: AgentFeedbackBody | null | undefined): {
  messageId?: string | null;
  correct: boolean;
  reason?: string | null;
} {
  const record = parseRequestBody(body);
  return {
    ...(record.messageId === undefined ? {} : { messageId: parseNullableString(record.messageId) }),
    correct: parseBoolean(record.correct, "correct"),
    ...(record.reason === undefined ? {} : { reason: parseNullableString(record.reason) })
  };
}

function parseStructuredArray<T>(value: unknown, name: string, maximumItems: number): T[] {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new Cp2Error(
      400,
      `${name}_invalid`,
      `${name} must be an array with ${maximumItems} items or fewer.`
    );
  }
  return value.map((item) => parseRequestBody(item) as unknown as T);
}

function parseRecallEffectivenessBody(body: RecallEffectivenessBody | null | undefined): {
  sourceIds: string[];
  outcome: "local_success" | "cloud_fallback";
  localRuntime: RuntimeRecallEscalation["localRuntime"];
  modelId: string;
} {
  const record = parseRequestBody(body);
  const outcome = parseString(record.outcome, "outcome");
  if (outcome !== "local_success" && outcome !== "cloud_fallback") {
    throw new Cp2Error(
      400,
      "recall_effectiveness_invalid",
      "Recall effectiveness outcome is not supported."
    );
  }
  const localRuntime = parseRuntimeRecallEscalation({
    reason: "effectiveness",
    localRuntime: record.localRuntime
  }).localRuntime;
  return {
    sourceIds: parseStringArray(record.sourceIds, "sourceIds", 3),
    outcome,
    localRuntime,
    modelId: parseString(record.modelId, "modelId")
  };
}

function parseInstalledModelBody(
  body: InstalledModelBody
): Omit<InstalledAgentModelSummary, "accountId" | "userId"> {
  return {
    id: parseString(body.id, "id"),
    deviceId: parseString(body.deviceId, "deviceId"),
    modelId: parseString(body.modelId, "modelId"),
    displayName: parseString(body.displayName, "displayName"),
    provider: parseModelProvider(body.provider),
    repositoryId: parseNullableString(body.repositoryId),
    filename: parseString(body.filename, "filename"),
    format: parseModelFormat(body.format),
    quantization: parseNullableString(body.quantization),
    architecture: parseNullableString(body.architecture),
    parameterCount: parseNullablePositiveInteger(body.parameterCount, "parameterCount"),
    contextLength: parseNullablePositiveInteger(body.contextLength, "contextLength"),
    fileSizeBytes: parsePositiveInteger(body.fileSizeBytes, "fileSizeBytes"),
    checksum: parseNullableString(body.checksum),
    packageManifestVersion: parseNullableString(body.packageManifestVersion),
    packageSignature: parseNullableString(body.packageSignature),
    packageSigningKeyId: parseNullableString(body.packageSigningKeyId),
    license: parseString(body.license, "license"),
    commercialUseAllowed: parseBoolean(body.commercialUseAllowed, "commercialUseAllowed"),
    storageKey: parseString(body.storageKey, "storageKey"),
    runtimeBackend: parseAgentModelRuntimeBackend(body.runtimeBackend),
    installationStatus: parseModelInstallationStatus(body.installationStatus),
    compatibilityStatus: parseModelCompatibilityStatus(body.compatibilityStatus),
    installedAt: parseIsoTimestamp(body.installedAt, "installedAt"),
    lastVerifiedAt:
      body.lastVerifiedAt === null
        ? null
        : parseIsoTimestamp(body.lastVerifiedAt, "lastVerifiedAt"),
    validationError: parseNullableString(body.validationError)
  };
}

function parseOssAgentSummary(value: unknown): OssAgentSummary {
  const agent = parseRequestBody(value);
  const id = parseString(agent.id, "agent.id");
  if (!isAgentDefinitionId(id) || id === "builtin:shopkeeper") {
    throw new Cp2Error(400, "agent_manifest_invalid", "Agent manifest ID is invalid.");
  }
  const source = agent.source;
  if (source !== "github" && source !== "huggingface") {
    throw new Cp2Error(400, "agent_manifest_invalid", "Agent manifest source is invalid.");
  }
  const runtime = agent.runtime;
  if (
    runtime !== "docker" &&
    runtime !== "gradio" &&
    runtime !== "javascript" &&
    runtime !== "python" &&
    runtime !== "typescript" &&
    runtime !== "unknown"
  ) {
    throw new Cp2Error(400, "agent_manifest_invalid", "Agent runtime is invalid.");
  }
  const executionMode = agent.executionMode;
  if (executionMode !== "hosted-api" && executionMode !== "backend-adapter") {
    throw new Cp2Error(400, "agent_manifest_invalid", "Agent execution mode is invalid.");
  }
  const minimumDeviceTier = agent.minimumDeviceTier;
  if (
    minimumDeviceTier !== "low" &&
    minimumDeviceTier !== "medium" &&
    minimumDeviceTier !== "high"
  ) {
    throw new Cp2Error(400, "agent_manifest_invalid", "Agent device tier is invalid.");
  }
  const popularity = agent.popularity;
  if (!Number.isSafeInteger(popularity) || (popularity as number) < 0) {
    throw new Cp2Error(400, "agent_manifest_invalid", "Agent popularity is invalid.");
  }
  return {
    id,
    label: parseString(agent.label, "agent.label"),
    description: parseString(agent.description, "agent.description"),
    source,
    sourceId: parseString(agent.sourceId, "agent.sourceId"),
    sourceUrl: parseString(agent.sourceUrl, "agent.sourceUrl"),
    license: parseString(agent.license, "agent.license"),
    licenseUrl: parseString(agent.licenseUrl, "agent.licenseUrl"),
    licenseVerified: parseBoolean(agent.licenseVerified, "agent.licenseVerified"),
    runtime,
    executionMode,
    minimumDeviceTier,
    minimumMemoryGb: parsePositiveInteger(agent.minimumMemoryGb, "agent.minimumMemoryGb"),
    requiresGpu: parseBoolean(agent.requiresGpu, "agent.requiresGpu"),
    popularity: popularity as number,
    capabilities: parseStringArray(agent.capabilities, "agent.capabilities", 40),
    updatedAt:
      agent.updatedAt === null ? null : parseIsoTimestamp(agent.updatedAt, "agent.updatedAt")
  };
}

function parseModelProvider(value: unknown): InstalledAgentModelSummary["provider"] {
  if (value === "huggingface" || value === "github" || value === "custom") return value;
  throw new Cp2Error(400, "model_provider_invalid", "Model provider is invalid.");
}

function parseModelFormat(value: unknown): "GGUF" {
  if (value === "GGUF") return value;
  throw new Cp2Error(400, "model_format_invalid", "Only GGUF models are supported.");
}

function parseModelInstallationStatus(value: unknown): ModelInstallationStatus {
  if (
    value === "DOWNLOADING" ||
    value === "INSTALLED" ||
    value === "CORRUPT" ||
    value === "REMOVED" ||
    value === "FAILED"
  ) {
    return value;
  }
  throw new Cp2Error(400, "model_installation_status_invalid", "Installation status is invalid.");
}

function parseModelCompatibilityStatus(value: unknown): ModelCompatibilityStatus {
  if (
    value === "UNKNOWN" ||
    value === "COMPATIBLE" ||
    value === "INCOMPATIBLE" ||
    value === "INSUFFICIENT_MEMORY" ||
    value === "UNSUPPORTED_ARCHITECTURE" ||
    value === "UNSUPPORTED_QUANTIZATION"
  ) {
    return value;
  }
  throw new Cp2Error(400, "model_compatibility_status_invalid", "Compatibility status is invalid.");
}

function parseAgentModelRuntimeBackend(value: unknown): AgentModelRuntimeBackend {
  if (
    value === "LLAMA_CPP_ANDROID" ||
    value === "LLAMA_CPP_BROWSER" ||
    value === "OLLAMA" ||
    value === "CLOUD"
  ) {
    return value;
  }
  throw new Cp2Error(400, "model_runtime_backend_invalid", "Runtime backend is invalid.");
}

function parsePreferredExecutionMode(value: unknown): PreferredExecutionMode {
  if (value === "LOCAL_ONLY" || value === "LOCAL_FIRST" || value === "CLOUD_ONLY") return value;
  throw new Cp2Error(400, "execution_mode_invalid", "Execution mode is invalid.");
}

function parseAgentModelFallbackPolicy(value: unknown): AgentModelFallbackPolicy {
  if (
    value === "NEVER" ||
    value === "WHEN_LOCAL_UNAVAILABLE" ||
    value === "WHEN_LOCAL_FAILS" ||
    value === "WHEN_CONTEXT_EXCEEDED"
  ) {
    return value;
  }
  throw new Cp2Error(400, "fallback_policy_invalid", "Fallback policy is invalid.");
}

function parseModelExecutionTarget(value: unknown): ModelExecutionTarget {
  if (
    value === "backend" ||
    value === "browser-local" ||
    value === "installed-app" ||
    value === "remote-shop-device" ||
    value === "openai"
  ) {
    return value;
  }
  throw new Cp2Error(400, "execution_target_invalid", "Execution target is invalid.");
}

function parseAgentModelBindingPermissions(value: unknown): AgentModelBindingPermissions {
  const permissions = parseRequestBody(value);
  return {
    allowInstalledApp: parseBoolean(permissions.allowInstalledApp, "permissions.allowInstalledApp"),
    allowRemoteShopDevice: parseBoolean(
      permissions.allowRemoteShopDevice,
      "permissions.allowRemoteShopDevice"
    ),
    allowBackendFallback: parseBoolean(
      permissions.allowBackendFallback,
      "permissions.allowBackendFallback"
    )
  };
}

function parseAgentModelReadinessStatus(value: unknown): AgentModelReadinessStatus {
  if (value === "ATTACHED" || value === "LOADING" || value === "READY" || value === "FAILED") {
    return value;
  }
  throw new Cp2Error(400, "model_readiness_status_invalid", "Readiness status is invalid.");
}

function parseBrowserDeviceTier(value: unknown): BrowserDeviceTier | null {
  if (value === null || value === undefined) return null;
  if (value === "low" || value === "medium" || value === "high") return value;
  throw new Cp2Error(400, "browser_device_tier_invalid", "Browser device tier is invalid.");
}

function parseBrowserRuntimeContract(value: unknown): BrowserRuntimeContract | null {
  if (value === null || value === undefined) return null;
  const contract = parseRequestBody(value);
  if (
    contract.schemaVersion !== 1 ||
    (contract.adapterId !== "transformers-js" && contract.adapterId !== "webllm") ||
    (contract.runtime !== "browser-webgpu" && contract.runtime !== "browser-wasm") ||
    (contract.backend !== "webgpu" && contract.backend !== "wasm") ||
    contract.streaming !== true ||
    contract.cancellation !== true ||
    (contract.tokenCounting !== "exact" && contract.tokenCounting !== "estimated") ||
    !Array.isArray(contract.checkpointKinds) ||
    contract.checkpointKinds.some(
      (kind) => kind !== "task-state" && kind !== "token-replay" && kind !== "native-kv"
    ) ||
    (contract.nativeStateFormat !== null && typeof contract.nativeStateFormat !== "string")
  ) {
    throw new Cp2Error(
      400,
      "browser_runtime_contract_invalid",
      "Browser runtime contract is invalid."
    );
  }
  return {
    schemaVersion: 1,
    adapterId: contract.adapterId,
    adapterVersion: parseString(contract.adapterVersion, "runtimeContract.adapterVersion"),
    libraryRevision: parseNullableString(contract.libraryRevision),
    runtime: contract.runtime,
    backend: contract.backend,
    streaming: true,
    cancellation: true,
    tokenCounting: contract.tokenCounting,
    checkpointKinds: [...contract.checkpointKinds] as BrowserRuntimeContract["checkpointKinds"],
    nativeStateFormat: parseNullableString(contract.nativeStateFormat)
  };
}

function parseBrowserCheckpointContract(
  value: unknown
): BrowserCheckpointCompatibilityContract | null {
  if (value === null || value === undefined) return null;
  const contract = parseRequestBody(value);
  if (
    contract.schemaVersion !== 1 ||
    contract.checkpointKind !== "task-state" ||
    contract.taskStateSchema !== "soko.browser-task-state.v2" ||
    (contract.sourceAdapterId !== "transformers-js" && contract.sourceAdapterId !== "webllm") ||
    contract.promptRepresentation !== "role-content-messages" ||
    contract.portableAcrossAdapters !== true
  ) {
    throw new Cp2Error(
      400,
      "browser_checkpoint_contract_invalid",
      "Browser checkpoint compatibility contract is invalid."
    );
  }
  return {
    schemaVersion: 1,
    checkpointKind: "task-state",
    taskStateSchema: "soko.browser-task-state.v2",
    modelFamilyId: parseString(contract.modelFamilyId, "checkpointContract.modelFamilyId"),
    sourceModelId: parseString(contract.sourceModelId, "checkpointContract.sourceModelId"),
    sourceModelRevision: parseString(
      contract.sourceModelRevision,
      "checkpointContract.sourceModelRevision"
    ),
    sourceAdapterId: contract.sourceAdapterId,
    promptRepresentation: "role-content-messages",
    portableAcrossAdapters: true
  };
}

function parseNullablePositiveInteger(value: unknown, name: string): number | null {
  return value === null ? null : parsePositiveInteger(value, name);
}

function observeRequestAbort(
  request: FastifyRequest,
  reply: FastifyReply
): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const abort = () => controller.abort(new Error("The HTTP client disconnected."));
  const abortIfResponseClosed = () => {
    if (!reply.raw.writableEnded) abort();
  };
  if (request.raw.aborted) {
    abort();
  } else {
    request.raw.once("aborted", abort);
    reply.raw.once("close", abortIfResponseClosed);
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      request.raw.off("aborted", abort);
      reply.raw.off("close", abortIfResponseClosed);
    }
  };
}
