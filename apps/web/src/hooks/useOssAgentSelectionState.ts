import { useEffect, useRef } from "react";

import type { AgentRuntimeReadiness, OssAgentSearchResult } from "@soko/shared-types";

import { getJson, putJson } from "../api-helpers";
import { applyOssAgent, rankOssAgentsForDevice, selectLeastMemoryOssAgent } from "../agent-catalog";
import { buildAgentProfileUpdate } from "../agent-profile-payload";
import { getOrCreateDeviceModelScopeId, inspectDeviceModelCapability } from "../ai-model-manager";
import {
  installOssAgentManifest,
  linkInstalledOssAgent,
  readDeviceOssAgentBinding
} from "../oss-agent-installation";
import { agentSettingsFromBusinessProfile } from "../owner-app-bootstrap";
import type {
  ActiveBusiness,
  AgentSettings,
  BusinessAgentProfileSummary,
  SessionResponse
} from "../soko-application-shared";

interface UseOssAgentSelectionStateDeps {
  agentSettings: AgentSettings;
  setAgentSettings: (settings: AgentSettings) => void;
  business: ActiveBusiness | null;
  session: SessionResponse | null;
  isOnline: boolean;
  setupComplete: boolean;
  setStatusMessage: (message: string) => void;
}

/**
 * Once a business is fully set up and online, picks (or resumes) a hardware-appropriate OSS
 * agent for this device: honors an already-assigned non-default agent profile, otherwise ranks
 * GitHub/Hugging Face candidates against this device's model capability and links the
 * lowest-memory compatible match. Runs at most once per (account, business) pair per mount, via
 * automaticAgentSelectionRef.
 */
export function useOssAgentSelectionState(deps: UseOssAgentSelectionStateDeps): void {
  const automaticAgentSelectionRef = useRef(new Set<string>());
  const {
    agentSettings,
    setAgentSettings,
    business,
    session,
    isOnline,
    setupComplete,
    setStatusMessage
  } = deps;

  useEffect(() => {
    if (!setupComplete || !isOnline || session === null || business === null) {
      return;
    }

    const selectionKey = `${session.account.id}:${business.id}`;
    if (automaticAgentSelectionRef.current.has(selectionKey)) return;
    automaticAgentSelectionRef.current.add(selectionKey);
    let cancelled = false;
    let completed = false;

    void (async () => {
      const profile = await getJson<BusinessAgentProfileSummary>(
        `/businesses/${business.id}/agent-profile`
      );
      if (profile.agentDefinitionId !== "builtin:shopkeeper") {
        if (!cancelled) setAgentSettings(agentSettingsFromBusinessProfile(profile, business));
        const deviceId = getOrCreateDeviceModelScopeId();
        const binding = readDeviceOssAgentBinding(business.id, deviceId);
        if (binding?.agentDefinitionId === profile.agentDefinitionId) {
          completed = true;
          return;
        }
        const separator = profile.agentDefinitionId.indexOf(":");
        const source = profile.agentDefinitionId.slice(0, separator);
        const sourceId = profile.agentDefinitionId.slice(separator + 1);
        const catalogue = await getJson<OssAgentSearchResult>(
          `/v1/oss-agents/${source}?search=${encodeURIComponent(sourceId)}`
        );
        const selected = catalogue.agents.find(
          (candidate) => candidate.id === profile.agentDefinitionId && candidate.licenseVerified
        );
        if (selected !== undefined) {
          installOssAgentManifest(selected);
          linkInstalledOssAgent({
            businessId: business.id,
            deviceId,
            agentDefinitionId: selected.id
          });
          completed = true;
        }
        return;
      }

      const [capability, readiness, github, huggingFace] = await Promise.all([
        inspectDeviceModelCapability(),
        getJson<AgentRuntimeReadiness>(`/businesses/${business.id}/agent-runtime/readiness`),
        getJson<OssAgentSearchResult>("/v1/oss-agents/github"),
        getJson<OssAgentSearchResult>("/v1/oss-agents/huggingface")
      ]);
      const agents = new Map(
        [...huggingFace.agents, ...github.agents].map((candidate) => [candidate.id, candidate])
      );
      const selected = selectLeastMemoryOssAgent(
        rankOssAgentsForDevice({
          agents: [...agents.values()],
          capability,
          backendAvailable: readiness.ready
        })
      );
      if (selected === null) return;

      installOssAgentManifest(selected.agent);
      const nextAgent = applyOssAgent(
        agentSettingsFromBusinessProfile(profile, business),
        selected.agent
      );
      const saved = await putJson<BusinessAgentProfileSummary>(
        `/businesses/${business.id}/agent-profile`,
        buildAgentProfileUpdate(nextAgent)
      );
      linkInstalledOssAgent({
        businessId: business.id,
        deviceId: getOrCreateDeviceModelScopeId(),
        agentDefinitionId: saved.agentDefinitionId
      });
      completed = true;
      if (!cancelled) {
        setAgentSettings(agentSettingsFromBusinessProfile(saved, business));
        setStatusMessage(
          `${selected.agent.label} was downloaded as the lowest-memory compatible agent and linked to chat.`
        );
      }
    })()
      .catch(() => {
        // Discovery, storage, or persistence failures leave the safe built-in fallback active.
      })
      .finally(() => {
        if (!completed) automaticAgentSelectionRef.current.delete(selectionKey);
      });

    return () => {
      cancelled = true;
    };
    // Mirrors the original OwnerApp effect, which intentionally keyed off business?.id and
    // session?.account.id only - listing the full business/session objects (or setAgentSettings/
    // setStatusMessage from a fresh deps object each render) would re-run this effect, and
    // re-trigger a network round trip and possible agent reassignment, on every unrelated
    // business/session field change instead of only on an actual account/business switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentSettings.agentDefinitionId, business?.id, isOnline, session?.account.id, setupComplete]);
}
