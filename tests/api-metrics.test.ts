import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createMetrics } from "../packages/observability/src/index";
import { buildApi } from "../services/api/src/app";

describe("api metrics", () => {
  it("does not register /metrics when no registry is supplied", async () => {
    const app = buildApi();
    const response = await app.inject({ method: "GET", url: "/metrics" });

    expect(response.statusCode).toBe(404);

    await app.close();
  });

  it("serves Prometheus exposition text and records this service's own HTTP requests", async () => {
    const metrics = createMetrics({ serviceName: "api" });
    const app = buildApi({ metrics });

    await app.inject({ method: "GET", url: "/health" });
    const response = await app.inject({ method: "GET", url: "/metrics" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.body).toContain("process_resident_memory_bytes");
    expect(response.body).toContain("nodejs_eventloop_lag_seconds");
    expect(response.body).toContain("http_request_duration_seconds_bucket");
    expect(response.body).toMatch(/route="\/health"/);
    expect(response.body).toMatch(/method="GET"/);

    await app.close();
  });

  it("rejects an unauthenticated scrape when a metrics token is configured", async () => {
    const metrics = createMetrics({ serviceName: "api" });
    const app = buildApi({ metrics, metricsAuthToken: "a".repeat(32) });

    const unauthenticated = await app.inject({ method: "GET", url: "/metrics" });
    expect(unauthenticated.statusCode).toBe(401);

    const wrongToken = await app.inject({
      method: "GET",
      url: "/metrics",
      headers: { "x-metrics-token": "wrong" }
    });
    expect(wrongToken.statusCode).toBe(401);

    const authenticated = await app.inject({
      method: "GET",
      url: "/metrics",
      headers: { "x-metrics-token": "a".repeat(32) }
    });
    expect(authenticated.statusCode).toBe(200);
    expect(authenticated.body).toContain("process_resident_memory_bytes");

    await app.close();
  });

  it("registers /metrics on the rate limiter's allowList alongside /health", async () => {
    // @fastify/rate-limit's allowList callback isn't observably testable through .inject() (it
    // never actually blocks under inject in this stack, for /health either - there's no existing
    // test anywhere in this repo that trips the limiter via inject), so this pins the source
    // predicate directly instead of asserting on behavior inject can't exercise.
    const appSource = await readFile(
      new URL("../services/api/src/app.ts", import.meta.url),
      "utf8"
    );
    expect(appSource).toContain(
      'allowList: (request) => request.url.startsWith("/health") || request.url === "/metrics"'
    );
  });
});
