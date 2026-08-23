import type { AgentDefinitionId } from "@soko/shared-types";

export interface DownloadedAgentModelState {
  linkedAgentDefinitionId: AgentDefinitionId | null;
  activeAgentDefinitionId: AgentDefinitionId;
  installedGgufReady: boolean;
  cachedBrowserModelReady: boolean;
}

/**
 * A linked OSS agent with ready model weights is a browser-owned runtime. The API may still
 * authorize tools and persist messages, but it must not infer on behalf of this local binding.
 */
export function downloadedAgentModelMustStayLocal(input: DownloadedAgentModelState): boolean {
  return (
    input.linkedAgentDefinitionId === input.activeAgentDefinitionId &&
    (input.installedGgufReady || input.cachedBrowserModelReady)
  );
}
