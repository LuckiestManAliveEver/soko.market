# Authentication channels

Social OAuth login is disabled. The signup and login UI do not show Google, Facebook, TikTok,
Apple, GitHub, Microsoft, LinkedIn, or X. The API marks those providers disabled and rejects OAuth
start/callback requests and the legacy `/auth/social/login` endpoint with `403`.

Phone authentication uses Firebase SMS verification in the browser and Firebase ID token
verification on the API. It does not create or link a social identity.

## Available choices

- Phone OTP through Firebase SMS.
- The existing email OTP path.

See `docs/authentication/provider-setup.md` for the server configuration.
