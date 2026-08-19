import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";

// TypeScript's "Bundler" moduleResolution (this repo's default, see tsconfig.base.json) accepts
// extensionless relative imports at typecheck/build time and copies the specifier through to
// compiled output unchanged. For a "type": "module" package whose compiled dist/ is actually
// loaded by Node's native ESM resolver (not bundled by Vite/esbuild first), an extensionless
// relative import throws ERR_MODULE_NOT_FOUND at runtime - a failure mode invisible to tsc,
// vitest, and tsx, since all three resolve extensionlessly. This check statically requires every
// relative import/export/require specifier in such a package's src/ to carry an explicit
// extension, so the mistake is caught before it ever reaches a real Node process.
const importPatterns = [
  /\bimport\s+(?:[^'"()]+?\s+from\s+)?["']([^"']+)["']/g,
  /\bexport\s+(?:[^"']+?\s+from\s+)?["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g
];
const allowedExtensions = [".js", ".mjs", ".cjs", ".json"];

const violations = [];
for (const workspaceRoot of ["packages", "services"]) {
  if (!existsSync(workspaceRoot)) continue;
  for (const packageDir of readdirSync(workspaceRoot, { withFileTypes: true })) {
    if (!packageDir.isDirectory()) continue;
    const packagePath = join(workspaceRoot, packageDir.name);
    const manifestPath = join(packagePath, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (manifest.type !== "module") continue;

    for (const file of listTypeScriptFiles(join(packagePath, "src"))) {
      const source = readFileSync(file, "utf8");
      for (const pattern of importPatterns) {
        for (const match of source.matchAll(pattern)) {
          const specifier = match[1] ?? "";
          if (!specifier.startsWith("./") && !specifier.startsWith("../")) continue;
          if (allowedExtensions.includes(extname(specifier))) continue;
          violations.push(
            `${relative(process.cwd(), file)} imports "${specifier}" without an extension`
          );
        }
      }
    }
  }
}

if (violations.length > 0) {
  console.error("ESM relative-import extension violations:");
  for (const violation of violations) console.error(`- ${violation}`);
  console.error(
    '\nAdd an explicit ".js" extension to each relative import above - Node\'s ESM resolver ' +
      "requires it at runtime even though tsc/vitest/tsx don't enforce it."
  );
  process.exit(1);
}

console.log('Every relative import in a "type": "module" package carries an explicit extension.');

function listTypeScriptFiles(directory) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(path);
    return entry.isFile() && [".ts", ".tsx"].includes(extname(entry.name)) ? [path] : [];
  });
}
