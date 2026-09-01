import { readFileSync, readdirSync } from "node:fs";
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
});
