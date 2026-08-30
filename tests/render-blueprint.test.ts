import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Render Blueprint", () => {
  it("wires external Neon URLs into every database consumer and migrates before deploy", async () => {
    const blueprint = await readFile(new URL("../render.yaml", import.meta.url), "utf8");

    expect(blueprint).not.toContain("\ndatabases:");
    expect(blueprint).not.toContain("fromDatabase:");
    expect(blueprint).toContain("CP2_STORE\n        value: postgres");
    expect(blueprint).toContain("name: soko-market-api\n    runtime: node");
    expect(blueprint).toContain("plan: starter");
    // build:production runs (and gates on) a clean compile before db:migrate, not after: a
    // destructive migration must never commit against the shared production database ahead of a
    // build that turns out not to compile - see docs/architecture/native-runtime-deployment.md §3.
    expect(blueprint).toContain(
      "buildCommand: COREPACK_HOME=/tmp/corepack corepack pnpm install --frozen-lockfile && COREPACK_HOME=/tmp/corepack corepack pnpm build:production && COREPACK_HOME=/tmp/corepack corepack pnpm db:migrate && REQUIRE_NEON_DATABASE=true COREPACK_HOME=/tmp/corepack corepack pnpm db:verify-schema"
    );
    expect(blueprint).not.toContain("preDeployCommand:");
    expect(blueprint.match(/key: DATABASE_URL\n\s+sync: false/g)?.length).toBeGreaterThanOrEqual(4);
    expect(
      blueprint.match(/key: DIRECT_DATABASE_URL\n\s+sync: false/g)?.length
    ).toBeGreaterThanOrEqual(4);
    expect(blueprint).toContain("name: soko-market-account-purge");
    expect(blueprint).toContain("corepack pnpm db:purge-accounts");
    expect(blueprint).toContain("key: ACCOUNT_DELETION_PROCESSORS_JSON\n        sync: false");
    expect(blueprint).toContain("key: ACCOUNT_DELETION_WEBHOOK_SECRET\n        sync: false");
  });

  it("declares authentication dependencies without SMS verification", async () => {
    const blueprint = await readFile(new URL("../render.yaml", import.meta.url), "utf8");
    const api = blueprint.slice(
      blueprint.indexOf("name: soko-market-api"),
      blueprint.indexOf("name: soko-market-rate-limit-cache")
    );

    for (const generatedSecret of [
      "PASSWORD_HASH_SECRET",
      "AUTH_AUDIT_HMAC_SECRET",
      "OTP_HMAC_SECRET",
      "AUTH_TOKEN_ENCRYPTION_KEY"
    ]) {
      expect(api).toContain(`${generatedSecret}\n        generateValue: true`);
    }
    for (const configuredSecret of ["RESEND_API_KEY"]) {
      expect(api).toContain(`${configuredSecret}\n        sync: false`);
    }
    expect(api).not.toMatch(/AUTH_SMS|SMS_GATEWAY|ANDROID_SMS|LOCAL_SMS/u);
    expect(api).toContain('SOKO_EMAIL_FROM\n        value: "Soko <messages@soko.market>"');
  });

  it("keeps hosted inference private and separately deployable", async () => {
    const blueprint = await readFile(new URL("../render.yaml", import.meta.url), "utf8");
    const rootManifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8")
    ) as { scripts: Record<string, string> };
    const staging = blueprint.slice(blueprint.indexOf("name: soko-market-web-staging"));
    const production = blueprint.slice(
      blueprint.indexOf("name: soko-market-web"),
      blueprint.indexOf("name: soko-market-web-staging")
    );
    const api = blueprint.slice(
      blueprint.indexOf("name: soko-market-api"),
      blueprint.indexOf("name: soko-market-rate-limit-cache")
    );

    expect(staging).toContain("VITE_DEPLOYMENT_ENV\n        value: staging");
    expect(staging).toContain('VITE_BROWSER_LOCAL_INFERENCE_ENABLED\n        value: "true"');
    expect(staging).toContain("Content-Security-Policy");
    expect(staging).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(staging).toContain("https://*.huggingface.co");
    expect(staging).toContain("https://raw.githubusercontent.com");
    expect(staging).toContain("https://*.hf.co");
    expect(staging).toContain("Cross-Origin-Embedder-Policy");
    expect(staging).toContain("Cross-Origin-Opener-Policy");
    expect(production).toContain('VITE_BROWSER_LOCAL_INFERENCE_ENABLED\n        value: "true"');
    expect(production).toContain('VITE_INFERENCE_CLIENT_FIRST\n        value: "true"');
    expect(production).toContain("Content-Security-Policy");
    expect(production).toContain("https://*.huggingface.co");
    expect(production).toContain("https://raw.githubusercontent.com");
    expect(blueprint).not.toContain("LOCAL_MODEL_");
    expect(blueprint).toContain("corepack pnpm build:production");
    expect(rootManifest.scripts["build:production"]).toContain("check:render-inference-boundaries");

    expect(blueprint).toContain("type: pserv\n    name: soko-market-inference");
    expect(blueprint).toContain("dockerfilePath: ./services/ai-runtime/Dockerfile");
    expect(blueprint).toContain("mountPath: /var/lib/soko-models");
    expect(blueprint).toContain('BACKEND_INFERENCE_ENABLED\n        value: "true"');
    expect(blueprint).toContain("BACKEND_INFERENCE_BASE_URL");
    expect(blueprint).toContain("property: hostport");
    expect(blueprint).toContain("SOKO_PRIMARY_MODEL_ID\n        value: smollm2-360m");
    expect(blueprint).toContain(
      "SOKO_PRIMARY_PROVIDER_MODEL_ID\n        value: smollm2:360m-instruct-q4_0"
    );
    expect(blueprint).not.toContain("VITE_INFERENCE_SERVICE_TOKEN");

    // The API has only a private gateway URL/token; Ollama remains inside the inference container.
    expect(api).not.toContain("OLLAMA_BASE_URL");
    expect(api).toContain("envVarKey: INFERENCE_SERVICE_TOKEN");
    expect(api).toContain('BACKEND_INFERENCE_REQUIRED\n        value: "false"');

    expect(blueprint).toContain('INFERENCE_OWNER_NODE_ENABLED\n        value: "true"');
    expect(blueprint).not.toContain("INFERENCE_CLOUD_FALLBACK_ENABLED");
    expect(blueprint).toContain("INFERENCE_JOB_SIGNING_SECRET\n        generateValue: true");
    expect(production).toContain('VITE_INFERENCE_NATIVE_BRIDGE_ENABLED\n        value: "true"');
    expect(production).toContain('VITE_INFERENCE_OWNER_NODE_ENABLED\n        value: "true"');
    expect(production).toContain('VITE_INFERENCE_MAX_FALLBACKS\n        value: "3"');
  });
});
