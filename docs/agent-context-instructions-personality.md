# Agent Context, Instructions, and Personality

## Instruction precedence

The central server assembler applies this precedence:

1. platform security
2. tenant and agent identity
3. structured business policy
4. personality
5. current task and recognized intent
6. retrieved context
7. available verified tools
8. relevant memory
9. output contract

Lower-priority content cannot modify a higher-priority rule. In particular, personality controls
wording only. It cannot expand permissions, change a discount limit, waive confirmation, expose
private records, or grant a tool.

## Structured personality

The profile stores tone, formality, response length, selling and negotiation style, greeting style,
local-vocabulary preference, language order, humour, customer-care and escalation behaviour, and a
confidence boundary. An advanced owner-guidance string remains available for nuance and legacy
profiles, but it is compiled as style guidance rather than policy.

## Structured business instructions

Critical rules are typed and enforced before tool execution. They include discount limits,
negotiation and credit controls, maximum credit days, out-of-stock substitutions, catalogue
modification, external messaging, restricted actions, and actions requiring owner approval. The
runtime also compiles general, sales, pricing, delivery, returns, inventory, supplier, privacy, and
escalation rules for the model.

Natural-language rules improve responses, but typed constraints are authoritative. A model response
cannot bypass `enforceAgentPolicy`, the existing role check, or confirmation tokens.

## Context manifest and retrieval

Each source carries a source ID, tenant/shop binding, type, title, state, sensitivity, access rules,
freshness time, version, and retrieval metadata. Supported categories cover catalogue, inventory,
customers, suppliers, receipts, orders, policies, documents, conversations, context scripts, and
owner notes.

The runtime does not paste the full business database into every request. It creates authoritative
catalogue/inventory summaries, exposes sensitive record collections as restricted references, and
retrieves only sources matching the current message and audience. Customer retrieval additionally
requires `customerVisible`.

Context scripts and uploaded content are untrusted data. Instruction-like lines are neutralized and
the surviving content is wrapped in explicit source delimiters. The same treatment applies to
retrieved owner memory. This is defense in depth; authorization is enforced before retrieval.

## Local vocabulary

Existing deterministic product and document context scripts remain the first intent layer. They
support the repository's configured English and Swahili vocabulary variants before a model fallback.
Matches create typed proposals only; permission and confirmation checks still apply.
