/**
 * Runtime Handoff Protocol REST surface (docs/architecture/runtime-handoff-protocol.md section
 * 15). Namespaced under `/v1/runtime/...` to match this codebase's existing `/v1/...` route
 * convention (the protocol doc's reference paths are bare `/runtime/...`).
 *
 * Every handler is a thin translation from HTTP to a `Cp2Store` call - all auth, optimistic
 * concurrency, idempotency, and orchestration logic lives in `RuntimeHandoffDomain`
 * (services/api/src/cp2/domains/runtime-handoff/store.ts), exactly like every other domain's
 * routes file in this codebase.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type {
  RuntimeAction,
  RuntimeActionStatus,
  RuntimeArtifactReference,
  RuntimeContextReference,
  RuntimeContextReferenceKind,
  RuntimeDecision,
  RuntimeOfflineCheckpointInput,
  RuntimeRejectedPath,
  RuntimeSwapDimension
} from "@soko/shared-types";
import { Cp2Error, type Cp2Store, readSessionCookie } from "../../store.js";
import {
  parseNullableString,
  parseRequestBody,
  parseString,
  readHeader,
  sendCp2Error
} from "../../route-helpers.js";

interface TaskParams {
  taskId: string;
}

interface TaskHandoffParams extends TaskParams {
  handoffId: string;
}

interface HandoffQuery {
  version?: string;
}

function parseObjectArray(value: unknown, name: string): Record<string, unknown>[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Cp2Error(400, `${name}_invalid`, `${name} must be an array.`);
  }
  return value.map((entry) => parseRequestBody(entry));
}

function parseActions(value: unknown, name: string): RuntimeAction[] | undefined {
  const entries = parseObjectArray(value, name);
  if (entries === undefined) return undefined;
  return entries.map((entry) => ({
    id: parseString(entry.id, `${name}.id`),
    description: parseString(entry.description, `${name}.description`),
    ...(entry.status === undefined
      ? {}
      : { status: parseString(entry.status, `${name}.status`) as RuntimeActionStatus }),
    ...(entry.metadata === undefined ? {} : { metadata: parseRequestBody(entry.metadata) })
  }));
}

function parseDecisions(value: unknown, name: string): RuntimeDecision[] | undefined {
  const entries = parseObjectArray(value, name);
  if (entries === undefined) return undefined;
  return entries.map((entry) => ({
    id: parseString(entry.id, `${name}.id`),
    description: parseString(entry.description, `${name}.description`),
    rationale: parseNullableString(entry.rationale ?? null),
    decidedAt: parseString(entry.decidedAt, `${name}.decidedAt`)
  }));
}

function parseRejectedPaths(value: unknown, name: string): RuntimeRejectedPath[] | undefined {
  const entries = parseObjectArray(value, name);
  if (entries === undefined) return undefined;
  return entries.map((entry) => ({
    id: parseString(entry.id, `${name}.id`),
    description: parseString(entry.description, `${name}.description`),
    reason: parseString(entry.reason, `${name}.reason`)
  }));
}

function parseContextRefs(value: unknown, name: string): RuntimeContextReference[] | undefined {
  const entries = parseObjectArray(value, name);
  if (entries === undefined) return undefined;
  return entries.map((entry) => ({
    kind: parseString(entry.kind, `${name}.kind`) as RuntimeContextReferenceKind,
    refId: parseString(entry.refId, `${name}.refId`),
    ...(entry.description === undefined
      ? {}
      : { description: parseString(entry.description, `${name}.description`) })
  }));
}

function parseArtifactRefs(value: unknown, name: string): RuntimeArtifactReference[] | undefined {
  const entries = parseObjectArray(value, name);
  if (entries === undefined) return undefined;
  return entries.map((entry) => ({
    id: parseString(entry.id, `${name}.id`),
    kind: parseString(entry.kind, `${name}.kind`),
    uri: parseString(entry.uri, `${name}.uri`),
    ...(entry.description === undefined
      ? {}
      : { description: parseString(entry.description, `${name}.description`) })
  }));
}

function parseStringList(value: unknown, name: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Cp2Error(400, `${name}_invalid`, `${name} must be an array of strings.`);
  }
  return value as string[];
}

function parseRuntimeRef(
  value: unknown,
  name: string
): { agentId: string; modelId: string; executionHostId: string } {
  const entry = parseRequestBody(value);
  return {
    agentId: parseString(entry.agentId, `${name}.agentId`),
    modelId: parseString(entry.modelId, `${name}.modelId`),
    executionHostId: parseString(entry.executionHostId, `${name}.executionHostId`)
  };
}

function parseTestResults(
  value: unknown,
  name: string
): { passed: string[]; failed: string[]; pending: string[] } {
  const entry = parseRequestBody(value);
  return {
    passed: parseStringList(entry.passed, `${name}.passed`) ?? [],
    failed: parseStringList(entry.failed, `${name}.failed`) ?? [],
    pending: parseStringList(entry.pending, `${name}.pending`) ?? []
  };
}

/** One offline-created checkpoint, as submitted to `.../checkpoints/sync`. Every field here is
 *  required - unlike an online checkpoint (which only carries the fields the caller wants to
 *  change over the previous handoff), an offline checkpoint is a complete standalone record: the
 *  client had no server-side previous handoff to diff against while offline. */
