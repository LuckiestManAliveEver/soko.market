import { runtimeToolRegistry } from "../registry/index.js";
import {
  invalid,
  valid,
  type RuntimeModelOutputParseResult,
  type RuntimeToolName
} from "../contracts/runtime.js";
import { validateRuntimeToolInput } from "../validation/runtime.js";

export function parseRuntimeModelOutput(outputText: string): RuntimeModelOutputParseResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(outputText);
  } catch {
    return {
      ok: false,
      output: null,
      errors: ["Local model returned malformed JSON."]
    };
  }

  if (!isRecord(parsed)) {
    return {
      ok: false,
      output: null,
      errors: ["Local model output must be a JSON object."]
    };
  }

  const kind = parsed.type;

  if (kind === "tool") {
    const toolName = parsed.toolName;
    const input = parsed.input;
    const reason =
      typeof parsed.reason === "string" && parsed.reason.trim().length > 0
        ? parsed.reason.trim()
        : "Local model proposed a runtime tool.";

    if (!isRuntimeToolName(toolName)) {
      return {
        ok: false,
        output: null,
        errors: ["Local model proposed an unsupported runtime tool."]
      };
    }

    const toolInput = isRecord(input) ? input : {};

    return {
      ok: true,
      output: {
        kind: "tool",
        proposal: {
          toolName,
          input: toolInput,
          reason,
          validation: validateRuntimeToolInput(toolName, toolInput)
        }
      },
      errors: []
    };
  }

  if (kind === "clarification") {
    const message = parseModelMessage(
      parsed.message,
      "I need more details before I can plan that."
    );

    return {
      ok: true,
      output: {
        kind: "clarification",
        proposal: {
          toolName: "unknown.clarify",
          input: {},
          reason: "Local model requested clarification.",
          validation: invalid(message)
        }
      },
      errors: []
    };
  }

  if (kind === "response") {
    const message = parseModelMessage(
      parsed.message,
      "I can help with products, invoices, payments, and imports."
    );

    return {
      ok: true,
      output: {
        kind: "response",
        proposal: {
          toolName: "unknown.clarify",
          input: {},
          reason: message,
          validation: valid()
        }
      },
      errors: []
    };
  }

  return {
    ok: false,
    output: null,
    errors: ["Local model output type must be tool, clarification, or response."]
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRuntimeToolName(value: unknown): value is RuntimeToolName {
  return typeof value === "string" && value in runtimeToolRegistry;
}

function parseModelMessage(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}
