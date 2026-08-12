import Redis from "ioredis";

// Backs @fastify/rate-limit so request counters survive process restarts and are shared
// across API instances, instead of living only in this process's memory. The rate-limit
// plugin is registered with `skipOnError: true`, so if this connection is ever down,
// requests are still served (rate limiting is skipped, not fatal to the API) - but that only
// helps once a command actually fails. ioredis's defaults (10s connectTimeout, and queueing
// commands issued while disconnected instead of rejecting them) meant every request could sit
// waiting on a connection attempt for up to 10 seconds before skipOnError ever got a chance to
// run, which was enough to make login and session refresh look completely stuck. Both are
// tightened here so a down Redis fails a command in milliseconds, not seconds.
export function createRateLimitRedisClient(url: string): Redis {
  const client = new Redis(url, {
    maxRetriesPerRequest: 1,
    connectTimeout: 1_000,
    enableOfflineQueue: false,
    retryStrategy: (attempt) => Math.min(attempt * 200, 5_000)
  });

  let loggedConnectionError = false;
  client.on("error", (error) => {
    if (loggedConnectionError) return;
    loggedConnectionError = true;
    console.error(
      JSON.stringify({
        event: "rate_limit_redis_connection_error",
        message: error instanceof Error ? error.message : String(error)
      })
    );
  });
  client.on("connect", () => {
    loggedConnectionError = false;
  });

  return client;
}
