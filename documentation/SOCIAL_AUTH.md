# Authentication channels

Social OAuth login is disabled. The signup and login UI do not show Google, Facebook, TikTok,
Apple, GitHub, Microsoft, LinkedIn, or X. The API marks those providers disabled and rejects OAuth
start/callback requests and the legacy `/auth/social/login` endpoint with `403`.

WhatsApp remains available only for delivery of a phone one-time password. It does not create or
link a WhatsApp social identity.

## Available choices

- WhatsApp OTP through Twilio Verify's `whatsapp` channel.
- Normal phone OTP through Twilio Verify's `sms` channel.
- The existing email OTP path.

See `docs/authentication/provider-setup.md` for the server configuration.
