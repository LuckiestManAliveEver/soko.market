// The only file production application code may name a retired Execution Fabric table in.
// scripts/check-retired-runtime-references.mjs allowlists this exact path (and nothing else)
// so it can name these strings in order to detect and forbid them, without that declaration
// counting as the forbidden reference it exists to catch. Everything else that needs to
// recognize one of these names - the startup diagnostic in services/api/src/index.ts, the
// schema-contract tests - imports this constant instead of repeating the literal. See
// docs/architecture/native-runtime-deployment.md and
// infra/db/migrations/065_retire_execution_fabric.sql, which permanently drops all three.
export const RETIRED_EXECUTION_FABRIC_TABLES = [
  "cp2_model_preferences",
  "cp2_runtime_hosts",
  "cp2_runtime_model_installations"
] as const;
