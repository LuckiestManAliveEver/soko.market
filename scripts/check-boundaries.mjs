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

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}

console.log("Boundary check passed.");
