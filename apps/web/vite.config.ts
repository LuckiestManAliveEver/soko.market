import react from "@vitejs/plugin-react";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import webPackage from "./package.json";

const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url));

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
    plugins: [react()],
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
