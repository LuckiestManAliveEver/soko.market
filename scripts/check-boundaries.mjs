import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const businessCoreRoot = "packages/business-core/src";
const forbiddenPatterns = [
  "@soko/ai-runtime",
  "services/ai-runtime",
  "llama",
  "openclaw",
  "sokoclaw"
];

async function listSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? listSourceFiles(path) : path;
    })
  );

  return files.flat().filter((path) => path.endsWith(".ts") || path.endsWith(".tsx"));
}

const violations = [];

for (const file of await listSourceFiles(businessCoreRoot)) {
  const contents = await readFile(file, "utf8");

  for (const pattern of forbiddenPatterns) {
    if (contents.toLowerCase().includes(pattern.toLowerCase())) {
      violations.push(`${file}: forbidden business-core dependency on ${pattern}`);
    }
  }
}

async function read(path) {
  return readFile(path, "utf8");
}

function countMatches(contents, pattern) {
  return [...contents.matchAll(pattern)].length;
}

const chatRuntimePath = "apps/web/src/hooks/useChatRuntimeState.ts";
const chatRuntime = await read(chatRuntimePath);
for (const forbidden of [
  "setProductForm",
  "setCustomerForm",
  "setInvoiceForm",
  "setInvoicePreview",
  "setPaymentForm",
  "requestNetworkRoute",
  "loadNetworkGraph",
  "isNetworkDiscoveryRequest"
]) {
  if (chatRuntime.includes(forbidden)) {
    violations.push(`${chatRuntimePath}: Chat must invoke capabilities instead of ${forbidden}`);
  }
}
if (/from\s+["'][^"']*(?:Product|Customer|Invoice|Payment|Supplier)[^"']*["']/u.test(chatRuntime)) {
  violations.push(`${chatRuntimePath}: Chat imports a domain UI implementation`);
}

for (const file of await listSourceFiles("apps/web/src/hooks")) {
  const contents = await read(file);
  if (/from\s+["']\.\/use[A-Z][^"']*["']/u.test(contents)) {
    violations.push(`${file}: domain hook imports a sibling hook's private implementation`);
  }
}

for (const file of await listSourceFiles("packages/tool-core/src")) {
  const contents = await read(file);
  if (/apps\/web|from\s+["']react(?:\/|["'])/u.test(contents)) {
    violations.push(`${file}: tool-core imports frontend code`);
  }
}

const apiFiles = await listSourceFiles("services/api/src");
const legacySiblingDomainImportAllowlist = new Set([
  "services/api/src/cp2/domains/agent-runtime/domain-deps.ts",
  "services/api/src/cp2/domains/execution-fabric/runtime-route.ts"
]);
for (const file of apiFiles.filter((candidate) => candidate.includes("/cp2/domains/"))) {
  const contents = await read(file);
  if (
    /from\s+["']\.\.\/((?!\.)[^/"']+)\/(store|shared)\.js["']/u.test(contents) &&
    !legacySiblingDomainImportAllowlist.has(file)
  ) {
    violations.push(`${file}: new deep import of sibling domain private internals`);
  }
}

// Native runtime bindings are the production selection architecture. These are the only legacy
// imports allowed to reach the Fabric during its temporary rollback window.
const fabricImportAllowlist = new Set([
  "apps/web/src/hooks/useChatRuntimeState.ts",
  "services/api/src/cp2/domains/agent-runtime/domain-deps.ts",
  "services/api/src/cp2/domains/agent-runtime/store.ts",
  "services/api/src/cp2/store.ts"
]);
for (const file of [...apiFiles, ...(await listSourceFiles("apps/web/src"))]) {
  if (file.includes("/execution-fabric/")) continue;
  const contents = await read(file);
  if (
    /(?:from|import\s*)\s*(?:\([^)]*)?["'][^"']*execution-fabric[^"']*["']/u.test(contents) &&
    !fabricImportAllowlist.has(file)
  ) {
    violations.push(`${file}: new production dependency on legacy Execution Fabric`);
  }
}

let runtimeTurnImplementations = 0;
for (const file of apiFiles) {
  const contents = await read(file);
  runtimeTurnImplementations += countMatches(contents, /async\s+createRuntimeTurn\s*\(/gu);
}
if (runtimeTurnImplementations !== 1) {
  violations.push(
    `services/api/src: expected one createRuntimeTurn implementation, found ${runtimeTurnImplementations}`
  );
}

const toolCoreFiles = await listSourceFiles("packages/tool-core/src");
let registryDeclarations = 0;
for (const file of toolCoreFiles) {
  registryDeclarations += countMatches(await read(file), /export const runtimeToolRegistry\b/gu);
}
if (registryDeclarations !== 1) {
  violations.push(
    `packages/tool-core/src: expected one runtimeToolRegistry, found ${registryDeclarations}`
  );
}

const mcpRoutes = await read("services/api/src/mcp/routes.ts");
if (!mcpRoutes.includes("store.createRuntimeTurnForMcp({")) {
  violations.push(
    "services/api/src/mcp/routes.ts: MCP must reuse the principal-aware runtime turn"
  );
}
if (
  /\.(?:createProduct|updateProduct|deleteProduct|createCustomer|recordPayment)\s*\(/u.test(
    mcpRoutes
  )
) {
  violations.push("services/api/src/mcp/routes.ts: MCP bypasses the canonical runtime turn");
}

const capabilityDispatcher = await read(
  "services/api/src/cp2/domains/agent-runtime/capabilities.ts"
);
if (capabilityDispatcher.includes("requireAuthorizedSession(")) {
  violations.push(
    "agent-runtime/capabilities.ts: capability dispatcher must not duplicate authorization"
  );
}
const capabilityCallers = apiFiles.filter(
  (file) => file !== "services/api/src/cp2/domains/agent-runtime/capabilities.ts"
);
for (const file of capabilityCallers) {
  const contents = await read(file);
  if (contents.includes("executeRuntimeCapability(") && !file.endsWith("agent-runtime/store.ts")) {
    violations.push(`${file}: business capability execution bypasses the canonical runtime turn`);
  }
}

const lineBudgets = new Map([
  ["packages/tool-core/src/index.ts", 25],
  ["packages/tool-core/src/parsers.ts", 25],
  ["packages/tool-core/src/parsers/merchant-command.ts", 700],
  ["packages/tool-core/src/parsers/product-context.ts", 1150],
  ["packages/tool-core/src/parsers/receipt-context.ts", 350],
  ["packages/tool-core/src/parsers/runtime-proposals.ts", 275],
  ["packages/tool-core/src/registry/index.ts", 50],
  ["apps/web/src/SokoApplication.tsx", 2100],
  ["apps/web/src/OwnerWorkspace.tsx", 800],
  ["apps/web/src/ChatSurface.tsx", 1125],
  ["apps/web/src/ChatComposer.tsx", 375],
  ["apps/web/src/StackedModule.tsx", 180],
  ["apps/web/src/hooks/useChatComposerState.ts", 160],
  ["apps/web/src/hooks/useChatRuntimeState.ts", 1800],
  ["services/api/src/cp2/domains/agent-runtime/store.ts", 3700],
  ["services/api/src/cp2/domains/agent-runtime/domain-deps.ts", 325],
  ["services/api/src/cp2/domains/agent-runtime/runtime-context.ts", 300],
  ["services/api/src/cp2/domains/agent-runtime/runtime-model-routing.ts", 550],
  ["services/api/src/cp2/domains/agent-runtime/shared.ts", 1700],
  ["services/api/src/cp2/domains/agent-runtime/routes.ts", 1650],
  ["services/api/src/cp2/domains/agent-runtime/capabilities.ts", 525]
]);
for (const [file, maximum] of lineBudgets) {
  const lines = (await read(file)).split("\n").length;
  if (lines > maximum)
    violations.push(`${file}: ${lines} lines exceeds modularity budget ${maximum}`);
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}

console.log("Boundary check passed.");
