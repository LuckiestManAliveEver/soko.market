import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  out: "./infra/db/migrations",
  schema: "./infra/db/schema.ts"
});
