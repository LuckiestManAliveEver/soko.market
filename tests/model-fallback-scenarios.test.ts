import { describe, expect, it } from "vitest";

import { parseMerchantCommand } from "../packages/tool-core/src";
import { modelFallbackEvalScenarios } from "./ai-eval/model-fallback-scenarios";

describe("model-fallback eval golden set", () => {
  it.each(modelFallbackEvalScenarios)(
    "$id truly falls through the deterministic rule parser",
    ({ message }) => {
      const result = parseMerchantCommand(message);
      expect(
        result.intent,
        `"${message}" matched intent "${result.intent}" at confidence ${result.confidence} - a ` +
          "message that resolves deterministically doesn't belong in the paid, model-judged " +
          "fallback golden set (services/api/scripts/run-ai-eval.ts)."
      ).toBe("unknown");
    }
  );
});
