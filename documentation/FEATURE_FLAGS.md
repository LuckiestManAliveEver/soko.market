# Feature Flag Policy

CP1 establishes feature flags as explicit runtime configuration, not hidden code paths.

## Rules

- Feature flags are named with stable snake_case keys.
- Business-changing flags must be logged with the action they affect.
- Payment, invoice, inventory, tax, discount, and sync-conflict behavior cannot silently change through client-only flags.
- AI-related flags cannot bypass Tool Executor, Business Runtime validation, confirmation, or event creation.
- Default local flags live in `.env.example`.

## Initial Flag

| Key                |         Default | Purpose                                                                            |
| ------------------ | --------------: | ---------------------------------------------------------------------------------- |
| `rule_parser_stub` | enabled locally | Allows CP4 to attach a deterministic parser without enabling full model inference. |
