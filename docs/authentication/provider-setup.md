# Social auth provider setup

## Required app URLs

Local web:

```text
http://127.0.0.1:5173
```

Local API:

```text
http://127.0.0.1:4000
```

Frontend OAuth callback:

```text
http://127.0.0.1:5173/auth/oauth/callback
```

The API also exposes provider callback relays:

```text
/auth/oauth/:provider/callback
/api/auth/oauth/:provider/callback
```

## Environment variables

Shared:

```text
APP_URL=
API_URL=
AUTH_SECRET=
AUTH_SESSION_SECRET=
AUTH_TOKEN_ENCRYPTION_KEY=
AUTH_ALLOWED_REDIRECT_ORIGINS=
```

Google/Gmail:

```text
OAUTH_GOOGLE_CLIENT_ID=
OAUTH_GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
```

Facebook:

```text
OAUTH_FACEBOOK_CLIENT_ID=
OAUTH_FACEBOOK_CLIENT_SECRET=
META_REDIRECT_URI=
```

TikTok:

```text
OAUTH_TIKTOK_CLIENT_ID=
OAUTH_TIKTOK_CLIENT_SECRET=
TIKTOK_REDIRECT_URI=
```

WhatsApp OTP:

```text
WHATSAPP_OTP_ENABLED=false
WHATSAPP_BUSINESS_PHONE_NUMBER_ID=
WHATSAPP_BUSINESS_ACCESS_TOKEN=
WHATSAPP_OTP_TEMPLATE_NAME=soko_login_otp
WHATSAPP_OTP_TEMPLATE_LANGUAGE=en
```

## Provider notes

- Gmail uses Google OIDC scopes: `openid email profile`.
- Facebook uses `email public_profile`.
- TikTok uses `user.info.basic`.
- WhatsApp is not OAuth in this implementation; it is an OTP delivery channel over phone login.
- Business/customer channel connections are separate from login accounts.

## Verification checklist

1. Run `pnpm db:migrate`.
2. Start API and web.
3. Open the signup/login screen.
4. Confirm the six login choices are visible.
5. Confirm unconfigured OAuth providers show a safe disabled/unconfigured state.
6. Configure one provider and confirm OAuth redirects to the provider.
7. Complete callback and confirm a session cookie is created.
8. Open settings/debug area and confirm login accounts are separate from business channels.
