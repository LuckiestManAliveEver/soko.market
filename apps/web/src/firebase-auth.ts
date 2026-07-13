interface FirebaseWebConfig {
  apiKey: string;
  appId: string;
  authDomain: string;
  messagingSenderId?: string;
  projectId: string;
}

interface FirebaseUserCredential {
  user: {
    getIdToken(forceRefresh?: boolean): Promise<string>;
  };
}

export interface FirebaseConfirmationResult {
  confirm(code: string): Promise<FirebaseUserCredential>;
}

interface FirebaseGlobal {
  apps: Array<unknown>;
  auth: unknown;
  initializeApp(config: FirebaseWebConfig): unknown;
}

declare global {
  interface Window {
    firebase?: FirebaseGlobal;
  }
}

const FIREBASE_APP_SCRIPT_URL = "https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js";
const FIREBASE_AUTH_SCRIPT_URL =
  "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth-compat.js";

let firebaseScriptPromise: Promise<void> | null = null;

function readFirebaseWebConfig(): FirebaseWebConfig | null {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY?.trim();
  const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN?.trim();
  const appId = import.meta.env.VITE_FIREBASE_APP_ID?.trim();
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim();
  const messagingSenderId = import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID?.trim();

  if (!apiKey || !authDomain || !appId || !projectId) {
    return null;
  }

  return {
    apiKey,
    authDomain,
    appId,
    projectId,
    ...(messagingSenderId ? { messagingSenderId } : {})
  };
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);

    if (existingScript !== null) {
      if (existingScript.dataset.loaded === "true") {
        resolve();
        return;
      }

      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), {
        once: true
      });
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.defer = true;
    script.dataset.firebase = "true";
    script.addEventListener(
      "load",
      () => {
        script.dataset.loaded = "true";
        resolve();
      },
      { once: true }
    );
    script.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), {
      once: true
    });
    document.head.appendChild(script);
  });
}

async function ensureFirebaseScriptLoaded(): Promise<FirebaseGlobal> {
  const existing = window.firebase;

  if (existing !== undefined) {
    return existing;
  }

  if (firebaseScriptPromise === null) {
    firebaseScriptPromise = (async () => {
      await loadScript(FIREBASE_APP_SCRIPT_URL);
      await loadScript(FIREBASE_AUTH_SCRIPT_URL);
    })();
  }

  await firebaseScriptPromise;

  if (window.firebase === undefined) {
    throw new Error("Firebase auth script did not initialize.");
  }

  return window.firebase;
}

async function getFirebaseApp(): Promise<FirebaseGlobal | null> {
  const config = readFirebaseWebConfig();

  if (config === null) {
    return null;
  }

  const firebase = await ensureFirebaseScriptLoaded();

  if (firebase.apps.length === 0) {
    firebase.initializeApp(config);
  }

  return firebase;
}

export function isFirebasePhoneAuthConfigured(): boolean {
  return readFirebaseWebConfig() !== null;
}

export async function sendFirebasePhoneOtp(
  phoneNumber: string,
  recaptchaContainer: HTMLElement
): Promise<FirebaseConfirmationResult> {
  const firebase = await getFirebaseApp();

  if (firebase === null) {
    throw new Error("Firebase phone auth is not configured.");
  }

  const authNamespace = firebase.auth as unknown as {
    RecaptchaVerifier: new (
      container: HTMLElement,
      parameters: { size: "invisible" | "normal" }
    ) => {
      clear(): void;
    };
    (): {
      signInWithPhoneNumber(
        phoneNumber: string,
        appVerifier: { clear(): void }
      ): Promise<FirebaseConfirmationResult>;
    };
  };
  const authInstance = authNamespace();
  const authObject = authInstance as {
    signInWithPhoneNumber(
      phoneNumber: string,
      appVerifier: { clear(): void }
    ): Promise<FirebaseConfirmationResult>;
  };

  const verifier = new authNamespace.RecaptchaVerifier(recaptchaContainer, {
    size: "invisible"
  });

  try {
    return await authObject.signInWithPhoneNumber(phoneNumber, verifier);
  } catch (error) {
    verifier.clear();
    throw error;
  }
}
