const apiUrl = required("SOKO_API_URL").replace(/\/+$/u, "");
const inferenceUrl = required("SOKO_INFERENCE_URL").replace(/\/+$/u, "");
const inferenceToken = required("INFERENCE_SERVICE_TOKEN");
const sessionToken = required("SOKO_TEST_TOKEN");
const agentId = required("SOKO_TEST_AGENT_ID");
const shopId = required("SOKO_TEST_SHOP_ID");
const modelId = process.env.SOKO_MODEL_ID?.trim() || "qwen2.5-0.5b-android";
const cookie = sessionToken.includes("=") ? sessionToken : `soko_session=${sessionToken}`;

const apiReadiness = await getJson(`${apiUrl}/health/ready`);
assert(apiReadiness.response.ok, "API readiness failed.", apiReadiness.body);
assert(
  apiReadiness.body?.database?.ok === true,
  "Neon database readiness failed.",
  apiReadiness.body
);

const inferenceReadiness = await getJson(`${inferenceUrl}/health/ready`, {
  authorization: `Bearer ${inferenceToken}`
});
assert(
  inferenceReadiness.response.ok && inferenceReadiness.body?.ok === true,
  "Inference readiness failed.",
  inferenceReadiness.body
);

const probe = await getJson(
  `${inferenceUrl}/v1/models/${encodeURIComponent(modelId)}/probe`,
  { authorization: `Bearer ${inferenceToken}` },
  "POST"
);
assert(
  probe.response.ok && probe.body?.ok === true && probe.body?.modelId === modelId,
  "Real model probe failed.",
  probe.body
);

const binding = await getJson(
  `${apiUrl}/api/agents/${encodeURIComponent(agentId)}/model-binding?shopId=${encodeURIComponent(shopId)}`,
  { cookie }
);
assert(
  binding.response.ok &&
    binding.body?.binding?.status === "active" &&
    binding.body?.binding?.lastVerificationStatus === "passed" &&
    binding.body?.binding?.modelId === modelId,
  "Verified active agent binding was not found.",
  binding.body
);

const chat = await getJson(
  `${apiUrl}/businesses/${encodeURIComponent(shopId)}/runtime/turns`,
  { cookie, "content-type": "application/json" },
  "POST",
  { message: "Reply briefly with the name of the model currently serving this agent." }
);
assert(chat.response.ok, "Real chat request failed.", chat.body);
assert(
  chat.body?.turn?.model?.modelId === modelId &&
    chat.body?.turn?.model?.executionTarget === "backend" &&
    typeof chat.body?.turn?.model?.inferenceRequestId === "string",
  "Chat metadata did not identify the selected backend model.",
  chat.body
);

console.log(
  JSON.stringify(
    {
      ok: true,
      api: apiReadiness.body,
      inference: inferenceReadiness.body,
      probe: probe.body,
      binding: binding.body.binding,
      chatModel: chat.body.turn.model
    },
    null,
    2
  )
);

async function getJson(url, headers = {}, method = "GET", body) {
  const response = await fetch(url, {
    method,
    headers: {
      accept: "application/json",
      "x-request-id": randomUUID(),
      ...headers
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  return { response, body: await response.json().catch(() => null) };
}

function required(name) {
  const value = process.env[name]?.trim() ?? "";
  if (value === "") {
    console.error(`${name} is required.`);
    process.exit(64);
  }
  return value;
}

function assert(condition, message, detail) {
  if (condition) return;
  console.error(message);
  console.error(JSON.stringify(detail, null, 2));
  process.exit(1);
}
import { randomUUID } from "node:crypto";
