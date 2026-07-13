# Authentication provider setup

Soko Market supports phone OTP over Firebase SMS and the existing email OTP path.

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

## Runtime behavior

- `Continue with phone` opens Firebase phone authentication in the browser.
- The browser confirms the SMS code with Firebase and then sends the Firebase ID token to the API.
- The API verifies the token with Firebase public certificates and converts that into the normal
  CP2 session.
- Email OTP continues to use the existing email/local provider path.
- OAuth starts, callbacks, and the legacy social-login route return `403`.
