// TODO(remove-after-fabric-migration): used only by legacy Fabric host reconciliation.
import type { RuntimeHostSummary, RuntimeModelInstallationSummary } from "@soko/shared-types";
import type { RuntimeHostCandidateInput } from "@soko/execution-planner";

import type { OwnerNodeBroker } from "../../../inference/owner-node-broker.js";

/**
 * Bridges a durable RuntimeHostSummary (ExecutionFabricStore) with the OwnerNodeBroker's transient
 * in-memory presence (services/api/src/inference/owner-node-broker.ts) to produce the
 * RuntimeHostCandidateInput shape the planner expects - "online" is computed here, at call time,
 * from broker.listPresence(), and is never written back onto the RuntimeHostSummary record. This
 * is the one place liveness and identity meet; per docs/inference/owner-node.md:32, no persistent
 * heartbeat column exists anywhere for this to read instead.
 *
 * `availableMemoryGb`/`warmModelIds` are not tracked by OwnerNodeBroker today (it has no memory or
 * warm-model concept, only nodeId/agentIds/supportedModelIds/maxConcurrentJobs) - both are left
 * `null`/`[]` for a broker-backed host until a future phase extends the broker's presence payload
 * with that data. Passing them as explicit optional overrides here (rather than inventing a second
 * broker call) keeps this function honest about what the broker can and cannot answer today.
 */
export function runtimeHostCandidateInput(input: {
  host: RuntimeHostSummary;
  installations: RuntimeModelInstallationSummary[];
  broker: OwnerNodeBroker;
  tenantId: string;
  availableMemoryGb?: number | null;
  warmModelIds?: string[];
}): RuntimeHostCandidateInput {
  const presences = input.broker.listPresence(input.tenantId);
  const online =
    input.host.brokerNodeId !== null &&
    presences.some((presence) => presence.nodeId === input.host.brokerNodeId);
  return {
    host: input.host,
    installations: input.installations,
    online,
    warmModelIds: input.warmModelIds ?? [],
    availableMemoryGb: input.availableMemoryGb ?? null
  };
}
