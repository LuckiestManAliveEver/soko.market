import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createInferenceServer } from "../services/ai-runtime/src/http-server";

const servers: ReturnType<typeof createInferenceServer>[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        })
    )
  );
});

async function listen(
  inference: Parameters<typeof createInferenceServer>[0]["inference"],
  authorize: (header: string | null) => boolean = () => true
) {
  const server = createInferenceServer({
    inference,
    authorize,
    health: () => Response.json({ ok: true }),
    ready: () => Response.json({ ready: true }),
    maximumBodyBytes: 32
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("container inference HTTP transport", () => {
  it("rejects unauthenticated requests before reading their body or acquiring a generation slot", async () => {
    let invoked = false;
    const base = await listen(
      () => {
        invoked = true;
        return new Response();
      },
      () => false
    );
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const upload = request(`${base}/v1/inference`, { method: "POST" }, (response) => {
        response.resume();
        resolve(response.statusCode);
        upload.destroy();
      });
      upload.on("error", reject);
      // Send headers, but never complete the body: authentication must still respond.
      upload.write("{");
    });
    expect(status).toBe(401);
    expect(invoked).toBe(false);
  });
  it("routes health/readiness and preserves authentication failures", async () => {
    const base = await listen((incoming) => {
      expect(incoming.headers.get("authorization")).toBe("Bearer invalid");
      return Response.json({ error: { code: "INFERENCE_AUTHENTICATION_FAILED" } }, { status: 401 });
    });
    expect(await (await fetch(`${base}/health`)).json()).toEqual({ ok: true });
    expect(await (await fetch(`${base}/ready`)).json()).toEqual({ ready: true });
    expect((await fetch(`${base}/missing`)).status).toBe(404);
    expect((await fetch(`${base}/v1/inference`)).status).toBe(405);
    const response = await fetch(`${base}/v1/inference`, {
      method: "POST",
      headers: { authorization: "Bearer invalid" },
      body: "{}"
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "INFERENCE_AUTHENTICATION_FAILED" } });
  });

  it("rejects oversized chunked uploads before invoking inference", async () => {
    let invoked = false;
    const base = await listen(() => {
      invoked = true;
      return new Response();
    });
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const upload = request(`${base}/v1/inference`, { method: "POST" }, (response) => {
        response.resume();
        resolve(response.statusCode);
      });
      upload.on("error", reject);
      upload.write("a".repeat(20));
      upload.end("b".repeat(20));
    });
    expect(status).toBe(413);
    expect(invoked).toBe(false);
  });

  it("streams before completion, rejects overlapping generations, and keeps health available", async () => {
    let finish: () => void = () => {};
    const base = await listen(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"type":"status"}\n'));
              finish = () => {
                controller.enqueue(new TextEncoder().encode('{"type":"result"}\n'));
                controller.close();
              };
            }
          }),
          { headers: { "content-type": "application/x-ndjson" } }
        )
    );
    const response = await fetch(`${base}/v1/inference`, { method: "POST", body: "{}" });
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('"status"');
    const busy = await fetch(`${base}/v1/inference`, { method: "POST", body: "{}" });
    expect(busy.status).toBe(503);
    expect(busy.headers.get("retry-after")).toBe("1");
    expect((await fetch(`${base}/health`)).status).toBe(200);
    finish();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('"result"');
    expect((await reader.read()).done).toBe(true);
  });

  it("propagates client disconnect and accepts another generation after cleanup", async () => {
    let resolveAbort: () => void = () => {};
    const aborted = new Promise<void>((resolve) => {
      resolveAbort = resolve;
    });
    let calls = 0;
    const base = await listen((incoming) => {
      if (++calls > 1) return new Response("done");
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("started\n"));
            incoming.signal.addEventListener(
              "abort",
              () => {
                controller.close();
                resolveAbort();
              },
              { once: true }
            );
          }
        })
      );
    });
    const abort = new AbortController();
    const response = await fetch(`${base}/v1/inference`, {
      method: "POST",
      body: "{}",
      signal: abort.signal
    });
    await response.body!.getReader().read();
    abort.abort();
    await aborted;
    const next = await fetch(`${base}/v1/inference`, { method: "POST", body: "{}" });
    expect(await next.text()).toBe("done");
  });
});
