import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

type Handler = (request: Request) => Response | Promise<Response>;

/** HTTP transport for the existing inference protocol on container hosts. */
export function createInferenceServer(options: {
  inference: Handler;
  authorize: (header: string | null) => boolean;
  health: () => Response;
  ready: () => Response;
  maximumBodyBytes: number;
}) {
  // One generation at a time keeps native contexts within the container's memory budget and
  // prevents the model cache from evicting a model while another request is using it.
  let busy = false;
  const server = createServer((incoming, outgoing) => {
    void handle(incoming, outgoing).catch(() => {
      if (!outgoing.headersSent) outgoing.writeHead(500, { "content-type": "application/json" });
      outgoing.end(JSON.stringify({ error: { code: "INFERENCE_TRANSPORT_FAILED" } }));
    });
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;

  async function handle(incoming: IncomingMessage, outgoing: ServerResponse) {
    const path = incoming.url?.split("?")[0];
    if (path === "/health" || path === "/ready") {
      const response = path === "/health" ? options.health() : options.ready();
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(incoming.method === "HEAD" ? undefined : await response.text());
      return;
    }
    if (path !== "/v1/inference") {
      outgoing.writeHead(404).end();
      return;
    }
    if (incoming.method !== "POST") {
      outgoing.writeHead(405, { allow: "POST" }).end();
      return;
    }
    if (!options.authorize(incoming.headers.authorization ?? null)) {
      outgoing.writeHead(401, { "content-type": "application/json", connection: "close" });
      outgoing.end(
        JSON.stringify({ error: { code: "INFERENCE_AUTHENTICATION_FAILED", retryable: false } })
      );
      return;
    }
    if (busy) {
      outgoing.writeHead(503, { "content-type": "application/json", "retry-after": "1" });
      outgoing.end(JSON.stringify({ error: { code: "INFERENCE_BUSY", retryable: true } }));
      return;
    }
    busy = true;
    const abort = new AbortController();
    const disconnected = () => {
      if (!outgoing.writableFinished) abort.abort();
    };
    outgoing.on("close", disconnected);
    try {
      const chunks: Buffer[] = [];
      let bytes = 0;
      // Bound chunked requests as well as requests declaring Content-Length. Keeping the
      // input stream alive on early return allows Node to deliver the 413 response.
      for await (const chunk of incoming.iterator({ destroyOnReturn: false })) {
        const buffer = Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > options.maximumBodyBytes) {
          outgoing.writeHead(413, { connection: "close" }).end();
          return;
        }
        chunks.push(buffer);
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      }
      const response = await options.inference(
        new Request("http://localhost/v1/inference", {
          method: "POST",
          headers,
          body: Buffer.concat(chunks),
          signal: abort.signal
        })
      );
      if (!outgoing.destroyed) {
        outgoing.writeHead(response.status, Object.fromEntries(response.headers));
        outgoing.flushHeaders();
      }
      // Drain the handler even after disconnect: it observes the abort signal and finishes
      // cleanup before the next generation can acquire the model cache.
      if (response.body !== null) {
        const reader = response.body.getReader();
        try {
          for (;;) {
            const { done, value: chunk } = await reader.read();
            if (done) break;
            if (outgoing.destroyed) continue;
            if (!outgoing.write(chunk)) {
              await new Promise<void>((resolve) => {
                const done = () => {
                  outgoing.off("drain", done);
                  outgoing.off("close", done);
                  resolve();
                };
                outgoing.once("drain", done);
                outgoing.once("close", done);
              });
            }
          }
        } finally {
          reader.releaseLock();
        }
      }
      outgoing.end();
    } finally {
      outgoing.off("close", disconnected);
      busy = false;
    }
  }

  return server;
}
