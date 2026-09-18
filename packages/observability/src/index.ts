import { Registry, Histogram, Gauge, collectDefaultMetrics } from "@prometheus-io/client";

export type { Registry } from "@prometheus-io/client";

/**
 * The minimal shape of a `pg.Pool` this package instruments. Structural, not a `pg` import, so
 * this package stays dependency-free of the driver and works with any pool implementing it.
 */
export interface QueryablePool {
  query: (...args: unknown[]) => Promise<unknown>;
  readonly totalCount: number;
  readonly idleCount: number;
  readonly waitingCount: number;
  options?: { max?: number };
}

export interface ModelRequestLabels {
  provider: string;
  model: string;
  executionTarget: string;
}

export interface HttpRequestObservation {
  method: string;
  route: string;
  statusCode: number;
  durationSeconds: number;
}

export interface InstrumentPoolOptions {
  /** Low-cardinality identifier for this pool, e.g. "cp2_primary", "cp2_realtime". */
  poolName: string;
  /** Overrides the pool's own configured max when it isn't reliably readable (e.g. a mock in tests). */
  maxConnections?: number;
}

export interface Metrics {
  readonly registry: Registry;
  readonly contentType: string;
  /** Prometheus text exposition of every metric currently registered. */
  metricsText(): Promise<string>;
  /**
   * Records one HTTP server request's duration. Percentiles (p50/p95/p99) are not computed here -
   * they come from running `histogram_quantile()` over `http_request_duration_seconds_bucket` at
   * query time, which is the standard Prometheus pattern and the only way to aggregate percentiles
   * correctly across multiple instances or scrape windows.
   */
  httpRequestDuration(observation: HttpRequestObservation): void;
  /**
   * Wraps `pool.query` in place (the same object is returned) so every caller already holding a
   * reference to this pool - including call sites that predate this instrumentation - starts
   * reporting query latency for free. Also registers this pool with the shared connection-pool
   * gauges (`pg_pool_total_connections` etc.), sampled live from the pool at scrape time.
   */
  instrumentPgPool<TPool extends QueryablePool>(pool: TPool, options: InstrumentPoolOptions): TPool;
  /**
   * Times an async model-runtime call and observes it into `model_request_duration_seconds`,
   * labeled by outcome ("success" if the call resolved, "error" if it threw). Rethrows whatever
   * `fn` throws after recording it - this never swallows or changes runtime behavior.
   */
  timeModelRequest<T>(labels: ModelRequestLabels, fn: () => Promise<T>): Promise<T>;
}

export interface CreateMetricsOptions {
  /** Attached as the `service` label on every metric in this registry. */
  serviceName: string;
  /**
   * Passed through to prom-client's `collectDefaultMetrics` for event-loop lag sampling
   * resolution (milliseconds). Lower is more precise and slightly more overhead; prom-client's
   * own default is 10.
   */
  eventLoopMonitoringPrecision?: number;
}

const httpDurationBuckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const dbQueryDurationBuckets = [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];
const modelRequestDurationBuckets = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20, 40, 80];

