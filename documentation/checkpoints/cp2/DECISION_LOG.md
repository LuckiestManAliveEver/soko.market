# CP2 Decision Log

Status: active
Date opened: 2026-07-02

This file records account, auth, and business creation decisions for CP2.

## Accepted Decisions

| ID      | Decision                                                                                                     | Rationale                                                                                                  | Impact                                                                                                     |
| ------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| CP2-D01 | Use passwordless OTP as the CP2 authentication path.                                                         | The roadmap requires phone/email OTP and avoids adding password storage risk to the first auth checkpoint. | CP2 implements OTP request and verification contracts instead of password signup/login.                    |
| CP2-D02 | Use a provider-neutral OTP adapter with a local development implementation.                                  | CP0 defers SMS provider selection, while CP2 still needs an end-to-end local auth flow.                    | Production SMS/email providers remain replaceable and outside CP2.                                         |
| CP2-D03 | Store OTP verifier material hashed, not plaintext.                                                           | OTPs are credentials while active.                                                                         | Database state must not reveal active OTP codes directly.                                                  |
| CP2-D04 | Use server-validated refresh-surviving sessions.                                                             | CP2 requires auth state to survive refresh without trusting client-only state.                             | API owns session validation; the web app may only cache non-sensitive session view state.                  |
| CP2-D05 | Do not store sensitive session material in localStorage.                                                     | Local storage is exposed to XSS and should not hold bearer credentials.                                    | Prefer httpOnly cookie or equivalent server-managed session transport.                                     |
| CP2-D06 | Model business access through memberships.                                                                   | Users may eventually belong to multiple businesses and roles.                                              | CP2 creates first owner membership; later checkpoints can add switching and invitations without reshaping. |
| CP2-D07 | Define all baseline roles in CP2 but fully exercise only owner.                                              | Later flows need stable role values, but CP2 should not build manager/cashier workflows prematurely.       | Role enum includes owner, manager, sales_agent, cashier, and view_only.                                    |
| CP2-D08 | Capture language preference during account/business setup.                                                   | Language selection is MVP scope and affects later chat and support screens.                                | Store language preference before CP3/CP4 UI and parser work.                                               |
| CP2-D09 | Emit audit events for OTP verification, account creation/resume, business creation, and membership creation. | CP0 requires auditable, event-driven mutations.                                                            | CP2 implementation must connect auth/business mutations to immutable event records.                        |
| CP2-D10 | Keep AI runtime out of CP2 auth and business creation flows.                                                 | CP0 states AI must not directly mutate business records or bypass verification.                            | No CP2 account, session, business, or membership code may depend on services/ai-runtime.                   |

## Deferred Decisions

| Decision                           | Deferred To  | Reason                                                                  |
| ---------------------------------- | ------------ | ----------------------------------------------------------------------- |
| Production SMS provider            | CP16         | CP0 keeps SMS fallback/provider selection in public-launch scope.       |
| M-Pesa provider path               | CP8          | Payment provider work belongs to payments and debt tracking.            |
| Full TIEL                          | CP18         | CP0 treats TIEL as post-core-commerce hardening.                        |
| Multi-business switching UX        | CP5 or later | CP2 only needs first business creation and stable membership shape.     |
| Invitations and role management UI | CP5 or later | CP2 defines role checks but does not need full staff administration UX. |

## CP2 Boundary Checks

CP2 must preserve these checks:

- Business packages do not import AI runtime implementation.
- Auth/session code does not expose shell, filesystem, browser automation, or general host tools.
- State-changing account and business operations emit audit events.
- Role checks are enforced server-side.
