// Liveness check for the Vercel inference deployment itself (services/ai-runtime). This hits the
// Vercel host directly, not through Render - use scripts/verify-production-runtime.mjs for a real
// end-to-end check that proves Render can actually reach and use it.
import { randomUUID } from "node:crypto";

const baseUrl = required("VERCEL_INFERENCE_URL").replace(/\/+$/u, "");
const response = await fetch(`${baseUrl}/health`, {
  headers: {
    accept: "application/json",
    "x-request-id": randomUUID()
  }
});
const body = await response.json().catch(() => null);
if (!response.ok || body?.ok !== true) {
  console.error(JSON.stringify(body ?? { error: "invalid health response" }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(body, null, 2));

function required(name) {
  const value = process.env[name]?.trim() ?? "";
  if (value === "") {
    console.error(`${name} is required.`);
    process.exit(64);
  }
  return value;
}