export function createMetrics(options: CreateMetricsOptions): Metrics {
  const registry = new Registry();
  registry.setDefaultLabels({ service: options.serviceName });
  collectDefaultMetrics({
    register: registry,
    eventLoopMonitoringPrecision: options.eventLoopMonitoringPrecision ?? 10
  });

  const httpHistogram = new Histogram({
    name: "http_request_duration_seconds",
    help: "HTTP server request duration in seconds. Derive p50/p95/p99 with histogram_quantile().",
    labelNames: ["method", "route", "status_code"],
    buckets: httpDurationBuckets,
    registers: [registry]
  });

  const dbHistogram = new Histogram({
    name: "pg_query_duration_seconds",
    help: "Postgres (Neon) query round-trip duration in seconds, as observed by the pool.",
    labelNames: ["pool", "operation", "outcome"],
    buckets: dbQueryDurationBuckets,
    registers: [registry]
  });

  const modelHistogram = new Histogram({
    name: "model_request_duration_seconds",
    help: "Model runtime request duration in seconds.",
    labelNames: ["provider", "model", "execution_target", "outcome"],
    buckets: modelRequestDurationBuckets,
    registers: [registry]
  });

  const instrumentedPools = new Map<
    string,
    { pool: QueryablePool; maxConnections: number | null }
  >();

  new Gauge({
    name: "pg_pool_total_connections",
    help: "Connections currently held by the pool (idle + active).",
    labelNames: ["pool"],
    registers: [registry],
    collect(this: Gauge<"pool">) {
      for (const [poolName, entry] of instrumentedPools) {
        this.set({ pool: poolName }, entry.pool.totalCount);
      }
    }
  });

  new Gauge({
    name: "pg_pool_idle_connections",
    help: "Idle (not currently checked out) connections held by the pool.",
    labelNames: ["pool"],
    registers: [registry],
    collect(this: Gauge<"pool">) {
      for (const [poolName, entry] of instrumentedPools) {
        this.set({ pool: poolName }, entry.pool.idleCount);
      }
    }
  });

  new Gauge({
    name: "pg_pool_waiting_requests",
    help: "Queries currently waiting for a free connection.",
    labelNames: ["pool"],
    registers: [registry],
    collect(this: Gauge<"pool">) {
      for (const [poolName, entry] of instrumentedPools) {
        this.set({ pool: poolName }, entry.pool.waitingCount);
      }
    }
  });

  new Gauge({
    name: "pg_pool_max_connections",
    help: "Configured maximum size of the pool. Compare against pg_pool_total_connections for saturation.",
    labelNames: ["pool"],
    registers: [registry],
    collect(this: Gauge<"pool">) {
      for (const [poolName, entry] of instrumentedPools) {
        if (entry.maxConnections !== null) this.set({ pool: poolName }, entry.maxConnections);
      }
    }
  });

  return {
    registry,
    contentType: registry.contentType,
    metricsText: () => registry.metrics(),

    httpRequestDuration({ method, route, statusCode, durationSeconds }) {
      httpHistogram.observe(
        { method, route, status_code: String(statusCode) },
        Math.max(0, durationSeconds)
      );
    },

    instrumentPgPool(pool, { poolName, maxConnections }) {
      instrumentedPools.set(poolName, {
        pool,
        maxConnections: maxConnections ?? pool.options?.max ?? null
      });

      const originalQuery = pool.query.bind(pool);
      pool.query = ((...args: unknown[]) => {
        const operation = inferSqlOperation(args[0]);
        const startedAtNs = process.hrtime.bigint();
        const observe = (outcome: "success" | "error") => {
          const elapsedSeconds = Number(process.hrtime.bigint() - startedAtNs) / 1e9;
          dbHistogram.observe({ pool: poolName, operation, outcome }, elapsedSeconds);
        };
        return originalQuery(...args).then(
          (value) => {
            observe("success");
            return value;
          },
          (error: unknown) => {
            observe("error");
            throw error;
          }
        );
      }) as QueryablePool["query"];

      return pool;
    },

    async timeModelRequest(labels, fn) {
      const startedAtNs = process.hrtime.bigint();
      const observationLabels = {
        provider: labels.provider,
        model: labels.model,
        execution_target: labels.executionTarget
      };
      try {
        const result = await fn();
        modelHistogram.observe(
          { ...observationLabels, outcome: "success" },
          Number(process.hrtime.bigint() - startedAtNs) / 1e9
        );
        return result;
      } catch (error) {
        modelHistogram.observe(
          { ...observationLabels, outcome: "error" },
          Number(process.hrtime.bigint() - startedAtNs) / 1e9
        );
        throw error;
      }
    }
  };
}

function inferSqlOperation(query: unknown): string {
  const text = typeof query === "string" ? query : (query as { text?: string } | undefined)?.text;
  if (typeof text !== "string") return "unknown";
  const match = /^\s*(\w+)/.exec(text);
  return match?.[1]?.toLowerCase() ?? "unknown";
}
