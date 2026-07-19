/* global crossOriginIsolated, localStorage, navigator, performance, URL, URLSearchParams, window */

import { chromium, devices } from "@playwright/test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const options = parseOptions(process.argv.slice(2));
const device = deviceProfile(options.profile);
const userDataDirectory =
  options.userDataDirectory ?? (await mkdtemp(join(tmpdir(), "soko-browser-inference-")));
const context = await chromium.launchPersistentContext(userDataDirectory, {
  channel: "chrome",
  headless: options.headless,
  ...device.playwright,
  args: [
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan,UseSkiaRenderer",
    "--use-angle=swiftshader"
  ]
});

await context.addInitScript(
  ({ deviceMemoryGb, logicalProcessors }) => {
    Object.defineProperty(navigator, "deviceMemory", {
      configurable: true,
      get: () => deviceMemoryGb
    });
    Object.defineProperty(navigator, "hardwareConcurrency", {
      configurable: true,
      get: () => logicalProcessors
    });
    window.__sokoBrowserInferenceDiagnostics = [];
    window.__sokoCspViolations = [];
    window.addEventListener("soko:browser-inference-diagnostic", (event) => {
      window.__sokoBrowserInferenceDiagnostics.push(event.detail);
    });
    window.addEventListener("securitypolicyviolation", (event) => {
      window.__sokoCspViolations.push({
        blockedURI: event.blockedURI,
        effectiveDirective: event.effectiveDirective,
        violatedDirective: event.violatedDirective
      });
    });
  },
  { deviceMemoryGb: device.memoryGb, logicalProcessors: device.logicalProcessors }
);

const page = context.pages()[0] ?? (await context.newPage());
await installApiMocks(page, options.apiOrigin);
const failedRequests = [];
const errorResponses = [];
const browserErrors = [];
const modelHosts = new Set();
let transferredBytes = 0;
page.on("requestfailed", (request) => {
  failedRequests.push({
    url: redactUrl(request.url()),
    reason: request.failure()?.errorText ?? "unknown"
  });
});
page.on("console", (message) => {
  if (message.type() === "error" || message.type() === "warning") {
    browserErrors.push({ type: message.type(), text: message.text().slice(0, 1_000) });
  }
});
page.on("pageerror", (error) => {
  browserErrors.push({ type: "pageerror", text: error.message.slice(0, 1_000) });
});
page.on("response", async (response) => {
  const url = new URL(response.url());
  if (response.status() >= 400) {
    errorResponses.push({ status: response.status(), url: redactUrl(response.url()) });
  }
  if (url.hostname.endsWith("huggingface.co") || url.hostname.endsWith("hf.co")) {
    modelHosts.add(url.hostname);
    const contentLength = Number(response.headers()["content-length"] ?? 0);
    if (Number.isFinite(contentLength) && contentLength > 0) transferredBytes += contentLength;
  }
});

const results = [];
try {
  for (const backend of options.backends) {
    results.push(await benchmarkBackend(page, options, device, backend));
  }
} finally {
  await context.close();
}

const report = {
  measuredAt: new Date().toISOString(),
  sourceUrl: options.url,
  profile: options.profile,
  emulatedDevice: true,
  physicalAndroidDevice: false,
  deviceMemoryGb: device.memoryGb,
  logicalProcessors: device.logicalProcessors,
  modelHosts: [...modelHosts].sort(),
  observedTransferBytes: transferredBytes,
  failedRequests,
  errorResponses,
  browserErrors,
  results
};
const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (options.output !== null) await writeFile(options.output, serialized, "utf8");
process.stdout.write(serialized);

