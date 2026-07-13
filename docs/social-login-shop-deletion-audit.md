# Authentication and shop-deletion audit

## Authentication decision

Social OAuth login is disabled for Google, Facebook, TikTok, Apple, GitHub, Microsoft, LinkedIn,
and X. The frontend has no social-login controls, the provider registry reports every OAuth
provider as disabled, and all OAuth start/callback paths are rejected by the API.

WhatsApp is used only as a Twilio Verify OTP delivery channel. It does not create a social account.
Normal SMS phone OTP and the existing email OTP path remain available.

## Shop deletion

Shop deletion remains protected by owner authorization, exact shop ID confirmation, PIN, and OTP.
This authentication-channel change does not alter its tenant-scoped deletion behavior.
