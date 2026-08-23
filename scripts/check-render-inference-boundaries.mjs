import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";

const apiManifest = JSON.parse(readFileSync("services/api/package.json", "utf8"));
const dependencyNames = Object.keys(apiManifest.dependencies ?? {});
const blockedDependencies = [
  "node-llama-cpp",
  "llama-node",
  "@huggingface/transformers",
  "onnxruntime-node",
  "onnxruntime-web"
];
const blockedImportPatterns = [
  /^@soko\/ai-runtime\/(?:src|local-model|ollama-model)(?:\/|$)/u,
  /(?:^|\/)(?:local-model|ollama-model|browser-model\.worker)(?:\.js)?$/u,
  /(?:llama|gguf).*(?:loader|worker|binding)/iu
];
const importPatterns = [
  /\bimport\s+(?:[^'"()]+?\s+from\s+)?["']([^"']+)["']/g,
  /\bexport\s+(?:[^"']+?\s+from\s+)?["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g
];
const violations = dependencyNames
  .filter((dependency) => blockedDependencies.includes(dependency))
  .map((dependency) => `services/api/package.json depends on ${dependency}`);

for (const root of ["services/api/src", "services/api/dist"]) {
  for (const file of listCodeFiles(root)) {
    const source = readFileSync(file, "utf8");
    if (source.includes("LOCAL_MODEL_")) {
      violations.push(`${relative(process.cwd(), file)} reads Render-local inference settings`);
    }
    for (const pattern of importPatterns) {
      for (const match of source.matchAll(pattern)) {
        const specifier = match[1] ?? "";
        if (blockedImportPatterns.some((blocked) => blocked.test(specifier))) {
          violations.push(`${relative(process.cwd(), file)} imports ${specifier}`);
        }
      }
    }
  }
}

const blueprint = readFileSync("render.yaml", "utf8");
for (const forbidden of [
  "BACKEND_INFERENCE_ENABLED",
  "BACKEND_INFERENCE_BASE_URL",
  "soko-market-inference",
  "services/ai-runtime/Dockerfile",
  "OLLAMA_"
]) {
  if (blueprint.includes(forbidden)) {
    violations.push(
      `Render Blueprint provisions forbidden server-local inference marker ${forbidden}`
    );
  }
}
const apiStart = blueprint.indexOf("name: soko-market-api");
const nextService = blueprint.indexOf("\n  - type:", apiStart);
const apiService = blueprint.slice(apiStart, nextService === -1 ? undefined : nextService);
for (const forbidden of ["LOCAL_MODEL_", "llama.cpp", "ollama", ".gguf"]) {
  if (apiService.toLowerCase().includes(forbidden.toLowerCase())) {
    violations.push(`Render API service contains forbidden local-inference marker ${forbidden}`);
  }
}

if (violations.length > 0) {
  console.error("Render inference boundary violations:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log("Render API contains no local or browser inference runtime imports.");

function listCodeFiles(directory) {
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