async function benchmarkBackend(page, input, profile, backend) {
  const benchmarkQuery = new URLSearchParams({
    browserInferenceBackend: backend,
    browserInferenceMaxNewTokens: String(input.maxNewTokens)
  });
  await page.goto(`${input.url}/settings?${benchmarkQuery}`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000
  });
  const responseHeaders = await page.evaluate(() => ({
    crossOriginIsolated,
    userAgent: navigator.userAgent
  }));
  const beforeLoad = await memorySnapshot(page);
  const toggle = page.getByLabel("Use the browser model on this device");
  await toggle.waitFor({ state: "visible", timeout: 60_000 });
  if (await toggle.isDisabled()) {
    throw new Error("Browser-local inference is disabled or the staging capability probe failed.");
  }
  if (await toggle.isChecked()) {
    await toggle.click({ force: true });
    await page
      .getByText("Browser-local inference is off. Existing native or cloud routing remains.", {
        exact: true
      })
      .waitFor({ state: "visible", timeout: 120_000 });
  }
  const loadStartedAt = Date.now();
  await toggle.click({ force: true });
  let loadError = null;
  try {
    await page.waitForFunction(
      () =>
        window.__sokoBrowserInferenceDiagnostics?.some(
          (item) => item.type === "model-load" && item.outcome !== undefined
        ) === true,
      undefined,
      { timeout: input.loadTimeoutMs }
    );
  } catch (error) {
    loadError = {
      name: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message.split("\n")[0] : String(error)
    };
  }
  const loadWallTimeMs = Date.now() - loadStartedAt;
  const loadDiagnostic = await latestDiagnostic(page, "model-load");
  if (loadError !== null || loadDiagnostic?.outcome !== "ready") {
    return {
      backend,
      profile: profile.name,
      environment: responseHeaders,
      capability: await latestDiagnostic(page, "capability"),
      load: { wallTimeMs: loadWallTimeMs, diagnostic: loadDiagnostic, error: loadError },
      generation: null,
      memory: {
        beforeLoad,
        afterLoad: await memorySnapshot(page),
        afterGeneration: null,
        loadDeltaBytes: null,
        generationDeltaBytes: null
      },
      cspViolations: await page.evaluate(() => window.__sokoCspViolations ?? [])
    };
  }
  const afterLoad = await memorySnapshot(page);
  const capability = await latestDiagnostic(page, "capability");

  await page.goto(`${input.url}/sell?${benchmarkQuery}`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000
  });
  const diagnosticsBeforeGeneration = await diagnosticCount(page, "generation");
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.waitFor({ state: "visible", timeout: 60_000 });
  await composer.fill(input.prompt);
  const generationStartedAt = Date.now();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  let generationError = null;
  try {
    await page.waitForFunction(
      (count) =>
        (window.__sokoBrowserInferenceDiagnostics ?? []).filter(
          (item) => item.type === "generation"
        ).length > count,
      diagnosticsBeforeGeneration,
      { timeout: input.generationTimeoutMs }
    );
  } catch (error) {
    generationError = {
      name: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message.split("\n")[0] : String(error)
    };
  }
  const generationWallTimeMs = Date.now() - generationStartedAt;
  const generationDiagnostic = await latestDiagnostic(page, "generation");
  const afterGeneration = await memorySnapshot(page);
  const cspViolations = await page.evaluate(() => window.__sokoCspViolations ?? []);

  return {
    backend,
    profile: profile.name,
    environment: responseHeaders,
    capability,
    load: { wallTimeMs: loadWallTimeMs, diagnostic: loadDiagnostic, error: null },
    generation: {
      wallTimeMs: generationWallTimeMs,
      diagnostic: generationDiagnostic,
      error: generationError
    },
    memory: {
      beforeLoad,
      afterLoad,
      afterGeneration,
      loadDeltaBytes: memoryDelta(beforeLoad, afterLoad),
      generationDeltaBytes: memoryDelta(afterLoad, afterGeneration)
    },
    cspViolations
  };
}

async function memorySnapshot(page) {
  return page.evaluate(async () => {
    const performanceWithMemory = performance;
    const measure = performance.measureUserAgentSpecificMemory;
    let agentClusterBytes = null;
    if (typeof measure === "function") {
      agentClusterBytes = await Promise.race([
        measure.call(performance).then(
          (result) => result.bytes,
          () => null
        ),
        new Promise((resolve) => window.setTimeout(() => resolve(null), 10_000))
      ]);
    }
    return {
      agentClusterBytes,
      jsHeapUsedBytes: performanceWithMemory.memory?.usedJSHeapSize ?? null,
      jsHeapLimitBytes: performanceWithMemory.memory?.jsHeapSizeLimit ?? null
    };
  });
}

function memoryDelta(before, after) {
  if (before.agentClusterBytes !== null && after.agentClusterBytes !== null) {
    return after.agentClusterBytes - before.agentClusterBytes;
  }
  if (before.jsHeapUsedBytes !== null && after.jsHeapUsedBytes !== null) {
    return after.jsHeapUsedBytes - before.jsHeapUsedBytes;
  }
  return null;
}

async function latestDiagnostic(page, type) {
  return page.evaluate(
    (selectedType) =>
      (window.__sokoBrowserInferenceDiagnostics ?? [])
        .filter((item) => item.type === selectedType)
        .at(-1) ?? null,
    type
  );
}

async function diagnosticCount(page, type) {
  return page.evaluate(
    (selectedType) =>
      (window.__sokoBrowserInferenceDiagnostics ?? []).filter((item) => item.type === selectedType)
        .length,
    type
  );
}

