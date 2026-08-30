const command = process.argv[2];
const baseUrl = (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/+$/u, "");
const providerModelId = (
  process.env.SOKO_PRIMARY_PROVIDER_MODEL_ID ?? "smollm2:360m-instruct-q4_0"
).trim();

if (command === "wait") {
  const deadline = Date.now() + Number(process.env.OLLAMA_START_TIMEOUT_MS ?? 90_000);
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/tags`);
      if (response.ok) process.exit(0);
    } catch {
      // The supervisor keeps waiting until the bounded deadline.
    }
    await delay(1_000);
  }
  console.error("Ollama did not become reachable before OLLAMA_START_TIMEOUT_MS.");
  process.exit(1);
}

if (command === "has") {
  const response = await fetch(`${baseUrl}/api/tags`);
  if (!response.ok) process.exit(2);
  const body = await response.json();
  const names = Array.isArray(body.models)
    ? body.models.flatMap((model) => [model?.model, model?.name])
    : [];
  const found = names.some(
    (name) =>
      name === providerModelId ||
      name === `${providerModelId}:latest` ||
      `${name}:latest` === providerModelId
  );
  process.exit(found ? 0 : 1);
}

console.error("Usage: node model-admin.mjs <wait|has>");
process.exit(64);
import { setTimeout as delay } from "node:timers/promises";
