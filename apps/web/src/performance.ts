const performanceLoggingEnabled = import.meta.env.DEV && typeof window !== "undefined";

let navigationSequence = 0;
let monitoringStarted = false;

export interface NavigationMeasurement {
  id: string;
  route: string;
}

export function startPerformanceMonitoring(): void {
  if (!performanceLoggingEnabled || monitoringStarted) return;
  monitoringStarted = true;

  if ("PerformanceObserver" in globalThis) {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          logPerformance("long-task", {
            durationMs: round(entry.duration),
            startTimeMs: round(entry.startTime)
          });
        }
      });
      observer.observe({ entryTypes: ["longtask"] });
    } catch {
      // Long-task entries are not available in every development browser.
    }
  }
}

export function startNavigationMeasurement(route: string): NavigationMeasurement | null {
  if (!performanceLoggingEnabled) return null;
  const id = `soko-navigation-${++navigationSequence}`;
  performance.mark(`${id}:click`);
  logPerformance("navigation-click", { route });
  return { id, route };
}

export function markNavigationCommitted(measurement: NavigationMeasurement | null): void {
  if (measurement === null) return;
  performance.mark(`${measurement.id}:route-update`);
  measureAndLog(measurement, "route-update", "click", "route-update");

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      performance.mark(`${measurement.id}:visible`);
      measureAndLog(measurement, "first-visible-render", "click", "visible");
      clearNavigationMarks(measurement.id);
    });
  });
}

export function recordRouteRender(route: string): void {
  if (!performanceLoggingEnabled) return;
  logPerformance("route-render", { route });
}

export function recordComponentRender(
  component: string,
  phase: "mount" | "update" | "nested-update",
  actualDurationMs: number,
  baseDurationMs: number
): void {
  if (!performanceLoggingEnabled) return;
  logPerformance("react-render", {
    component,
    phase,
    actualDurationMs: round(actualDurationMs),
    baseDurationMs: round(baseDurationMs)
  });
}

export function recordApiRequest(
  method: string,
  pathOrUrl: string,
  startedAt: number,
  status: number | "failed"
): void {
  if (!performanceLoggingEnabled) return;
  logPerformance("api-request", {
    method,
    path: safePath(pathOrUrl),
    status,
    durationMs: round(performance.now() - startedAt)
  });
}

export function recordApiCache(path: string, result: "fresh" | "stale" | "deduplicated"): void {
  if (!performanceLoggingEnabled) return;
  logPerformance("api-cache", { path: safePath(path), result });
}

export function recordRuntimeInitialization(
  state: "initializing" | "ready" | "failed" | "reused",
  durationMs?: number
): void {
  if (!performanceLoggingEnabled) return;
  logPerformance("runtime-initialization", {
    state,
    ...(durationMs === undefined ? {} : { durationMs: round(durationMs) })
  });
}

function measureAndLog(
  measurement: NavigationMeasurement,
  event: string,
  start: string,
  end: string
): void {
  const name = `${measurement.id}:${event}`;
  try {
    performance.measure(name, `${measurement.id}:${start}`, `${measurement.id}:${end}`);
    const entry = performance.getEntriesByName(name, "measure").at(-1);
    logPerformance(event, {
      route: measurement.route,
      durationMs: round(entry?.duration ?? 0)
    });
    performance.clearMeasures(name);
  } catch {
    // A development browser can clear marks during hot reload.
  }
}

function clearNavigationMarks(id: string): void {
  performance.clearMarks(`${id}:click`);
  performance.clearMarks(`${id}:route-update`);
  performance.clearMarks(`${id}:visible`);
}

function safePath(pathOrUrl: string): string {
  try {
    const origin =
      typeof globalThis.location === "undefined" ? "http://localhost" : globalThis.location.origin;
    return new URL(pathOrUrl, origin).pathname;
  } catch {
    return pathOrUrl.split("?")[0] ?? pathOrUrl;
  }
}

function logPerformance(event: string, details: Record<string, unknown>): void {
  console.info("[SOKO_PERF]", { event, ...details });
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
