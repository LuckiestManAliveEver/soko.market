import { describe, expect, it } from "vitest";
import { buildApi } from "../services/api/src/app";

describe("api health", () => {
  it("returns API metadata from the public root instead of a route-not-found error", async () => {
    const app = buildApi();
    const response = await app.inject({ method: "GET", url: "/" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      service: "api",
      status: "ok",
      health: "/health",
      liveness: "/health/live",
      readiness: "/health/ready"
    });

    await app.close();
  });

  it("returns an ok health response", async () => {
    const app = buildApi();
    const response = await app.inject({
      method: "GET",
      url: "/health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      service: "api",
      status: "ok"
    });

    await app.close();
  });

  it("reports lightweight readiness separately from inference diagnostics", async () => {
    const diagnosticCalls: boolean[] = [];
    const app = buildApi({
      agentRuntimeDiagnostic: async (runInference) => {
        diagnosticCalls.push(runInference);
        return {
          provider: "ollama",
          status: "ready",
          model: "qwen2.5:0.5b",
          modelAvailable: true,
          inferenceAvailable: runInference ? true : null,
          errorCode: null,
          checkedAt: new Date().toISOString()
        };
      }
    });

    const readiness = await app.inject({ method: "GET", url: "/health/ready" });
    const inference = await app.inject({ method: "GET", url: "/health/ai" });

    expect(readiness.statusCode).toBe(200);
    expect(readiness.json()).toMatchObject({
      status: "ready",
      dispatch: { mode: "synchronous" },
      model: {
        provider: "ollama",
        model: "qwen2.5:0.5b",
        modelAvailable: true,
        inferenceAvailable: null
      }
    });
    expect(inference.statusCode).toBe(200);
    expect(inference.json()).toMatchObject({
      status: "ready",
      model: {
        inferenceAvailable: true
      }
    });
    expect(diagnosticCalls).toEqual([false, true]);

    await app.close();
  });
});
