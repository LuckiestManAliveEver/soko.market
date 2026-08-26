import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createPostgresCp2Store } from "../services/api/src/cp2/postgres-store";

interface TestPool {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  end(): Promise<void>;
}

const requireApiDependency = createRequire(resolve(process.cwd(), "services/api/package.json"));
const { Pool } = requireApiDependency("pg") as {
  Pool: new (options: { connectionString: string }) => TestPool;
};

const databaseUrl = process.env.CP2_POSTGRES_TEST_DATABASE_URL;
const describePostgres = databaseUrl === undefined ? describe.skip : describe;

function uniquePhone(): string {
  return `254701${Date.now().toString().slice(-6)}`;
}

/**
 * Phase 2.5 (docs/architecture/agent-execution-fabric-phase2-5.md). These are the actual
 * regression tests for the bug this phase fixes: ExecutionFabricStore was a bare in-memory Map,
 * so every ModelPreference/RuntimeHost/RuntimeModelInstallation written while
 * EXECUTION_FABRIC_ENABLED=true vanished on the next deploy or restart. Every test here creates
 * one `PostgresCp2Store`, writes through it, flushes, closes it, then creates a SECOND, brand-new
 * `PostgresCp2Store` instance (a real, from-scratch process boundary, not just re-reading the same
 * in-memory object) and proves the data is still there - exactly simulating a Render redeploy.
 */
describePostgres("execution fabric - Postgres persistence across a simulated restart", () => {
  it("a ModelPreference written before a restart is still readable after one", async () => {
    const connectionString = databaseUrl ?? "";
    const store = await createPostgresCp2Store({ databaseUrl: connectionString });
    const auth = store.signupWithPhonePin({ destination: uniquePhone(), pin: "1234" });
    const business = store.createBusiness({
      sessionId: auth.session.id,
      name: "Persistence Test Shop",
      language: "en"
    });
    const businessId = business.business.id;

    const created = store.createModelPreference({
      sessionId: auth.session.id,
      businessId,
      scope: "agent",
      scopeId: businessId,
      preferredModelIds: ["qwen2.5-0.5b-android"],
      fallbackModelIds: ["qwen2.5-1.5b-android"],
      requiredCapabilities: [],
      executionPreference: "local-first",
      qualityPreference: "best",
      allowCloudFallback: false,
      maxCostPerRequest: null,
      maxLatencyMs: 4_000,
      minimumContextWindow: null
    });
    await store.flush();
    await store.close();

    const restored = await createPostgresCp2Store({ databaseUrl: connectionString });
    const readBack = restored.getModelPreference({
      sessionId: auth.session.id,
      businessId,
      scope: "agent",
      scopeId: businessId
    });
    expect(readBack).toEqual(created);
    await restored.close();
  }, 20_000);

  it("a RuntimeHost registered before a restart is still readable after one, with no liveness field", async () => {
    const connectionString = databaseUrl ?? "";
    const store = await createPostgresCp2Store({ databaseUrl: connectionString });
    const auth = store.signupWithPhonePin({ destination: uniquePhone(), pin: "1234" });
    const business = store.createBusiness({
      sessionId: auth.session.id,
      name: "Runtime Host Shop",
      language: "en"
    });
    const businessId = business.business.id;

    const host = store.registerRuntimeHost({
      sessionId: auth.session.id,
      businessId,
      name: "Julien's laptop",
      trustLevel: "owner-verified",
      declaredRuntimes: ["native-llama-cpp"],
      maxConcurrentJobs: 2
    });
    await store.flush();
    await store.close();

    const restored = await createPostgresCp2Store({ databaseUrl: connectionString });
    const readBack = restored.getRuntimeHost({
      sessionId: auth.session.id,
      businessId,
      runtimeHostId: host.id
    });
    expect(readBack).toEqual(host);

    // The actual invariant this phase must never violate (docs/inference/owner-node.md:32): no
    // field that could be mistaken for live online/offline status is ever persisted, even after a
    // real Postgres round trip - not merely absent from the in-memory type, but genuinely absent
    // from the row that comes back out.
    expect(readBack).not.toHaveProperty("online");
    expect(readBack).not.toHaveProperty("lastHeartbeatAt");
    expect(Object.keys(readBack ?? {}).sort()).toEqual(
      [
        "id",
        "accountId",
        "ownerId",
        "name",
        "trustLevel",
        "brokerNodeId",
        "declaredRuntimes",
        "maxConcurrentJobs",
        "createdAt",
        "updatedAt"
      ].sort()
    );

    await restored.close();
  }, 20_000);

  it("a RuntimeModelInstallation registered before a restart is still readable after one, and its parent_id column actually links it to its host", async () => {
    const connectionString = databaseUrl ?? "";
    const store = await createPostgresCp2Store({ databaseUrl: connectionString });
    const auth = store.signupWithPhonePin({ destination: uniquePhone(), pin: "1234" });
    const business = store.createBusiness({
      sessionId: auth.session.id,
      name: "Installation Shop",
      language: "en"
    });
    const businessId = business.business.id;

    const host = store.registerRuntimeHost({
      sessionId: auth.session.id,
      businessId,
      name: "Host",
      trustLevel: "owner-verified",
      declaredRuntimes: [],
      maxConcurrentJobs: 1
    });
    const installation = store.installRuntimeModel({
      sessionId: auth.session.id,
      businessId,
      runtimeHostId: host.id,
      modelId: "qwen2.5-0.5b-android"
    });
    await store.flush();
    await store.close();

    const restored = await createPostgresCp2Store({ databaseUrl: connectionString });
    const readBack = restored.listRuntimeModelInstallations({
      sessionId: auth.session.id,
      businessId,
      runtimeHostId: host.id
    });
    expect(readBack).toEqual([installation]);

    // The generic normalized-store mechanism derives `parent_id` from a fixed field-name
    // candidate list (services/api/src/cp2/postgres-store.ts's `firstText` calls) - this is the
    // real regression check that "runtimeHostId" was actually added to that list, not just that
    // the record round-trips through its own jsonb payload (which would pass even if parent_id
    // silently stayed null, since nothing reads that column back through the application).
    const pool = new Pool({ connectionString });
    try {
      const row = await pool.query<{ parent_id: string | null }>(
        "select parent_id from cp2_runtime_model_installations where entity_id = $1",
        [installation.id]
      );
      expect(row.rows[0]?.parent_id).toBe(host.id);
    } finally {
      await pool.end();
    }

    await restored.close();
  }, 20_000);
});
