# Authentication provider setup

Soko Market supports phone OTP over SMS, phone OTP over WhatsApp, and the existing email OTP path.
WhatsApp is only an OTP delivery channel; it is not a social identity or OAuth login.

Google, Facebook, TikTok, Apple, GitHub, Microsoft, LinkedIn, and X login are disabled in the
frontend and backend. Their OAuth client IDs and secrets are not required.

## Twilio Verify configuration

Configure one Twilio account and one Verify Service for the entire Soko deployment:

```text
TWILIO_VERIFY_ENABLED=true
WHATSAPP_OTP_ENABLED=true
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_VERIFY_SERVICE_SID=VA...
```

These are Soko server credentials. Users never provide Twilio or WhatsApp credentials, and the
same server-side configuration serves every user.

In Twilio:

1. Create a Verify Service.
2. Enable SMS verification.
3. Enable the WhatsApp channel and complete the sender/Meta approval shown by Twilio.
4. For a trial account, add and verify each test recipient as required by Twilio.
5. Enter the five values above in the Render environment for `soko-market-api` and redeploy.

Phone numbers must be normalized to E.164, for example `+254700000000`.

## Runtime behavior

- `Continue with WhatsApp` requests Twilio Verify using `Channel=whatsapp`.
- `Continue with phone` requests Twilio Verify using `Channel=sms`.
- Both paths verify the code against the same Twilio Verify Service.
- Email OTP continues to use the existing email/local provider path.
- The API fails at startup if Twilio or WhatsApp OTP is enabled but a required Twilio secret is
  missing.
- OAuth starts, callbacks, and the legacy social-login route return `403`.