function parseOfflineCheckpoint(value: unknown, index: number): RuntimeOfflineCheckpointInput {
  const name = `checkpoints[${index}]`;
  const entry = parseRequestBody(value);
  return {
    id: parseString(entry.id, `${name}.id`),
    parentHandoffId: parseNullableString(entry.parentHandoffId ?? null),
    goal: parseString(entry.goal, `${name}.goal`),
    currentState: parseString(entry.currentState, `${name}.currentState`),
    completedActions: parseActions(entry.completedActions, `${name}.completedActions`) ?? [],
    decisions: parseDecisions(entry.decisions, `${name}.decisions`) ?? [],
    rejectedPaths: parseRejectedPaths(entry.rejectedPaths, `${name}.rejectedPaths`) ?? [],
    pendingActions: parseActions(entry.pendingActions, `${name}.pendingActions`) ?? [],
    nextAction: parseNullableString(entry.nextAction ?? null),
    relevantContext: parseContextRefs(entry.relevantContext, `${name}.relevantContext`) ?? [],
    artifacts: parseArtifactRefs(entry.artifacts, `${name}.artifacts`) ?? [],
    tests: parseTestResults(entry.tests ?? {}, `${name}.tests`),
    runtime: parseRuntimeRef(entry.runtime, `${name}.runtime`),
    schemaVersion:
      entry.schemaVersion === undefined ? 1 : Number.parseInt(String(entry.schemaVersion), 10),
    createdAt: parseString(entry.createdAt, `${name}.createdAt`)
  };
}

interface OfflineSyncBody {
  checkpoints?: unknown;
  promote?: unknown;
  promoteToHandoffId?: unknown;
  expectedHandoffId?: unknown;
}

interface MergeBody {
  branchHandoffIds?: unknown;
  goal?: unknown;
  currentState?: unknown;
  completedActions?: unknown;
  decisions?: unknown;
  rejectedPaths?: unknown;
  pendingActions?: unknown;
  nextAction?: unknown;
  relevantContext?: unknown;
  artifacts?: unknown;
  testsPassed?: unknown;
  testsFailed?: unknown;
  testsPending?: unknown;
  expectedHandoffId?: unknown;
}

interface CheckpointBody {
  goal?: unknown;
  currentState?: unknown;
  completedActions?: unknown;
  decisions?: unknown;
  rejectedPaths?: unknown;
  pendingActions?: unknown;
  nextAction?: unknown;
  relevantContext?: unknown;
  artifacts?: unknown;
  testsPassed?: unknown;
  testsFailed?: unknown;
  testsPending?: unknown;
  promote?: unknown;
  expectedHandoffId?: unknown;
}

interface SwapBody {
  targetId?: unknown;
  expectedHandoffId?: unknown;
}

interface RollbackBody {
  targetHandoffId?: unknown;
  expectedHandoffId?: unknown;
}

