/**
 * Phase 2 (docs/architecture/agent-execution-fabric-phase2.md §1). Mirrors the simplest existing
 * client flag precedent (browser-model-registry.ts's `browserLocalInferenceDeploymentEnabled`) -
 * a single module-level constant read once from Vite's `import.meta.env`, defaulting to disabled
 * whenever the variable is unset or anything other than the literal string "true".
 */
export const executionFabricEnabled: boolean =
  import.meta.env.VITE_EXECUTION_FABRIC_ENABLED === "true";
