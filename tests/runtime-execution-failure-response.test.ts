import { describe, expect, it } from "vitest";
import { Cp2Error } from "../services/api/src/cp2/cp2-error";
import { runtimeExecutionFailureResponse } from "../services/api/src/cp2/domains/agent-runtime/shared";

describe("runtimeExecutionFailureResponse", () => {
  it("surfaces the specific error message plain when the failure is not retryable", () => {
    const error = new Cp2Error(404, "invoice_not_found", "Invoice was not found.");
    expect(runtimeExecutionFailureResponse(error)).toBe("Invoice was not found.");
  });

  it("invites a retry only when Cp2Error.retryable is explicitly true", () => {
    const error = new Cp2Error(503, "storage_temporarily_unavailable", "Storage is busy.", true);
    expect(runtimeExecutionFailureResponse(error)).toBe("Storage is busy. You can try that again.");
  });

  it("treats retryable: false the same as unset - no retry invitation", () => {
    const error = new Cp2Error(409, "invoice_already_confirmed", "Already confirmed.", false);
    expect(runtimeExecutionFailureResponse(error)).toBe("Already confirmed.");
  });
});
