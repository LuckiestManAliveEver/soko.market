import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      react: fileURLToPath(new URL("./apps/web/node_modules/react", import.meta.url)),
      "react-dom": fileURLToPath(new URL("./apps/web/node_modules/react-dom", import.meta.url))
    }
  },
  test: {
    environment: "node",
    include: [
      "tests/**/*.test.ts",
      "tests/**/*.test.tsx",
      "packages/**/*.test.ts",
      "services/**/*.test.ts"
    ]
  }
});
