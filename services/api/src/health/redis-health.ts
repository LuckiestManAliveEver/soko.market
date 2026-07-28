import { connect as connectTcp, type Socket } from "node:net";
import { connect as connectTls } from "node:tls";

export interface RedisHealth {
  [key: string]: unknown;
  status: "ok" | "failed";
  latencyMs: number;
  error?: string;
}

export function createRedisHealthCheck(
  redisUrl: string,
  timeoutMs = 3_000
): () => Promise<RedisHealth> {
  const configuration = parseRedisUrl(redisUrl);
  return async () => {
    const startedAt = Date.now();
    try {
      const socket = await openSocket(configuration, timeoutMs);
      try {
        const commands = [
          ...(configuration.password === ""
            ? []
            : [
                configuration.username === ""
                  ? ["AUTH", configuration.password]
                  : ["AUTH", configuration.username, configuration.password]
              ]),
          ["PING"]
        ];
        for (const command of commands) {
          const response = await sendCommand(socket, command, timeoutMs);
          if (response.startsWith("-")) throw new Error("Redis rejected the health command.");
        }
        return { status: "ok", latencyMs: Date.now() - startedAt };
      } finally {
        socket.destroy();
      }
    } catch (error) {
      return {
        status: "failed",
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : "Redis health check failed."
      };
    }
  };
}

function parseRedisUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new Error("REDIS_URL must use redis:// or rediss://.");
  }
  if (url.hash || url.search) throw new Error("REDIS_URL must not contain a query or fragment.");
  return {
    host: url.hostname,
    port: Number(url.port || (url.protocol === "rediss:" ? 6380 : 6379)),
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    tls: url.protocol === "rediss:"
  };
}

function openSocket(
  configuration: ReturnType<typeof parseRedisUrl>,
  timeoutMs: number
): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const onConnect = () => {
      socket.setTimeout(0);
      resolve(socket);
    };
    const socket = configuration.tls
      ? connectTls(
          {
            host: configuration.host,
            port: configuration.port,
            servername: configuration.host
          },
          onConnect
        )
      : connectTcp({ host: configuration.host, port: configuration.port }, onConnect);
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error("Redis connection timed out.")));
    socket.once("error", reject);
  });
}

function sendCommand(socket: Socket, values: string[], timeoutMs: number): Promise<string> {
  const payload = `*${values.length}\r\n${values
    .map((value) => `$${Buffer.byteLength(value)}\r\n${value}\r\n`)
    .join("")}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Redis command timed out."));
    }, timeoutMs);
    const onData = (chunk: Buffer) => {
      cleanup();
      resolve(chunk.toString("utf8"));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
    };
    socket.once("data", onData);
    socket.once("error", onError);
    socket.write(payload);
  });
}
