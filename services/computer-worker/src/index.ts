/**
 * Isolated computer-use worker HTTP server (docs/architecture/computer-runtime.md). Deployed as
 * its own process/container (render.yaml's soko-market-computer-worker `pserv`), reachable only
 * from services/api over the private network - never exposed publicly, never given direct
 * internet-facing traffic. A crash or hang here never takes down the main API process.
 */
import Fastify, { type FastifyReply } from "fastify";
import { BrowserManager, type WorkerCreateSessionInput } from "./browser-manager.js";
import type { ComputerTarget } from "@soko/computer-runtime";

const port = Number(process.env.COMPUTER_WORKER_PORT ?? 8091);
const host = process.env.COMPUTER_WORKER_HOST ?? "0.0.0.0";

const app = Fastify({ logger: true, bodyLimit: 25 * 1024 * 1024 });
const manager = new BrowserManager();

app.get("/health", async () => ({ status: "ok" }));

app.post<{ Body: WorkerCreateSessionInput }>("/sessions", async (request, reply) => {
  try {
    return await manager.createSession(request.body);
  } catch (error) {
    return sendError(reply, error);
  }
});

app.post<{ Params: { sessionId: string } }>(
  "/sessions/:sessionId/resume",
  async (request, reply) => {
    try {
      return await manager.resumeSession(request.params.sessionId);
    } catch (error) {
      return sendError(reply, error);
    }
  }
);

app.post<{ Params: { sessionId: string }; Body: { url: string } }>(
  "/sessions/:sessionId/navigate",
  async (request, reply) => {
    try {
      return await manager.navigate(request.params.sessionId, request.body.url);
    } catch (error) {
      return sendError(reply, error);
    }
  }
);

app.post<{ Params: { sessionId: string } }>(
  "/sessions/:sessionId/observe",
  async (request, reply) => {
    try {
      return await manager.observe(request.params.sessionId);
    } catch (error) {
      return sendError(reply, error);
    }
  }
);

app.post<{ Params: { sessionId: string }; Body: { target: ComputerTarget } }>(
  "/sessions/:sessionId/click",
  async (request, reply) => {
    try {
      return await manager.click(request.params.sessionId, request.body.target);
    } catch (error) {
      return sendError(reply, error);
    }
  }
);

app.post<{
  Params: { sessionId: string };
  Body: { target: ComputerTarget; text: string; submit?: boolean };
}>("/sessions/:sessionId/type", async (request, reply) => {
  try {
    return await manager.type(
      request.params.sessionId,
      request.body.target,
      request.body.text,
      request.body.submit === true
    );
  } catch (error) {
    return sendError(reply, error);
  }
});

app.post<{ Params: { sessionId: string }; Body: { direction: "up" | "down"; amountPx?: number } }>(
  "/sessions/:sessionId/scroll",
  async (request, reply) => {
    try {
      return await manager.scroll(
        request.params.sessionId,
        request.body.direction,
        request.body.amountPx ?? 600
      );
    } catch (error) {
      return sendError(reply, error);
    }
  }
);

app.post<{
  Params: { sessionId: string };
  Body: { target: ComputerTarget; fileName: string; contentType: string; contentBase64: string };
}>("/sessions/:sessionId/upload", async (request, reply) => {
  try {
    return await manager.upload(
      request.params.sessionId,
      request.body.target,
      request.body.fileName,
      request.body.contentType,
      request.body.contentBase64
    );
  } catch (error) {
    return sendError(reply, error);
  }
});

app.post<{ Params: { sessionId: string } }>(
  "/sessions/:sessionId/checkpoint",
  async (request, reply) => {
    try {
      return await manager.checkpoint(request.params.sessionId);
    } catch (error) {
      return sendError(reply, error);
    }
  }
);

app.post<{ Params: { sessionId: string } }>(
  "/sessions/:sessionId/suspend",
  async (request, reply) => {
    try {
      await manager.suspend(request.params.sessionId);
      return { suspended: true };
    } catch (error) {
      return sendError(reply, error);
    }
  }
);

app.post<{ Params: { sessionId: string }; Body: { opaqueState: string | null } }>(
  "/sessions/:sessionId/restore",
  async (request, reply) => {
    try {
      await manager.restore(request.params.sessionId, request.body.opaqueState);
      return { restored: true };
    } catch (error) {
      return sendError(reply, error);
    }
  }
);

app.post<{ Params: { sessionId: string } }>(
  "/sessions/:sessionId/close",
  async (request, reply) => {
    try {
      await manager.close(request.params.sessionId);
      return { closed: true };
    } catch (error) {
      return sendError(reply, error);
    }
  }
);

function sendError(reply: FastifyReply, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  app.log.error(message);
  return reply.code(500).send({ error: message });
}

async function shutdown(): Promise<void> {
  await manager.shutdown();
  await app.close();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

app
  .listen({ port, host })
  .then(() => app.log.info(`computer-worker listening on ${host}:${port}`))
  .catch((error: unknown) => {
    app.log.error(error);
    process.exit(1);
  });
