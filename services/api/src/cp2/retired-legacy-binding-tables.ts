// The only file production application code may name a retired legacy-binding table in.
// scripts/check-retired-runtime-references.mjs allowlists this exact path (and nothing else) so
// it can name these strings in order to detect and forbid them, without that declaration counting
// as the forbidden reference it exists to catch. Everything else that needs to recognize one of
// these names imports this constant instead of repeating the literal.
//
// Distinct from RETIRED_EXECUTION_FABRIC_TABLES (retired-execution-fabric-tables.ts) - these three
// predate that generation entirely: cp2_agent_model_assignments (035) and
// cp2_browser_inference_assignments (041) were superseded by cp2_agent_model_bindings (040) and
// the per-device browser-inference architecture respectively, and were already dead in application
// code (zero reads/writes) well before this consolidation - see infra/db/migrations/
// 075_drop_dead_runtime_assignment_tables.sql. cp2_agent_model_bindings itself was the last
// remaining legacy runtime-binding representation - AgentRuntimeDomain read/wrote it directly
// until this consolidation made NativeRuntimeBindingStore (cp2/domains/native-runtime/store.ts)
// the sole source of truth; see infra/db/migrations/076_drop_legacy_agent_model_bindings.sql,
// which backfills (via scripts/backfill-native-runtime-bindings.mjs) then drops it.
export const RETIRED_LEGACY_BINDING_TABLES = [
  "cp2_agent_model_assignments",
  "cp2_browser_inference_assignments",
  "cp2_agent_model_bindings"
] as const;
