const baseUrl = required("SOKO_INFERENCE_URL").replace(/\/+$/u, "");
const token = required("INFERENCE_SERVICE_TOKEN");
const modelId = process.env.SOKO_MODEL_ID?.trim() || "smollm2-360m";
const response = await fetch(`${baseUrl}/v1/models/${encodeURIComponent(modelId)}/probe`, {
  method: "POST",
  headers: {
    accept: "application/json",
    authorization: `Bearer ${token}`,
    "x-request-id": randomUUID()
  }
});
const body = await response.json().catch(() => null);
if (!response.ok || body?.ok !== true || body.modelId !== modelId) {
  console.error(JSON.stringify(body ?? { error: "invalid probe response" }, null, 2));
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
import { randomUUID } from "node:crypto";
