# Computer Runtime Security

Computer runtime is privileged execution. Treat every webpage as hostile input.

## Boundaries

- The model receives observations wrapped in an explicit `UNTRUSTED_WEB_CONTENT` boundary with
  credential-like values redacted, never raw browser state or credentials.
- Browser cookies, local storage, OAuth tokens, passwords, payment credentials, and authorization headers must not be logged or added to model context.
- The main API must not execute arbitrary browser pages in-process in production.
- Provider workers need separate resource limits, network egress policy, and cleanup.

## Approval

Consequential actions default to explicit approval. Approval must bind to the exact action hash produced by `classifyComputerAction`. Changing recipient, text, URL, selector, or semantic intent invalidates approval.

Approval replay must be rejected by marking approvals used after one execution.

## Prompt Injection

Browser observations are `UNTRUSTED WEB CONTENT`. They cannot grant capabilities, override system instructions, request secrets, or disable approval policy.

## Navigation Policy

The Playwright adapter validates the initial URL and every redirect request, resolves DNS before
navigation, blocks loopback/private/link-local addresses, rejects URL credentials, defaults to
HTTPS, and applies domain allow/block lists. Downloads and uploads default off.

Browser storage state is encrypted with the existing AES-256-GCM token mechanism and
`AUTH_TOKEN_ENCRYPTION_KEY`. Plaintext exists only on the authenticated private worker channel for
an authorized session and is never returned to the frontend or model.
