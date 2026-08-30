// Fails the build if production-reachable code still references the private on-device model
// architecture retired by ADR-device-independent-runtime-and-registry-discovery.md: browser-local/
// native-bridge GGUF inference, device-scoped model assignment, and client-submitted inference
// completions. Those names legitimately still appear in historical docs, migrations, and the ADR
// itself - none of those run as part of request-serving production execution, so this checker
// walks the same production scan roots as check-retired-runtime-references.mjs, plus apps/web/src
// and apps/web/dist, since this retirement was primarily frontend-side.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Deliberately exact, unambiguous symbol/type names only - not the bare strings "browser-local" or
// "installed-app", which collide with legitimate English/compound-word text (e.g. a comment
// explaining that connection status is "never inferred from any browser-local[Storage] token", or
// formatters.ts's intentional display-label mapping for historical records that still carry the
// retired ModelExecutionTarget values). Use `"browser-local"`/`"installed-app"` (quoted, as a type
// literal) if a future case genuinely needs the raw string checked instead.
export const retiredDeviceModelReferences = [
  "restoreAccountModelToDevice",
  "restoreCloudModelArtifact",
  "DeviceAgentModelAssignment",
  "browserGgufRuntimeSupported",
  "inspectDeviceModelCapability",
  "rankCatalogModelsForDevice",
  "getSharedAgentModelRuntime",
  "ClientInferenceCompletion",
  "requireReadyClientInferenceCompletion",
  "createClientInferenceModelRoute",
  "getOrCreateDeviceModelScopeId"
];

export const productionScanRoots = [
  "apps/web/src",
  "apps/web/dist",
  "services/api/src",
  "services/api/dist",
  "packages/shared-types/src",
  "packages/shared-types/dist",
  "packages/event-core/src",
  "packages/event-core/dist",
  "packages/tool-core/src",
  "packages/tool-core/dist",
  "packages/sync-core/src",
  "packages/sync-core/dist",
  "packages/business-core/src",
  "packages/business-core/dist"
];

const codeExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);

// account-ai-assets.ts carries a deliberate explanatory comment naming the two removed functions
// (uploadLocalModelToAccount, restoreAccountModelToDevice) so a future reader understands why no
// replacement exists rather than assuming an oversight - allowlisted the same way
// retired-execution-fabric-tables.ts is allowlisted by check-retired-runtime-references.mjs. Its
// compiled .js/.d.ts output is allowlisted too, since the comment survives compilation.
const allowlistedFilePattern = /^apps\/web\/(?:src|dist)\/account-ai-assets\.(?:d\.ts|ts|js)$/u;

export function checkRetiredDeviceModelReferences({
  rootDirectory = process.cwd(),
  scanRoots = productionScanRoots,
  forbiddenReferences = retiredDeviceModelReferences
} = {}) {
  const violations = [];

  for (const scanRoot of scanRoots) {
    const absoluteRoot = resolve(rootDirectory, scanRoot);
    if (!existsSync(absoluteRoot)) continue;

    for (const filePath of listCodeFiles(absoluteRoot)) {
      const relativePath = relative(rootDirectory, filePath).replaceAll("\\", "/");
      if (allowlistedFilePattern.test(relativePath)) continue;

      const source = readFileSync(filePath, "utf8");
      for (const reference of forbiddenReferences) {
        if (source.includes(reference)) {
          violations.push({ file: relativePath, reference });
        }
      }
    }
  }

  return violations;
}

export function formatRetiredDeviceModelViolations(violations) {
  return violations.map(
    (violation) =>
      `Retired private on-device model architecture reference found:\n` +
      `${violation.file} -> ${violation.reference}\n\n` +
      `See docs/adr/ADR-device-independent-runtime-and-registry-discovery.md.\n` +
      `A client device must never need a private model copy to use normal agent chat.`
  );
}

function listCodeFiles(directory) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) return listCodeFiles(entryPath);
    return entry.isFile() && codeExtensions.has(extname(entry.name)) ? [entryPath] : [];
  });
}

const isMainModule =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMainModule) {
  const violations = checkRetiredDeviceModelReferences();
  if (violations.length > 0) {
    console.error(formatRetiredDeviceModelViolations(violations).join("\n\n"));
    process.exit(1);
  }
  console.log(
    "No retired private on-device model architecture references in production application source or output."
  );
}
