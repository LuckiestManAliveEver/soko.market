import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * services/ai-runtime is a standalone Vercel deployment that must load a GGUF artifact and run
 * inference, nothing else (docs/architecture/inference-runtime.md). scripts/check-render-inference-
 * boundaries.mjs enforces the same invariant at build time (`pnpm build:production`); this test
 * keeps the same guarantee visible and fast in the regular test suite, independent of that script.
 */
const importPatterns = [
  /\bimport\s+(?:[^'"()]+?\s+from\s+)?["']([^"']+)["']/g,
  /\bexport\s+(?:[^"']+?\s+from\s+)?["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g
];
const forbiddenImportPatterns = [
  /(^|\/)services\/api(\/|$)/u,
  /(^|\/)apps\/web(\/|$)/u,
  /^(\.\.\/)+api\//u,
  /^(\.\.\/)+web\//u
];

function listCodeFiles(directory: string): string[] {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listCodeFiles(path);
    return entry.isFile() && [".ts", ".tsx", ".js", ".mjs", ".cjs"].includes(extname(entry.name))
      ? [path]
      : [];
  });
}

describe("services/ai-runtime deployment boundary", () => {
  it("declares only the narrow dependency allowlist a Vercel inference host needs", () => {
    const manifest = JSON.parse(readFileSync("services/ai-runtime/package.json", "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      "@soko/shared-types",
      "node-llama-cpp"
    ]);
  });

  it("never imports services/api or apps/web application code", () => {
    const violations: string[] = [];
    for (const root of ["services/ai-runtime/src", "services/ai-runtime/api"]) {
      for (const file of listCodeFiles(root)) {
        const source = readFileSync(file, "utf8");
        for (const pattern of importPatterns) {
          for (const match of source.matchAll(pattern)) {
            const specifier = match[1] ?? "";
            if (forbiddenImportPatterns.some((blocked) => blocked.test(specifier))) {
              violations.push(`${file} imports ${specifier}`);
            }
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("declares an explicit Node 22 engine so Vercel cannot silently pick a different runtime", () => {
    const manifest = JSON.parse(readFileSync("services/ai-runtime/package.json", "utf8")) as {
      engines?: Record<string, string>;
    };
    expect(manifest.engines?.node).toBe(">=22.19.0 <23.0.0");
  });

  it("agrees on the Node major across every version declaration Vercel/Node tooling reads", () => {
    // A prior incident shipped .node-version at 20.19.0 while .nvmrc, both package.json engines
    // fields, render.yaml, and the CI workflows had already moved to 22 - Vercel's build image can
    // read either .nvmrc or .node-version depending on the detector version, so a stale one is a
    // live risk of the exact "current: v24.x" wrong-runtime failure this suite exists to prevent.
    const nvmrc = readFileSync(".nvmrc", "utf8").trim();
    const nodeVersion = readFileSync(".node-version", "utf8").trim();
    const rootManifest = JSON.parse(readFileSync("package.json", "utf8")) as {
      engines?: Record<string, string>;
    };
    const runtimeManifest = JSON.parse(
      readFileSync("services/ai-runtime/package.json", "utf8")
    ) as {
      engines?: Record<string, string>;
    };

    expect(nvmrc).toBe("22.19.0");
    expect(nodeVersion).toBe("22.19.0");
    expect(rootManifest.engines?.node).toBe(">=22.19.0 <23.0.0");
    expect(runtimeManifest.engines?.node).toBe(">=22.19.0 <23.0.0");
  });

  it("requires no static output directory - this is a functions-only inference service", () => {
    // A Vercel project misconfigured with an Output Directory setting fails with "No Output
    // Directory named 'public' found" even though this service has nothing to serve statically.
    // The fix belongs in the Vercel dashboard, but the repository must never grow a fake public/
    // directory to paper over that - assert it never exists and vercel.json never declares one.
    expect(existsSync("services/ai-runtime/public")).toBe(false);
    const vercelConfig = JSON.parse(readFileSync("services/ai-runtime/vercel.json", "utf8")) as {
      outputDirectory?: unknown;
      builds?: unknown;
    };
    expect(vercelConfig.outputDirectory).toBeUndefined();
    expect(vercelConfig.builds).toBeUndefined();
  });

  it("keeps the documented inference/health/ready rewrites wired to Vercel functions", () => {
    const vercelConfig = JSON.parse(readFileSync("services/ai-runtime/vercel.json", "utf8")) as {
      rewrites: Array<{ source: string; destination: string }>;
    };
    const bySource = Object.fromEntries(
      vercelConfig.rewrites.map((rewrite) => [rewrite.source, rewrite.destination])
    );
    expect(bySource["/v1/inference"]).toBe("/api/inference");
    expect(bySource["/health"]).toBe("/api/health");
    expect(bySource["/ready"]).toBe("/api/ready");
    for (const destination of Object.values(bySource)) {
      const handlerPath = join("services/ai-runtime", destination.replace(/^\//, "") + ".ts");
      expect(existsSync(handlerPath)).toBe(true);
    }
  });
});
