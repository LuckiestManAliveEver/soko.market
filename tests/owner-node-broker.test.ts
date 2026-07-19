import { describe, expect, it } from "vitest";
import type { InferenceRequest, OwnerInferenceJob } from "../packages/shared-types/src/index";
import { OwnerNodeBroker } from "../services/api/src/inference/owner-node-broker";

const secret = "owner-node-test-signing-secret-at-least-32-characters";

function request(tenantId: string, requestId = "request-1"): InferenceRequest {
  return {
    requestId,
    tenantId,
    conversationId: "conversation",
    agentId: "agent",
    modelId: "model",
    messages: [{ role: "user", content: "Private prompt" }]
  };
}

describe("owner-node inference broker", () => {
  it("routes only to the matching tenant and streams authorized chunks", async () => {
    const jobs: OwnerInferenceJob[] = [];
    const broker = new OwnerNodeBroker({ signingSecret: secret, jobTimeoutMs: 10_000 });
    broker.register({
      nodeId: "node-a",
      tenantId: "tenant-a",
      userId: "owner-a",
      agentIds: ["agent"],
      supportedModelIds: ["model"],
      maxConcurrentJobs: 1,
      send: (job) => jobs.push(job)
    });
    broker.register({
      nodeId: "node-b",
      tenantId: "tenant-b",
      userId: "owner-b",
      agentIds: ["agent"],
      supportedModelIds: ["model"],
      maxConcurrentJobs: 1,
      send: () => {
        throw new Error("Tenant B must not receive Tenant A's prompt.");
      }
    });

    const dispatched = broker.dispatch(request("tenant-a"));
    expect(dispatched.nodeId).toBe("node-a");
    expect(jobs).toHaveLength(1);
    const job = jobs[0]!;
    broker.acceptChunk({
      nodeId: "node-a",
      userId: "owner-a",
      jobToken: job.jobToken,
      sequence: 0,
      chunk: {
        requestId: "request-1",
        text: "Hello",
        done: true,
        runtime: "owner-node",
        modelId: "model"
      }
    });
    const chunks = [];
    for await (const chunk of dispatched.chunks) chunks.push(chunk);
    expect(chunks.map((chunk) => chunk.text)).toEqual(["Hello"]);
  });

  it("rejects cross-user chunks, replay, duplicate requests, and unknown tenants", () => {
    const jobs: OwnerInferenceJob[] = [];
    const broker = new OwnerNodeBroker({ signingSecret: secret, jobTimeoutMs: 10_000 });
    broker.register({
      nodeId: "node-a",
      tenantId: "tenant-a",
      userId: "owner-a",
      agentIds: ["agent"],
      supportedModelIds: ["model"],
      maxConcurrentJobs: 2,
      send: (job) => jobs.push(job)
    });
    broker.dispatch(request("tenant-a"));
    const job = jobs[0]!;
    const chunk = {
      requestId: "request-1",
      text: "Hello",
      done: false,
      runtime: "owner-node" as const,
      modelId: "model"
    };
    expect(() =>
      broker.acceptChunk({
        nodeId: "node-a",
        userId: "owner-b",
        jobToken: job.jobToken,
        sequence: 0,
        chunk
      })
    ).toThrow("forbidden");
    broker.acceptChunk({
      nodeId: "node-a",
      userId: "owner-a",
      jobToken: job.jobToken,
      sequence: 0,
      chunk
    });
    expect(() =>
      broker.acceptChunk({
        nodeId: "node-a",
        userId: "owner-a",
        jobToken: job.jobToken,
        sequence: 0,
        chunk
      })
    ).toThrow("Replayed");
    expect(() => broker.dispatch(request("tenant-a"))).toThrow("Duplicate");
    expect(() => broker.dispatch(request("tenant-c", "request-2"))).toThrow("offline");
  });

  it("fails an in-flight stream when the owner device disconnects or stops responding", async () => {
    const jobs: OwnerInferenceJob[] = [];
    const disconnectingBroker = new OwnerNodeBroker({
      signingSecret: secret,
      jobTimeoutMs: 10_000
    });
    disconnectingBroker.register({
      nodeId: "node-a",
      tenantId: "tenant-a",
      userId: "owner-a",
      agentIds: ["agent"],
      supportedModelIds: ["model"],
      maxConcurrentJobs: 1,
      send: (job) => jobs.push(job)
    });
    const disconnected = disconnectingBroker.dispatch(request("tenant-a"));
    disconnectingBroker.unregister("node-a", "owner-a");
    await expect(collect(disconnected.chunks)).rejects.toThrow("disconnected");

    const timingOutBroker = new OwnerNodeBroker({
      signingSecret: secret,
      jobTimeoutMs: 5
    });
    timingOutBroker.register({
      nodeId: "node-b",
      tenantId: "tenant-a",
      userId: "owner-a",
      agentIds: ["agent"],
      supportedModelIds: ["model"],
      maxConcurrentJobs: 1,
      send: () => {}
    });
    const timedOut = timingOutBroker.dispatch(request("tenant-a", "request-timeout"));
    await expect(collect(timedOut.chunks)).rejects.toThrow("timed out");
  });
});

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const value of values) collected.push(value);
  return collected;
}
