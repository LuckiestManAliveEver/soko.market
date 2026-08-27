import type { ExecutionPlan, PlannerError } from "./types.js";

/**
 * Phase 2 (docs/architecture/agent-execution-fabric-phase2.md §6). A pure mapping from a finished
 * `ExecutionPlan` to one typed `PlannerError`, or `null` when the plan produced a usable selection.
 * This never invents a plain-English message - that belongs to whichever UI layer (server route,
 * web app) is closest to the user and knows how to phrase it for its surface; this function only
 * hands back a stable, machine-readable code and the most relevant model/host id so a caller never
 * has to re-derive "why did this plan fail" from `plan.rejected` by hand.
 */
export function describePlannerOutcome(plan: ExecutionPlan): PlannerError | null {
  if (plan.selected !== null) return null;

  if (plan.rejected.length === 0) {
    return { code: "NO_COMPATIBLE_MODEL", modelId: null, hostId: null };
  }

  const allHostOffline = plan.rejected.every(
    (candidate) => candidate.rejectionReason === "HOST_OFFLINE"
  );
  if (allHostOffline) {
    const first = plan.rejected[0]!;
    return { code: "NO_RUNTIME_HOST", modelId: first.modelId, hostId: first.hostId };
  }

  // Prefer the most specific/actionable single reason: the first rejection recorded is the first
  // candidate the caller is likely to have expected to work.
  const first = plan.rejected[0]!;
  return { code: first.rejectionReason, modelId: first.modelId, hostId: first.hostId };
}
