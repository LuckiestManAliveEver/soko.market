// Stamps the compiled API output with the commit and moment it was built from, so a running
// process can prove which source tree it corresponds to (see docs/architecture/
// native-runtime-deployment.md). Render sets RENDER_GIT_COMMIT during the build step; local and
// other CI builds fall back to `git rev-parse HEAD`, and a checkout with neither becomes "local".
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function resolveGitCommitSha() {
  const fromEnv = process.env.RENDER_GIT_COMMIT?.trim();
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "local";
  }
}

const distDirectory = resolve(process.cwd(), "dist");
mkdirSync(distDirectory, { recursive: true });
writeFileSync(
  resolve(distDirectory, "build-manifest.json"),
  JSON.stringify(
    {
      gitCommitSha: resolveGitCommitSha(),
      buildTimestamp: new Date().toISOString(),
      runtimeArchitecture: "native"
    },
    null,
    2
  ) + "\n"
);
