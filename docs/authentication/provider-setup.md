# Authentication provider setup

Soko Market supports signup through email verification or Firebase phone OTP.

Google, Facebook, TikTok, Apple, GitHub, Microsoft, LinkedIn, and X login are disabled in the
frontend and backend. Their OAuth client IDs and secrets are not required.

## Firebase phone OTP configuration

Create one Firebase project for the deployment and use it for both the web client and the API.

Set these environment variables:

```text
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
FIREBASE_PROJECT_ID=...
```

The `VITE_` values are public Firebase web config values. The API only needs
`FIREBASE_PROJECT_ID` to verify the Firebase ID token after the phone code is confirmed in the
browser.

In Firebase:

1. Create or open the Firebase project.
2. Add the production web domain and any preview domains under Authentication settings.
3. Enable the Phone provider in Authentication.
4. Copy the web app config values into the `VITE_FIREBASE_*` environment variables.
5. Set `FIREBASE_PROJECT_ID` on the API service.
6. Redeploy the web app and API.

Phone numbers must be normalized to E.164, for example `+254700000000`.

For local or automated testing, add fictional phone numbers and verification codes in the Firebase
console, then set:

```text
VITE_FIREBASE_APP_VERIFICATION_DISABLED_FOR_TESTING=true
```

This uses Firebase's mock reCAPTCHA verifier. It is restricted to development builds and does not
work with real phone numbers. Never set it in production.

## Runtime behavior

- `Continue with email` creates a new account through email verification.
- Returning email users sign in with the verified email address and owner PIN; normal login does not
  send another code.
- `Forgot PIN?` sends a challenge-bound email verification code and allows the verified account to
  set a new PIN, including on a browser without saved local account data.
- `Continue with phone` creates a new account after Firebase verifies the SMS code.
- `Use phone and PIN` performs normal login without Firebase.
- `Forgot PIN?` exposes the recovery flow; phone recovery opens Firebase authentication.
- The browser confirms the SMS code with Firebase and then sends the Firebase ID token to the API.
- The API verifies the token with Firebase public certificates. A signup challenge may create a CP2
  account, while a recovery challenge can resume only an existing account.
- OAuth starts, callbacks, and the legacy social-login route return `403`.
