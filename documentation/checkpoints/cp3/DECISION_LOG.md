# CP3 Decision Log

Status: passed
Date opened: 2026-07-02
Date passed: 2026-07-02

This file records mobile shell and chat shell decisions for CP3.

## Accepted Decisions

| ID      | Decision                                                                                        | Rationale                                                                                    | Impact                                                                                                  |
| ------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| CP3-D01 | Build CP3 as a mobile-first React PWA shell on the existing `apps/web` Vite application.        | CP1 selected React and `apps/web` as the primary mobile PWA surface.                         | CP3 work should extend the existing web app instead of introducing a second frontend.                   |
| CP3-D02 | Treat chat as a shell in CP3, not an executing parser.                                          | CP4 owns the rule-based parser and intent execution path.                                    | CP3 may collect draft text and show placeholder responses, but it must not mutate business records.     |
| CP3-D03 | Keep quick actions as navigation and placeholder entry points until business features exist.    | CP5 through CP8 own business records, invoices, payments, and sync behavior.                 | Users can see the intended workflows without fake CRUD implementations or hidden data contracts.        |
| CP3-D04 | Use CP2 session and active business state as the only authenticated shell contract.             | CP2 already defines auth/session/business membership boundaries.                             | CP3 must not create parallel auth state or client-only role checks.                                     |
| CP3-D05 | Show offline and sync status placeholders without selecting the durable local data wrapper yet. | CP1 deferred IndexedDB wrapper choice to CP3/CP7, and real sync queue design belongs to CP7. | CP3 can use browser online/offline signals for display, while Dexie/raw IndexedDB remains a CP7 choice. |
| CP3-D06 | Optimize first for low-end Android usability.                                                   | CP0 and CP15 identify 1 GB and 2 GB Android testing as important product constraints.        | Layout, type, tap targets, and asset choices should stay lightweight and avoid desktop-first patterns.  |
| CP3-D07 | Preserve AI/runtime isolation.                                                                  | CP0 and CP1 require AI-assisted behavior without AI-owned business truth.                    | CP3 UI may reference chat, but must not import `services/ai-runtime` or expose general host tools.      |

## Deferred Decisions

| Decision                         | Deferred To | Reason                                                                 |
| -------------------------------- | ----------- | ---------------------------------------------------------------------- |
| Rule-based parser behavior       | CP4         | CP3 only establishes the chat surface.                                 |
| Durable local data wrapper       | CP7         | Offline queue and conflict rules should drive the storage choice.      |
| Business record CRUD             | CP5         | CP3 placeholders should not define product/customer schemas.           |
| Invoice, inventory, and payments | CP6/CP8     | Commerce execution requires business rules, tax, and payment handling. |
| Native shell                     | Later       | The first implementation remains the mobile PWA.                       |

## CP3 Boundary Checks

CP3 must preserve these checks:

- UI does not import AI runtime implementation.
- Chat shell does not execute state-changing business actions.
- Authenticated shell state comes from CP2 session/business contracts.
- Offline and sync placeholders do not imply guaranteed offline mutation support.
- Existing CP1 and CP2 tests continue to pass.
