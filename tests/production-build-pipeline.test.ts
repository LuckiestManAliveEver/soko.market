import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("production workspace build pipeline", () => {
  it("builds API dependencies before validating compiled entry points", async () => {
    const rootManifest = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    const apiManifest = JSON.parse(await readFile("services/api/package.json", "utf8")) as {
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    const runtimeManifest = JSON.parse(
      await readFile("services/ai-runtime/package.json", "utf8")
    ) as {
      main: string;
      types: string;
      exports: Record<string, unknown>;
      scripts: Record<string, string>;
    };

    expect(apiManifest.dependencies["@soko/ai-runtime"]).toBe("workspace:*");
    expect(rootManifest.scripts["build:production"]).toContain("pnpm --filter @soko/api^... build");
    expect(rootManifest.scripts["build:production"]).toContain("pnpm --filter @soko/api build");
    expect(rootManifest.scripts["build:production"]).toContain("pnpm check:production-imports");
    expect(runtimeManifest.main).toBe("./dist/index.js");
    expect(runtimeManifest.types).toBe("./dist/index.d.ts");
    expect(runtimeManifest.exports).toHaveProperty(".");
    expect(runtimeManifest.scripts.build).toContain("tsc -p tsconfig.build.json");
    expect(apiManifest.scripts.start).toBe("node dist/index.js");
  });

  it("uses the same production command in the Render API service", async () => {
    const blueprint = await readFile("render.yaml", "utf8");
    const apiService = blueprint.slice(
      blueprint.indexOf("name: soko-market-api"),
      blueprint.indexOf("name: soko-market-web")
    );

    expect(apiService).toContain("corepack pnpm install --frozen-lockfile");
    expect(apiService).toContain("corepack pnpm build:production");
    expect(apiService).toContain("services/ai-runtime/**");
    expect(apiService).toContain("corepack pnpm db:migrate");
    expect(apiService).toContain("corepack pnpm --filter @soko/api start");
  });

  it("emits the AI runtime from src into dist with declarations", async () => {
    const buildConfig = JSON.parse(
      await readFile("services/ai-runtime/tsconfig.build.json", "utf8")
    ) as {
      compilerOptions: Record<string, unknown>;
      include: string[];
      exclude: string[];
    };
    const entryPoint = await readFile("services/ai-runtime/src/index.ts", "utf8");

    expect(buildConfig.compilerOptions.rootDir).toBe("./src");
    expect(buildConfig.compilerOptions.outDir).toBe("./dist");
    expect(buildConfig.compilerOptions.declaration).toBe(true);
    expect(buildConfig.compilerOptions.noEmit).toBe(false);
    expect(buildConfig.include).toContain("src/**/*.ts");
    expect(buildConfig.exclude).toContain("**/*.test.ts");
    expect(entryPoint).toContain('from "./app.js"');
  });
});
