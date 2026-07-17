import { describe, expect, it, vi } from "vitest";
import { buildApi } from "../services/api/src/app";
import { createCp2Store } from "../services/api/src/cp2/store";

describe("API persistence acknowledgement barrier", () => {
  it("waits for mutation persistence before returning success and leaves reads unblocked", async () => {
    const flush = vi.fn().mockResolvedValue(undefined);
    const app = buildApi({
      cp2: { store: createCp2Store() },
      mutationPersistenceFlush: flush
    });

    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    expect(flush).not.toHaveBeenCalled();

    const response = await app.inject({
      method: "POST",
      url: "/auth/otp/request",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ channel: "phone", destination: "+254700000111" })
    });

    expect(response.statusCode).toBe(200);
    expect(flush).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("does not acknowledge a mutation when persistence fails", async () => {
    const app = buildApi({
      cp2: { store: createCp2Store() },
      mutationPersistenceFlush: vi.fn().mockRejectedValue(new Error("database unavailable"))
    });

    const response = await app.inject({
      method: "POST",
      url: "/auth/otp/request",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ channel: "phone", destination: "+254700000222" })
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      statusCode: 500,
      error: "Internal Server Error"
    });
    await app.close();
  });
});