export function registerRuntimeHandoffRoutes(app: FastifyInstance, store: Cp2Store): void {
  app.get("/v1/runtime/:taskId", async (request: FastifyRequest<{ Params: TaskParams }>, reply) => {
    try {
      return store.resolveRuntimeHandoff(
        readSessionCookie(request.headers.cookie),
        request.params.taskId
      );
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.get(
    "/v1/runtime/:taskId/handoff",
    async (request: FastifyRequest<{ Params: TaskParams; Querystring: HandoffQuery }>, reply) => {
      try {
        const sessionId = readSessionCookie(request.headers.cookie);
        if (request.query.version !== undefined) {
          const version = Number.parseInt(request.query.version, 10);
          if (!Number.isInteger(version) || version < 1) {
            throw new Cp2Error(400, "version_invalid", "version must be a positive integer.");
          }
          return store.getRuntimeHandoffByVersion(sessionId, request.params.taskId, version);
        }
        return store.resolveRuntimeHandoff(sessionId, request.params.taskId).activeHandoff;
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/v1/runtime/:taskId/handoffs/:handoffId",
    async (request: FastifyRequest<{ Params: TaskHandoffParams }>, reply) => {
      try {
        return store.getRuntimeHandoffById(
          readSessionCookie(request.headers.cookie),
          request.params.taskId,
          request.params.handoffId
        );
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/v1/runtime/:taskId/checkpoints",
    async (request: FastifyRequest<{ Params: TaskParams; Body: CheckpointBody }>, reply) => {
      try {
        const body = parseRequestBody(request.body);
        const completedActions = parseActions(body.completedActions, "completedActions");
        const decisions = parseDecisions(body.decisions, "decisions");
        const rejectedPaths = parseRejectedPaths(body.rejectedPaths, "rejectedPaths");
        const pendingActions = parseActions(body.pendingActions, "pendingActions");
        const relevantContext = parseContextRefs(body.relevantContext, "relevantContext");
        const artifacts = parseArtifactRefs(body.artifacts, "artifacts");
        const testsPassed = parseStringList(body.testsPassed, "testsPassed");
        const testsFailed = parseStringList(body.testsFailed, "testsFailed");
        const testsPending = parseStringList(body.testsPending, "testsPending");
        return store.createRuntimeCheckpoint(readSessionCookie(request.headers.cookie), {
          taskId: request.params.taskId,
          idempotencyKey: readHeader(request, "idempotency-key"),
          ...(body.goal === undefined ? {} : { goal: parseString(body.goal, "goal") }),
          ...(body.currentState === undefined
            ? {}
            : { currentState: parseString(body.currentState, "currentState") }),
          ...(completedActions === undefined ? {} : { completedActions }),
          ...(decisions === undefined ? {} : { decisions }),
          ...(rejectedPaths === undefined ? {} : { rejectedPaths }),
          ...(pendingActions === undefined ? {} : { pendingActions }),
          ...(body.nextAction === undefined
            ? {}
            : { nextAction: parseNullableString(body.nextAction) }),
          ...(relevantContext === undefined ? {} : { relevantContext }),
          ...(artifacts === undefined ? {} : { artifacts }),
          ...(testsPassed === undefined ? {} : { testsPassed }),
          ...(testsFailed === undefined ? {} : { testsFailed }),
          ...(testsPending === undefined ? {} : { testsPending }),
          ...(body.promote === undefined ? {} : { promote: body.promote === true }),
          ...(body.expectedHandoffId === undefined
            ? {}
            : { expectedHandoffId: parseString(body.expectedHandoffId, "expectedHandoffId") })
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  const registerSwapRoute = (dimension: RuntimeSwapDimension): void => {
    app.post(
      `/v1/runtime/:taskId/swaps/${dimension}`,
      async (request: FastifyRequest<{ Params: TaskParams; Body: SwapBody }>, reply) => {
        try {
          const body = parseRequestBody(request.body);
          return store.performRuntimeSwap(readSessionCookie(request.headers.cookie), {
            taskId: request.params.taskId,
            dimension,
            targetId: parseString(body.targetId, "targetId"),
            idempotencyKey: readHeader(request, "idempotency-key"),
            ...(body.expectedHandoffId === undefined
              ? {}
              : { expectedHandoffId: parseString(body.expectedHandoffId, "expectedHandoffId") })
          });
        } catch (error) {
          return sendCp2Error(reply, error);
        }
      }
    );
  };
  registerSwapRoute("agent");
  registerSwapRoute("model");
  registerSwapRoute("host");

  app.post(
    "/v1/runtime/:taskId/resume",
    async (request: FastifyRequest<{ Params: TaskParams }>, reply) => {
      try {
        return store.resumeRuntimeHandoff(readSessionCookie(request.headers.cookie), {
          taskId: request.params.taskId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/v1/runtime/:taskId/rollback",
    async (request: FastifyRequest<{ Params: TaskParams; Body: RollbackBody }>, reply) => {
      try {
        const body = parseRequestBody(request.body);
        return store.rollbackRuntimeHandoff(readSessionCookie(request.headers.cookie), {
          taskId: request.params.taskId,
          targetHandoffId: parseString(body.targetHandoffId, "targetHandoffId"),
          idempotencyKey: readHeader(request, "idempotency-key"),
          ...(body.expectedHandoffId === undefined
            ? {}
            : { expectedHandoffId: parseString(body.expectedHandoffId, "expectedHandoffId") })
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/v1/runtime/:taskId/checkpoints/sync",
    async (request: FastifyRequest<{ Params: TaskParams; Body: OfflineSyncBody }>, reply) => {
      try {
        const body = parseRequestBody(request.body);
        if (!Array.isArray(body.checkpoints)) {
          throw new Cp2Error(400, "checkpoints_invalid", "checkpoints must be an array.");
        }
        return store.syncOfflineRuntimeCheckpoints(readSessionCookie(request.headers.cookie), {
          taskId: request.params.taskId,
          checkpoints: body.checkpoints.map((entry, index) => parseOfflineCheckpoint(entry, index)),
          idempotencyKey: readHeader(request, "idempotency-key"),
          ...(body.promote === undefined ? {} : { promote: body.promote === true }),
          ...(body.promoteToHandoffId === undefined
            ? {}
            : { promoteToHandoffId: parseString(body.promoteToHandoffId, "promoteToHandoffId") }),
          ...(body.expectedHandoffId === undefined
            ? {}
            : { expectedHandoffId: parseString(body.expectedHandoffId, "expectedHandoffId") })
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/v1/runtime/:taskId/merge",
    async (request: FastifyRequest<{ Params: TaskParams; Body: MergeBody }>, reply) => {
      try {
        const body = parseRequestBody(request.body);
        const branchHandoffIds = parseStringList(body.branchHandoffIds, "branchHandoffIds");
        if (branchHandoffIds === undefined) {
          throw new Cp2Error(400, "branchHandoffIds_required", "branchHandoffIds is required.");
        }
        const completedActions = parseActions(body.completedActions, "completedActions");
        const decisions = parseDecisions(body.decisions, "decisions");
        const rejectedPaths = parseRejectedPaths(body.rejectedPaths, "rejectedPaths");
        const pendingActions = parseActions(body.pendingActions, "pendingActions");
        const relevantContext = parseContextRefs(body.relevantContext, "relevantContext");
        const artifacts = parseArtifactRefs(body.artifacts, "artifacts");
        const testsPassed = parseStringList(body.testsPassed, "testsPassed");
        const testsFailed = parseStringList(body.testsFailed, "testsFailed");
        const testsPending = parseStringList(body.testsPending, "testsPending");
        return store.mergeRuntimeHandoffs(readSessionCookie(request.headers.cookie), {
          taskId: request.params.taskId,
          branchHandoffIds,
          expectedHandoffId: parseString(body.expectedHandoffId, "expectedHandoffId"),
          idempotencyKey: readHeader(request, "idempotency-key"),
          ...(body.goal === undefined ? {} : { goal: parseString(body.goal, "goal") }),
          ...(body.currentState === undefined
            ? {}
            : { currentState: parseString(body.currentState, "currentState") }),
          ...(completedActions === undefined ? {} : { completedActions }),
          ...(decisions === undefined ? {} : { decisions }),
          ...(rejectedPaths === undefined ? {} : { rejectedPaths }),
          ...(pendingActions === undefined ? {} : { pendingActions }),
          ...(body.nextAction === undefined
            ? {}
            : { nextAction: parseNullableString(body.nextAction) }),
          ...(relevantContext === undefined ? {} : { relevantContext }),
          ...(artifacts === undefined ? {} : { artifacts }),
          ...(testsPassed === undefined ? {} : { testsPassed }),
          ...(testsFailed === undefined ? {} : { testsFailed }),
          ...(testsPending === undefined ? {} : { testsPending })
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );
}
