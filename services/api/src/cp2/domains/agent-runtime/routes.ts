/**
 * Twelfth domain slice of in-process modularization for services/api/src/cp2/routes.ts (see
 * docs/architecture/routes-modularization-roadmap.md). Owns the AI-model catalogue/installation
 * routes, agent-model bindings, browser-inference assignments, agent profile/runtime metadata
 * (context sources, owner corrections, feedback), and runtime sessions/turns - everything that
 * calls into `domains/agent-runtime/store.ts`'s
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
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ClientInferenceCompletion } from "@soko/shared-types";
import { Cp2Error } from "../../cp2-error.js";
import { type Cp2Store, readSessionCookie } from "../../store.js";
import type { GitHubModelCatalog } from "../../github-model-catalog.js";
import type { HuggingFaceModelCatalog } from "../../huggingface-model-catalog.js";
import type { GitHubAgentCatalog } from "../../github-agent-catalog.js";
import type { HuggingFaceAgentCatalog } from "../../huggingface-agent-catalog.js";
import { parseRuntimeTurnBody } from "./runtime-turn-request.js";
export { parseRuntimeTurnBody } from "./runtime-turn-request.js";
import {
  parseAgentCatalogEntry,
  parseAgentContextSourceBody,
  parseAgentCorrectionBody,
  parseAgentFeedbackBody,
  parseAgentModelBindingPermissions,
  parseAgentModelReadinessStatus,
  parseAgentProfileBody,
  parseBrowserCheckpointContract,
  parseBrowserDeviceTier,
  parseBrowserRuntimeContract,
  parseInstalledModelBody,
  parseModelCatalogEntry,
  parseModelCompatibilityStatus,
  parseModelExecutionTarget,
  parseModelInstallationStatus,
  parseOssAgentSummary,
  parsePreferredExecutionMode,
  observeRequestAbort,
  type AgentContextSourceBody,
  type AgentCorrectionBody,
  type AgentFeedbackBody,
  type AgentProfileBody,
  type InstalledModelBody
} from "./route-body-parsers.js";
import {
  parseBoolean,
  parseIntegerString,
  parseIsoTimestamp,
  parseNullableString,
  parseOptionalString,
  parseRequestBody,
  parseString,
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
  permissions?: unknown;
}

interface AiModelActivationBody {
  modelId?: string;
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
  clientInferenceCompletion?: ClientInferenceCompletion;
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

  // DB-hosted catalog API (infra/db/migrations/071_platform_catalog.sql). Reads require an
  // authenticated session; writes additionally require platform-operator authority.
  // Every device already reaches the effective catalog through GET /v1/ai-models above; these
  // routes are how a platform operator edits what that endpoint serves, without a code deploy.
  // Store-side requirePlatformOperator (services/api/src/cp2/store.ts) is the actual authorization
  // boundary - these handlers pass the session through unchanged.
  app.get("/v1/platform/model-catalog", async (request, reply) => {
    try {
      return {
        models: store.listPlatformModelCatalog(readSessionCookie(request.headers.cookie))
      };
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.put(
    "/v1/platform/model-catalog/:modelId",
    async (request: FastifyRequest<{ Params: { modelId: string }; Body: unknown }>, reply) => {
      try {
        return {
          model: store.upsertModelCatalogEntry({
            sessionId: readSessionCookie(request.headers.cookie),
            model: parseModelCatalogEntry(request.body, request.params.modelId)
          })
        };
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.delete(
    "/v1/platform/model-catalog/:modelId",
    async (request: FastifyRequest<{ Params: { modelId: string } }>, reply) => {
      try {
        store.removeModelCatalogEntry({
          sessionId: readSessionCookie(request.headers.cookie),
          modelId: request.params.modelId
        });
        return { removed: true };
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get("/v1/platform/agent-catalog", async (request, reply) => {
    try {
      return {
        agents: store.listPlatformAgentCatalog(readSessionCookie(request.headers.cookie))
      };
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.put(
    "/v1/platform/agent-catalog/:agentDefinitionId",
    async (
      request: FastifyRequest<{ Params: { agentDefinitionId: string }; Body: unknown }>,
      reply
    ) => {
      try {
        return {
          agent: store.upsertAgentCatalogEntry({
            sessionId: readSessionCookie(request.headers.cookie),
            agent: parseAgentCatalogEntry(request.body, request.params.agentDefinitionId)
          })
        };
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.delete(
    "/v1/platform/agent-catalog/:agentDefinitionId",
    async (request: FastifyRequest<{ Params: { agentDefinitionId: string } }>, reply) => {
      try {
        store.removeAgentCatalogEntry({
          sessionId: readSessionCookie(request.headers.cookie),
          agentDefinitionId: request.params.agentDefinitionId
        });
        return { removed: true };
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
          permissions: parseAgentModelBindingPermissions(request.body.permissions),
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
      const cancellation = new AbortController();
      const abort = () => cancellation.abort();
      request.raw.once("aborted", abort);
      try {
        return await store.createRuntimeTurn({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          signal: cancellation.signal,
          ...parseRuntimeTurnBody(request.body)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      } finally {
        request.raw.off("aborted", abort);
      }
    }
  );
}
