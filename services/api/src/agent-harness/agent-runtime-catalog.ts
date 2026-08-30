import type { AgentRuntimeAdapterDescriptor } from "@soko/shared-types";

/**
 * Human-readable metadata for registered AgentRuntimeAdapter ids, kept separate from the adapters
 * themselves (agent-runtime-adapter.ts) so the execution interface never carries display concerns.
 * An id with no entry here still lists - it just falls back to its raw id as the label.
 */
const knownAdapterDescriptions: Record<
  string,
  Pick<AgentRuntimeAdapterDescriptor, "displayName" | "description">
> = {
  pi: {
    displayName: "Pi",
    description:
      "MIT-licensed agent-loop harness (@earendil-works/pi-agent-core). The hosted-first platform default."
  },
  soko: {
    displayName: "Soko (built-in)",
    description: "Soko's original built-in orchestration path, kept for rollback and compatibility."
  }
};

export function describeAgentRuntimeAdapter(id: string): AgentRuntimeAdapterDescriptor {
  const known = knownAdapterDescriptions[id];
  return {
    id,
    displayName: known?.displayName ?? id,
    description: known?.description ?? "Registered agent runtime adapter."
  };
}
