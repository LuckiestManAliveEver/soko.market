import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

const roots = [
  "packages/shared-types/dist",
  "packages/event-core/dist",
  "packages/tool-core/dist",
  "packages/sync-core/dist",
  "packages/business-core/dist",
  "services/ai-runtime/dist",
  "services/api/dist"
];
const packageManifests = [
  "packages/shared-types/package.json",
  "packages/event-core/package.json",
  "packages/tool-core/package.json",
  "packages/sync-core/package.json",
  "packages/business-core/package.json",
  "services/ai-runtime/package.json"
];
const importPatterns = [
  /\bimport\s+(?:[^'"()]+?\s+from\s+)?["']([^"']+)["']/g,
  /\bexport\s+(?:[^"']+?\s+from\s+)?["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g
];
const blockedSpecifiers = [
  /(?<!\.d)\.tsx?$/u,
  /\/src\//u,
  /^@soko\/ai-runtime\/src(?:\/|$)/u,
  /ai-runtime\/src/u
];
const violations = [];

for (const manifestPath of packageManifests) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const specifiers = collectManifestSpecifiers(manifest.exports);

  for (const fieldName of ["main", "types"]) {
    if (typeof manifest[fieldName] === "string") {
      specifiers.push(manifest[fieldName]);
    }
  }

  for (const specifier of specifiers) {
    if (blockedSpecifiers.some((blockedSpecifier) => blockedSpecifier.test(specifier))) {
      violations.push(`${manifestPath} exposes ${specifier}`);
    }
  }
}

for (const root of roots) {
  if (!existsSync(root)) {
    violations.push(`${root}: build output is missing`);
    continue;
  }

  for (const filePath of listJavaScriptFiles(root)) {
    const source = readFileSync(filePath, "utf8");

    for (const pattern of importPatterns) {
      for (const match of source.matchAll(pattern)) {
        const specifier = match[1] ?? "";

        if (blockedSpecifiers.some((blockedSpecifier) => blockedSpecifier.test(specifier))) {
          violations.push(`${relative(process.cwd(), filePath)} imports ${specifier}`);
        }
      }
    }
  }
}

if (violations.length > 0) {
  console.error("Production build contains invalid runtime imports:");

  for (const violation of violations) {
    console.error(`- ${violation}`);
  }

  process.exit(1);
}

console.log("Production build imports are clean.");

function listJavaScriptFiles(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listJavaScriptFiles(entryPath));
      continue;
    }

    if (entry.isFile() && [".js", ".mjs", ".cjs"].includes(extname(entry.name))) {
      files.push(entryPath);
    }
  }

  return files;
}

function collectManifestSpecifiers(value) {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectManifestSpecifiers(item));
  }

  if (value !== null && typeof value === "object") {
    return Object.values(value).flatMap((item) => collectManifestSpecifiers(item));
  }

  return [];
}
