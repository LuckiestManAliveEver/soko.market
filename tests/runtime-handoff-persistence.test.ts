import { describe, expect, it } from "vitest";
import { createPostgresCp2Store } from "../services/api/src/cp2/postgres-store";

const databaseUrl = process.env.CP2_POSTGRES_TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("runtime handoff durability", () => {
  it("persists preparation and completion through the real Postgres proxy across restarts", async () => {
    let store = await createPostgresCp2Store({ databaseUrl: databaseUrl! });
    try {
      const actor = store.continueWithChannelPin({
        channel: "phone",
        destination: `+254799${Date.now().toString().slice(-6)}`,
        pin: "7421"
      });
      const sessionId = actor.session.id;
      const business = store.createBusiness({
        sessionId,
        name: "Handoff persistence test",
        language: "en"
      }).business;
      const conversation = store.createConversation({
        sessionId,
        kind: "personal",
        activeShopId: business.id
      }).conversation;
      const source = store.resolveRuntimeHandoff(sessionId, conversation.id).activeHandoff;
      await store.flush();
      const snapshot = store.snapshot();
      const sourceHost = snapshot.nativeExecutionHosts!.find(
        (host) => host.id === source.runtime.executionHostId
      )!;
      const localId = `local-${conversation.id}`;
      snapshot.nativeExecutionHosts!.push({
        ...sourceHost,
        id: localId,
        accountId: actor.account.id,
        businessId: business.id,
        type: "remote-shop-device",
        capabilities: ["runtime-handoff-v1"],
        configuration: { deviceId: "persistence-device" }
      });
      const installed = snapshot.nativeModelInstallations!.find(
        (item) => item.executionHostId === sourceHost.id && item.modelId === source.runtime.modelId
      )!;
      snapshot.nativeModelInstallations!.push({
        ...installed,
        id: `installation-${conversation.id}`,
        executionHostId: localId
      });
      store.hydrateSnapshot(snapshot);
      store.heartbeatRuntimeHost(sessionId, conversation.id, localId, "persistence-device", true);
      const input = {
        taskId: conversation.id,
        targetExecutionHostId: localId,
        expectedHandoffId: source.id,
        deviceId: "persistence-device",
        idempotencyKey: "durable-transfer"
      };
      const transfer = store.beginRuntimeTransfer(sessionId, input);
      expect(transfer.status).toBe("TARGET_ACTIVATING");
      await store.flush();
      await store.close();
      store = await createPostgresCp2Store({ databaseUrl: databaseUrl! });
      expect(store.getRuntimeTransfer(sessionId, conversation.id, transfer.id).status).toBe(
        "TARGET_ACTIVATING"
      );
      expect(store.beginRuntimeTransfer(sessionId, input).id).toBe(transfer.id);
      const cp = store.getRuntimeHandoffById(sessionId, conversation.id, transfer.checkpointId!);
      const completed = await store.completeRuntimeTransfer(
        sessionId,
        conversation.id,
        transfer.id,
        "persistence-device",
        {
          handoffId: cp.id,
          agentId: cp.runtime.agentId,
          modelId: cp.runtime.modelId,
          harness: true,
          artifacts: true,
          protectedContext: true,
          businessState: true
        }
      );
      expect(completed.status).toBe("COMPLETED");
      await store.flush();
      await store.close();
      store = await createPostgresCp2Store({ databaseUrl: databaseUrl! });
      expect(store.getRuntimeTransfer(sessionId, conversation.id, transfer.id).status).toBe(
        "COMPLETED"
      );
      expect(store.resolveRuntimeHandoff(sessionId, conversation.id).activeHandoff.id).toBe(cp.id);
    } finally {
      await store.close();
    }
  }, 30_000);
});
