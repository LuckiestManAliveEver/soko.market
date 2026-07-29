# Agent Runtime Security

## Trust boundaries

The API is the authority for the active runtime. Runtime-turn requests no longer accept a frontend
agent profile as trusted prompt material. The server loads the saved profile, tenant binding,
permissions, skill registry, and model binding for every turn.

The following are always untrusted:

- customer and owner messages
- context files and business vocabulary files
- OCR text and imported documents
- retrieved conversations and owner memory
- model output and tool output

Untrusted text is delimited and instruction-like content is neutralized before model inference. It
cannot replace platform security, tenant identity, business policy, permissions, confirmation, or
the output contract.

## Tenancy and access

Runtime entities carry both `tenantId` and `shopId`, using the existing business ID boundary. API
reads require business access; runtime configuration changes, correction promotion, and rollback
require membership-management permission. Cross-shop access fails before context retrieval.

Context access rules distinguish owner, staff, and customer audiences. Confidential and restricted
record bodies are not placed into customer prompts. Existing authorized tools remain responsible for
fetching business records and applying field-level behavior.

## Tool and policy enforcement

Only registered, enabled skill bindings can be offered to a model. Typed policy rejects restricted
actions, excess discounts, disallowed catalogue mutation, invalid credit terms, and prohibited
substitution behavior. Existing tool schemas validate inputs, role checks validate the actor, and
high-risk actions still require explicit confirmation.

The model is advisory until these checks pass. A model cannot truthfully report a mutation unless
the verified tool result confirms it.

## Persistence and deletion

Migration `039_agent_business_runtime.sql` adds UUID-validated, business-foreign-keyed runtime
version, context-source, correction, and evaluation tables with business/time indexes. Context
sources support archive timestamps. Existing business/account deletion propagation removes runtime
collections with the rest of the scoped snapshot, preserving the existing recovery and purge model.
The paired rollback migration drops only these four new tables.

## Operational cautions

- Injection filtering is a defensive layer, not a substitute for authorization or typed execution.
- Evaluation reasons must remain bounded and should not contain secrets or raw document bodies.
- Customer conversation memory should remain disabled unless consent and deletion workflows are
  explicitly enabled.
- A registered model can still fail at runtime; local activation tests device health, while chat
  surfaces server readiness failures as actionable errors.
