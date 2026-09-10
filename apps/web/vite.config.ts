import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import webPackage from "./package.json";

const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url));

/**
 * The on-device receipt-OCR engine (tesseract.js). These are large, self-contained WASM/data
 * files fetched and cache-verified on demand (packages/offline-runtime's cacheArtifactsByUrl)
 * only when a user opts into offline OCR - never part of the mandatory app-shell precache, so they
 * are emitted under tesseract/ rather than assets/ and excluded from offline-manifest.json below.
 */
function tesseractOfflineAssets(): Plugin {
  const require = createRequire(import.meta.url);
  const packageDir = (name: string) => dirname(require.resolve(`${name}/package.json`));
  const files: Array<{ source: string; fileName: string }> = [
    { source: join(packageDir("tesseract.js"), "dist/worker.min.js"), fileName: "worker.min.js" },
    ...(
      [
        "tesseract-core-lstm.wasm.js",
        "tesseract-core-simd-lstm.wasm.js",
        "tesseract-core-relaxedsimd-lstm.wasm.js"
      ] as const
    ).map((name) => ({ source: join(packageDir("tesseract.js-core"), name), fileName: name })),
    {
      source: join(packageDir("@tesseract.js-data/eng"), "4.0.0_best_int/eng.traineddata.gz"),
      fileName: "lang/eng.traineddata.gz"
    }
  ];
  return {
    name: "tesseract-offline-assets",
    generateBundle() {
      const artifacts = files.map(({ source, fileName }) => {
        const buffer = readFileSync(source);
        this.emitFile({ type: "asset", fileName: `tesseract/${fileName}`, source: buffer });
        return {
          url: `/tesseract/${fileName}`,
          sha256: createHash("sha256").update(buffer).digest("hex"),
          bytes: buffer.byteLength
        };
      });
      this.emitFile({
        type: "asset",
        fileName: "tesseract/manifest.json",
        source: JSON.stringify({ artifacts })
      });
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, workspaceRoot, "");
  const usePolling =
    (process.env.VITE_USE_POLLING ?? env.VITE_USE_POLLING) === "true" ||
    process.env.CHOKIDAR_USEPOLLING === "true" ||
    process.env.WSL_DISTRO_NAME !== undefined ||
    existsSync("/.dockerenv");
  const debugUi = (process.env.DEBUG_UI ?? env.DEBUG_UI) === "true";
  const appVersion = process.env.VITE_APP_VERSION ?? env.VITE_APP_VERSION ?? webPackage.version;
  const gitCommitSha =
    process.env.VITE_GIT_COMMIT_SHA ??
    env.VITE_GIT_COMMIT_SHA ??
    process.env.RENDER_GIT_COMMIT ??
    "local";
  const deploymentEnvironment =
    process.env.VITE_DEPLOYMENT_ENV ??
    env.VITE_DEPLOYMENT_ENV ??
    (process.env.RENDER === "true" ? "render" : mode);
  const stagingSecurityHeaders =
    deploymentEnvironment === "staging"
      ? {
          "Content-Security-Policy": [
            "default-src 'self'",
            "base-uri 'self'",
            "object-src 'none'",
            "frame-ancestors 'none'",
            "form-action 'self'",
            "script-src 'self' 'wasm-unsafe-eval' 'sha256-Z2/iFzh9VMlVkEOar1f/oSHWwQk3ve1qk/C2WdsC4Xk='",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            "font-src 'self' data:",
            "manifest-src 'self'",
            "worker-src 'self' blob:",
            "child-src 'self' blob:",
            "connect-src 'self' http://127.0.0.1:4000 ws://127.0.0.1:5173 ws://localhost:5173 https://huggingface.co https://*.huggingface.co https://hf.co https://*.hf.co https://raw.githubusercontent.com"
          ].join("; "),
          "Cross-Origin-Embedder-Policy": "credentialless",
          "Cross-Origin-Opener-Policy": "same-origin"
        }
      : {};

  return {
    build: {
      manifest: true,
      rollupOptions: {
        output: {
          assetFileNames: "assets/[name]-[hash][extname]",
          chunkFileNames: "assets/[name]-[hash].js",
          entryFileNames: "assets/[name]-[hash].js"
        }
      }
    },
    define: {
      __APP_NAME__: JSON.stringify("Soko.market"),
      __APP_VERSION__: JSON.stringify(appVersion),
      __BUILD_TIMESTAMP__: JSON.stringify(new Date().toISOString()),
      __DEPLOYMENT_ENV__: JSON.stringify(deploymentEnvironment),
      __DEBUG_UI__: JSON.stringify(debugUi),
      __GIT_COMMIT_SHA__: JSON.stringify(gitCommitSha)
    },
    envDir: workspaceRoot,
    plugins: [
      react(),
      tesseractOfflineAssets(),
      {
        name: "offline-shell-manifest",
        generateBundle(_options, bundle) {
          const entries = Object.entries(bundle).filter(([name]) => name.startsWith("assets/"));
          const bytes = entries.reduce(
            (sum, [, entry]) =>
              sum +
              (entry.type === "chunk"
                ? Buffer.byteLength(entry.code)
                : typeof entry.source === "string"
                  ? Buffer.byteLength(entry.source)
                  : entry.source.byteLength),
            0
          );
          this.emitFile({
            type: "asset",
            fileName: "offline-manifest.json",
            source: JSON.stringify({ files: entries.map(([name]) => name), bytes })
          });
        }
      }
    ],
    server: {
      headers: {
        "Cache-Control": "no-store",
        ...stagingSecurityHeaders
      },
      hmr: true,
      host: "0.0.0.0",
      port: 5173,
      strictPort: true,
      watch: {
        ...(usePolling ? { interval: 100 } : {}),
        usePolling
      }
    }
  };
});
