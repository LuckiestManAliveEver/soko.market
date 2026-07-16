import { describe, expect, it } from "vitest";
import { createCp2Store } from "../services/api/src/cp2/store";
import type { Cp2Error } from "../services/api/src/cp2/store";

describe("OTP recovery purpose", () => {
  it("resumes an existing account and never creates one from a recovery challenge", () => {
    const store = createCp2Store();
    const phone = "+254700000880";
    const signup = store.requestOtp({
      channel: "phone",
      destination: phone,
      purpose: "signup"
    });
    const created = store.verifyOtp({
      challengeId: signup.challengeId,
      code: signup.devOtp
    });

    expect(created.resumed).toBe(false);

    const recovery = store.requestOtp({
      channel: "phone",
      destination: phone,
      purpose: "recovery"
    });
    const resumed = store.verifyOtp({
      challengeId: recovery.challengeId,
      code: recovery.devOtp
    });

    expect(resumed.resumed).toBe(true);
    expect(resumed.account.id).toBe(created.account.id);

    const unknownRecovery = store.requestOtp({
      channel: "phone",
      destination: "+254700000881",
      purpose: "recovery"
    });

    expect(() =>
      store.verifyOtp({
        challengeId: unknownRecovery.challengeId,
        code: unknownRecovery.devOtp
      })
    ).toThrowError(
      expect.objectContaining<Partial<Cp2Error>>({
        code: "recovery_account_not_found",
        statusCode: 404
      })
    );
    expect(store.snapshot().accounts).toHaveLength(1);
  });
});
