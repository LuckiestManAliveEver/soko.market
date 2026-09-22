import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { PlaywrightComputerRuntime } from "../services/computer-runtime/src/playwright-runtime";

const runtimes: PlaywrightComputerRuntime[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.shutdown()));
});

describe("computer runtime browser integration", () => {
  it("creates Chromium, navigates, observes, clicks, and resumes after human takeover", async () => {
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "text/html");
      response.end(
        "<!doctype html><title>Product</title><button id='price' onclick=\"document.body.dataset.clicked='yes'\">Maize: KSh 3,000</button>"
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("test server unavailable");

    const runtime = new PlaywrightComputerRuntime();
    runtimes.push(runtime);
    try {
      const session = await runtime.createSession({
        accountId: "account-a",
        businessId: "business-a",
        conversationId: "conversation-a",
        profileId: null,
        executionHostId: "browser-computer",
        runtimeInstanceId: "conversation-a",
        policy: {
          allowedDomains: ["127.0.0.1"],
          blockedDomains: [],
          allowHttp: true,
          allowPrivateNetworks: true,
          allowDownloads: false,
          allowUploads: false
        }
      });
      const observation = await runtime.navigate({
        id: "navigate",
        sessionId: session.id,
        kind: "navigate",
        target: { url: `http://127.0.0.1:${address.port}` },
        risk: "READ"
      });
      expect(observation).toMatchObject({ title: "Product", untrustedContent: true });
      expect(observation.text).toContain("KSh 3,000");
      expect(runtime.takeControl(session.id).controlMode).toBe("HUMAN_CONTROLLED");
      await expect(
        runtime.act(
          {
            id: "agent-click",
            sessionId: session.id,
            kind: "click",
            target: { selector: "#price" },
            risk: "MUTATE"
          },
          "agent"
        )
      ).rejects.toThrow("AGENT_CONTROL_REJECTED");
      await runtime.act(
        {
          id: "human-click",
          sessionId: session.id,
          kind: "click",
          target: { selector: "#price" },
          risk: "MUTATE"
        },
        "human"
      );
      const released = await runtime.releaseControl(session.id);
      expect(released.session.controlMode).toBe("AGENT_CONTROLLED");
      expect(released.observation.text).toContain("Maize");
      runtime.suspend(session.id);
      expect(runtime.session(session.id)).toMatchObject({
        controlMode: "SUSPENDED",
        status: "SUSPENDED"
      });
      const resumed = await runtime.resume(session.id);
      expect(resumed.session).toMatchObject({
        controlMode: "AGENT_CONTROLLED",
        status: "RUNNING"
      });
      expect(resumed.observation.text).toContain("Maize");
      expect((await runtime.frame(session.id)).byteLength).toBeGreaterThan(100);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  }, 30_000);
});
