import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Render Blueprint", () => {
  it("provisions and wires the Postgres database into every database consumer", async () => {
    const blueprint = await readFile(new URL("../render.yaml", import.meta.url), "utf8");

    expect(blueprint).toContain("databases:\n  - name: soko-market-db");
    expect(blueprint).toContain("CP2_STORE\n        value: postgres");
    expect(blueprint).toContain("corepack pnpm db:migrate &&");
    expect(blueprint).not.toMatch(/key: (?:DIRECT_)?DATABASE_URL\n\s+sync: false/);
    expect(blueprint.match(/name: soko-market-db\n\s+property: connectionString/g)).toHaveLength(
      10
    );
    expect(blueprint).toContain("name: soko-market-account-purge");
    expect(blueprint).toContain("corepack pnpm db:purge-accounts");
    expect(blueprint).toContain("key: ACCOUNT_DELETION_PROCESSORS_JSON\n        sync: false");
    expect(blueprint).toContain("key: ACCOUNT_DELETION_WEBHOOK_SECRET\n        sync: false");
  });

  it("enables secured client inference without enabling Render-local inference", async () => {
    const blueprint = await readFile(new URL("../render.yaml", import.meta.url), "utf8");
    const staging = blueprint.slice(blueprint.indexOf("name: soko-market-web-staging"));
    const production = blueprint.slice(
      blueprint.indexOf("name: soko-market-web"),
      blueprint.indexOf("name: soko-market-web-staging")
    );

    expect(staging).toContain("VITE_DEPLOYMENT_ENV\n        value: staging");
    expect(staging).toContain('VITE_BROWSER_LOCAL_INFERENCE_ENABLED\n        value: "true"');
    expect(staging).toContain("Content-Security-Policy");
    expect(staging).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(staging).toContain("https://*.huggingface.co");
    expect(staging).toContain("https://*.hf.co");
    expect(staging).toContain("Cross-Origin-Embedder-Policy");
    expect(staging).toContain("Cross-Origin-Opener-Policy");
    expect(production).toContain('VITE_BROWSER_LOCAL_INFERENCE_ENABLED\n        value: "true"');
    expect(production).toContain('VITE_INFERENCE_CLIENT_FIRST\n        value: "true"');
    expect(production).toContain("Content-Security-Policy");
    expect(production).toContain("https://*.huggingface.co");
    expect(blueprint).not.toContain("LOCAL_MODEL_");
    expect(blueprint).not.toContain("services/ai-runtime/**");
    expect(blueprint).toContain("check:render-inference-boundaries");
    expect(blueprint).toContain('INFERENCE_CLOUD_FALLBACK_ENABLED\n        value: "false"');
  });
});
