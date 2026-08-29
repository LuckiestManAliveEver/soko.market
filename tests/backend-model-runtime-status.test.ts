import { describe, expect, it } from "vitest";

import { backendModelRuntimeStatusMessage } from "../apps/web/src/backend-model-runtime-status";
import { backendRuntimeStatusScenarios } from "./ai-eval/backend-runtime-status-scenarios";

describe("backend model runtime status", () => {
  it.each(backendRuntimeStatusScenarios)(
    "explains $errorCode without misreporting another failure mode",
    ({ errorCode, expected, forbidden }) => {
      const message = backendModelRuntimeStatusMessage(errorCode);
      expect(message.toLowerCase()).toContain(expected.toLowerCase());
      if (forbidden !== undefined) expect(message.toLowerCase()).not.toContain(forbidden);
    }
  );

  it("uses a safe fallback for future error codes", () => {
    expect(backendModelRuntimeStatusMessage("NEW_RUNTIME_FAILURE")).toBe(
      "The backend model is currently unavailable."
    );
  });
});