async function installApiMocks(page, apiOrigin) {
  await page.route(`${apiOrigin}/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/session") {
      return json({
        account: { id: "browser-benchmark-account" },
        user: { id: "browser-benchmark-user", displayName: "Benchmark Owner", language: "en" },
        session: { expiresAt: "2099-01-01T00:00:00.000Z" }
      });
    }
    if (path === "/auth/oauth/providers") return json({ providers: [] });
    if (path === "/auth/accounts") return json({ accounts: [] });
    if (path === "/auth/passkeys") return json({ passkeys: [] });
    if (path === "/v1/mcp/tokens") return json({ tokens: [] });
    if (path === "/v1/marketplace-intro") {
      return json({ completedAt: "2026-07-19T00:00:00.000Z" });
    }
    if (path === "/v1/conversations") return json({ conversations: [] });
    if (path === "/v1/e2ee/devices" && request.method() === "POST") {
      return json({ id: "browser-benchmark-device", accountId: "browser-benchmark-account" });
    }
    if (path === "/roles/check") return json({ allowed: true, role: "owner", permission: "*" });
    if (path === "/v1/ai-models") return json({ models: [] });
    if (path.includes("/ai-models/github") || path.includes("/ai-models/huggingface")) {
      return json({ models: [], status: "available", connection: "public", message: null });
    }
    if (path.endsWith("/ai-model")) {
      return json({ modelId: "qwen2.5-0.5b-android" });
    }
    if (path.endsWith("/agent-model")) {
      return json({
        businessId: "browser-benchmark-shop",
        deviceId: "browser-benchmark-device",
        activeModelInstallationId: null,
        preferredExecutionMode: "LOCAL_FIRST",
        fallbackPolicy: "ALLOW_SERVER",
        readinessStatus: "NOT_READY",
        lastSuccessfulInferenceAt: null,
        lastErrorCode: null
      });
    }
    if (path.endsWith("/agent-profile")) {
      return json({
        businessId: "browser-benchmark-shop",
        name: "Soko",
        role: "business assistant",
        instructions: "Answer short shop questions accurately.",
        updatedAt: "2026-07-19T00:00:00.000Z"
      });
    }
    if (path.endsWith("/social-accounts")) return json({ accounts: [] });
    if (path.endsWith("/presence")) return json({ status: "online", typing: false });
    if (path === "/v1/sync/changes") {
      return json({ changes: [], nextCursor: null, hasMore: false });
    }
    if (path.endsWith("/shop-deletion/preview")) return json({}, 404);
    if (path === "/v1/messages") {
      return json({ message: "Benchmark messages remain local." }, 503);
    }
    return json({ message: `Benchmark mock does not provide ${request.method()} ${path}.` }, 404);
  });
  await page.addInitScript(() => {
    localStorage.setItem(
      "soko.chatFirst.activeBusiness",
      JSON.stringify({
        id: "browser-benchmark-shop",
        name: "Benchmark Shop",
        language: "en",
        role: "owner",
        sokoId: "254A99999999"
      })
    );
    localStorage.setItem("soko.chatFirst.mode", "seller");
    localStorage.setItem("soko.market.marketplace-intro.completed.v1", "true");
  });
}

function deviceProfile(name) {
  if (name === "pixel-5") {
    return {
      name,
      memoryGb: 4,
      logicalProcessors: 8,
      playwright: devices["Pixel 5"]
    };
  }
  if (name === "galaxy-s9-plus") {
    return {
      name,
      memoryGb: 4,
      logicalProcessors: 8,
      playwright: devices["Galaxy S9+"]
    };
  }
  if (name === "low-memory-android") {
    return {
      name,
      memoryGb: 2,
      logicalProcessors: 4,
      playwright: {
        ...devices["Pixel 5"],
        viewport: { width: 360, height: 800 },
        userAgent:
          "Mozilla/5.0 (Linux; Android 12; Soko Low Memory Test) AppleWebKit/537.36 Chrome/143.0.0.0 Mobile Safari/537.36"
      }
    };
  }
  return {
    name: "desktop",
    memoryGb: 8,
    logicalProcessors: 8,
    playwright: { viewport: { width: 1440, height: 900 } }
  };
}

function parseOptions(args) {
  const values = new Map(
    args.map((argument) => {
      const [key, ...rest] = argument.replace(/^--/, "").split("=");
      return [key, rest.join("=")];
    })
  );
  return {
    url: (values.get("url") ?? "http://127.0.0.1:5173").replace(/\/$/, ""),
    apiOrigin: (values.get("api-origin") ?? "http://127.0.0.1:4000").replace(/\/$/, ""),
    profile: values.get("profile") ?? "pixel-5",
    backends: (values.get("backends") ?? "webgpu,wasm")
      .split(",")
      .filter((value) => value === "webgpu" || value === "wasm"),
    prompt: values.get("prompt") ?? "In two short sentences, explain how to track shop inventory.",
    output: values.get("output") || null,
    userDataDirectory: values.get("user-data-dir") || null,
    headless: values.get("headed") !== "true",
    loadTimeoutMs: Number(values.get("load-timeout-ms") ?? 900_000),
    generationTimeoutMs: Number(values.get("generation-timeout-ms") ?? 300_000),
    maxNewTokens: Number(values.get("max-new-tokens") ?? 32)
  };
}

function redactUrl(value) {
  const url = new URL(value);
  return `${url.origin}${url.pathname}`;
}
