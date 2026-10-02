import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The web app, its dev Content-Security-Policy, the API, and the local doctor must all agree on
// one development API port. fcd42a3 moved the API default to 3001 while the web app kept calling
// 4000, so local sign-in failed with a network error. Every declaration below must stay in sync.
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const devApiPort = "4000";

function captured(source: string, pattern: RegExp, label: string): string {
  const match = pattern.exec(source);
  if (!match?.[1]) throw new Error(`${label}: dev API port declaration not found`);
  return match[1];
}

describe("local development API port", () => {
  it.each([
    ["web api client default", "apps/web/src/lib/api.ts", /return "http:\/\/127\.0\.0\.1:(\d+)";/u],
    ["web dev CSP connect-src", "apps/web/vite.config.ts", /connect-src 'self' http:\/\/127\.0\.0\.1:(\d+)/u],
    ["api config default", "services/api/src/config.ts", /\["API_PORT", "PORT"\], (\d+)\)/u],
    ["local doctor default", "scripts/local-doctor.mjs", /env\.API_PORT \|\| env\.PORT \|\| (\d+)\)/u],
    ["local env template", ".env.local.example", /^API_PORT=(\d+)$/mu],
    ["env template", ".env.example", /^API_PORT=(\d+)$/mu]
  ])("%s uses the shared dev API port", (label, path, pattern) => {
    expect(captured(read(path), pattern, label)).toBe(devApiPort);
  });
});
