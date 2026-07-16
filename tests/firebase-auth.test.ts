// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveFirebaseAppVerificationDisabledForTesting,
  sendFirebasePhoneOtp
} from "../apps/web/src/firebase-auth";

describe("Firebase phone authentication", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete window.firebase;
  });

  it("rejects disabling app verification outside development builds", () => {
    expect(() =>
      resolveFirebaseAppVerificationDisabledForTesting({
        configuredValue: "true",
        development: false
      })
    ).toThrow("only be disabled in a development build");
  });

  it("uses Firebase's real verifier and official development testing switch", async () => {
    stubFirebaseConfig();
    vi.stubEnv("VITE_FIREBASE_APP_VERIFICATION_DISABLED_FOR_TESTING", "true");

    const confirmationResult = {
      confirm: vi.fn()
    };
    const clear = vi.fn();
    const verifierConstructor = vi.fn();

    class RecaptchaVerifier {
      constructor(container: HTMLElement, parameters: { size: string }) {
        verifierConstructor(container, parameters);
      }

      clear() {
        clear();
      }
    }

    const auth = {
      settings: {
        appVerificationDisabledForTesting: false
      },
      signInWithPhoneNumber: vi.fn().mockResolvedValue(confirmationResult)
    };
    const authNamespace = Object.assign(
      vi.fn(() => auth),
      {
        RecaptchaVerifier
      }
    );
    window.firebase = {
      apps: [{}],
      auth: authNamespace,
      initializeApp: vi.fn()
    };

    const container = document.createElement("div");
    await expect(sendFirebasePhoneOtp("+16505554567", container)).resolves.toBe(confirmationResult);
    expect(auth.settings.appVerificationDisabledForTesting).toBe(true);
    expect(verifierConstructor).toHaveBeenCalledWith(container, { size: "invisible" });
    expect(auth.signInWithPhoneNumber).toHaveBeenCalledWith(
      "+16505554567",
      expect.any(RecaptchaVerifier)
    );
    expect(clear).not.toHaveBeenCalled();
  });

  it("clears the verifier after Firebase rejects the SMS request", async () => {
    stubFirebaseConfig();

    const clear = vi.fn();
    class RecaptchaVerifier {
      clear() {
        clear();
      }
    }
    const auth = {
      settings: {
        appVerificationDisabledForTesting: false
      },
      signInWithPhoneNumber: vi.fn().mockRejectedValue(new Error("SMS rejected"))
    };
    window.firebase = {
      apps: [{}],
      auth: Object.assign(
        vi.fn(() => auth),
        { RecaptchaVerifier }
      ),
      initializeApp: vi.fn()
    };

    await expect(
      sendFirebasePhoneOtp("+16505554567", document.createElement("div"))
    ).rejects.toThrow("SMS rejected");
    expect(clear).toHaveBeenCalledOnce();
  });
});

function stubFirebaseConfig(): void {
  vi.stubEnv("VITE_FIREBASE_API_KEY", "test-api-key");
  vi.stubEnv("VITE_FIREBASE_AUTH_DOMAIN", "test.firebaseapp.com");
  vi.stubEnv("VITE_FIREBASE_APP_ID", "test-app-id");
  vi.stubEnv("VITE_FIREBASE_PROJECT_ID", "test-project");
}
