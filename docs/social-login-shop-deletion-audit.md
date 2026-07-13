# Authentication and shop-deletion audit

## Authentication decision

Social OAuth login is disabled for Google, Facebook, TikTok, Apple, GitHub, Microsoft, LinkedIn,
and X. The frontend has no social-login controls, the provider registry reports every OAuth
provider as disabled, and all OAuth start/callback paths are rejected by the API.

Phone OTP uses Firebase SMS verification in the browser and Firebase ID token verification on the
API. It does not create a social account. The existing email OTP path remains available.

## Shop deletion

Shop deletion remains protected by owner authorization, exact shop ID confirmation, PIN, and OTP.
This authentication-channel change does not alter its tenant-scoped deletion behavior.
