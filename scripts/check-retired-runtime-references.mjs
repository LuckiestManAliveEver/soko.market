// Fails the build if production-reachable code (application source or its compiled output)
// still references a table that migration 065 (infra/db/migrations/065_retire_execution_fabric.sql)
// permanently drops. Those tables are legitimately named in migrations, rollbacks, historical
// docs, tests, and the one-shot backfill/verification scripts under services/api/scripts/ - none
// of those run as part of request-serving production execution, so this checker deliberately
// only walks the directories that do: services/api/src, services/api/dist, and the workspace
// packages the API actually ships (the same set check-production-imports.mjs treats as
// production packages).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const retiredRuntimeTables = [
  "cp2_model_preferences",
  "cp2_runtime_hosts",
  "cp2_runtime_model_installations"
];

export const productionScanRoots = [
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

// The one production file allowed to name these strings: it exists solely to declare the
// constant that lets application code (services/api/src/index.ts's startup diagnostic) and tests
// recognize a retired table name, so scripts/check-retired-runtime-references.mjs must not treat
// its own declaration as the forbidden reference it exists to detect. See
// services/api/src/cp2/retired-execution-fabric-tables.ts. Matches both the TypeScript source and
// its compiled dist output (.js and .d.ts, which also has a .ts extname).
const allowlistedFilePattern = /\/cp2\/retired-execution-fabric-tables\.(?:d\.ts|ts|js)$/u;

export function checkRetiredRuntimeReferences({
  rootDirectory = process.cwd(),
  scanRoots = productionScanRoots,
  forbiddenTables = retiredRuntimeTables
} = {}) {
  const violations = [];

  for (const scanRoot of scanRoots) {
    const absoluteRoot = resolve(rootDirectory, scanRoot);
    if (!existsSync(absoluteRoot)) continue;

    for (const filePath of listCodeFiles(absoluteRoot)) {
      const relativePath = relative(rootDirectory, filePath).replaceAll("\\", "/");
      if (allowlistedFilePattern.test(relativePath)) continue;

      const source = readFileSync(filePath, "utf8");
      for (const table of forbiddenTables) {
        if (source.includes(table)) {
          violations.push({ file: relativePath, table });
        }
      }
    }
  }

  return violations;
}

export function formatRetiredRuntimeViolations(violations) {
  return violations.map(
    (violation) =>
      `Retired Execution Fabric runtime reference found:\n` +
      `${violation.file} -> ${violation.table}\n\n` +
      `Migration 065 permanently removes this table.\n` +
      `Production runtime may only use cp2_native_* runtime tables.`
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
  const violations = checkRetiredRuntimeReferences();
  if (violations.length > 0) {
    console.error(formatRetiredRuntimeViolations(violations).join("\n\n"));
    process.exit(1);
  }
  console.log("No retired Execution Fabric references in production application source or output.");
}
