import { useEffect, useState } from "react";

import type {
  AgentDefinition,
  AgentModelActivationResult,
  EffectiveRuntimeSummary
} from "@soko/shared-types";

import { getJson, postJson, putJson } from "./api-helpers";
import { getErrorMessage } from "./chat-message-plumbing";
import { buildAgentProfileUpdate } from "./agent-profile-payload";
import { agentSettingsFromBusinessProfile } from "./owner-app-bootstrap";
import type {
  ActiveBusiness,
  AgentSettings,
  AiModelSummary,
  BusinessAgentProfileSummary
} from "./soko-application-shared";

export interface QuickRuntimeSwitcherProps {
  business: ActiveBusiness;
  agent: AgentSettings;
  updateAgent: (patch: Partial<AgentSettings>) => void;
  onAgentChange: (agent: AgentSettings) => void;
}

/**
 * The common-case "pick one and go" surface for the two runtime dimensions that had no simple
 * selector at all: which built-in agent definition (which also fixes which engine runs it - see
 * AgentDefinition.runtimeAdapterId) and which backend-hosted model run this shop's agent. Engine
 * choice is no longer its own dimension: picking a different agent definition is how a shop swaps
 * engines, the same way GitHub/HuggingFace-imported definitions are picked for personality - so
 * this only lists builtin:* definitions, leaving discovery of imported ones to AgentModelPanel's
 * advanced flow below. Selecting a model activates immediately through the same
 * POST /api/agents/:agentId/models/:modelId/activate endpoint AgentModelPanel's advanced flow uses
 * - this is a thinner front door onto it, not a second activation path. Selecting an agent updates
 * the business's agent profile (PUT /businesses/:businessId/agent-profile) instead, since engine
 * choice now travels with the whole agent definition, not a standalone activation parameter.
 * Models that require a device download (offline/local/custom GGUF) intentionally stay out of this
 * list; that download step is a hardware reality no dropdown can skip, and AgentModelPanel's
 * advanced section below still handles it.
 */
export function QuickRuntimeSwitcher({
  business,
  agent,
  updateAgent,
  onAgentChange
}: QuickRuntimeSwitcherProps) {
  const canonicalAgentId = business.id;
  const [agentOptions, setAgentOptions] = useState<AgentDefinition[]>([]);
  const [selectedAgentDefinitionId, setSelectedAgentDefinitionId] = useState("");
  const [modelOptions, setModelOptions] = useState<AiModelSummary[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [catalogResponse, modelsResponse, effectiveRuntime] = await Promise.all([
          getJson<{ agents: AgentDefinition[] }>("/v1/platform/agent-catalog"),
          getJson<{ models: AiModelSummary[] }>("/v1/ai-models"),
          getJson<EffectiveRuntimeSummary>(`/businesses/${business.id}/runtime/effective`)
        ]);
        if (cancelled) return;
        const backendModels = modelsResponse.models.filter(
          (model) => model.runtimeAvailability?.backend === "configured"
        );
        setAgentOptions(catalogResponse.agents.filter((entry) => entry.id.startsWith("builtin:")));
        setSelectedAgentDefinitionId(effectiveRuntime.agent.id);
        setModelOptions(backendModels);
        setSelectedModelId(
          effectiveRuntime.model.id ??
            backendModels.find((model) => model.recommended)?.id ??
            backendModels[0]?.id ??
            ""
        );
      } catch (error) {
        if (!cancelled) setMessage(getErrorMessage(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [canonicalAgentId, business.id]);

  async function activateModel(modelId: string) {
    if (busy || modelId === "") return;
    setBusy(true);
    setMessage("Switching…");
    try {
      const result = await postJson<AgentModelActivationResult>(
        `/api/agents/${canonicalAgentId}/models/${encodeURIComponent(modelId)}/activate`,
        {
          shopId: business.id,
          executionTarget: "vercel",
          executionMode: "LOCAL_FIRST",
          permissions: { allowInstalledApp: false, allowRemoteShopDevice: false },
          ...(modelId === "smollm2-360m" ? {} : { costResponsibility: "merchant" })
        }
      );
      setSelectedModelId(result.binding.modelId);
      updateAgent({ model: result.binding.modelId });
      onAgentChange({ ...agent, model: result.binding.modelId });
      const modelLabel = modelOptions.find((option) => option.id === modelId)?.label ?? modelId;
      setMessage(`Now running ${modelLabel}.`);
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function activateAgentDefinition(agentDefinitionId: string) {
    if (busy || agentDefinitionId === "") return;
    setBusy(true);
    setMessage("Switching…");
    try {
      const saved = await putJson<BusinessAgentProfileSummary>(
        `/businesses/${business.id}/agent-profile`,
        buildAgentProfileUpdate({
          ...agent,
          agentDefinitionId: agentDefinitionId as AgentDefinition["id"]
        })
      );
      const updated = agentSettingsFromBusinessProfile(saved, business);
      setSelectedAgentDefinitionId(agentDefinitionId);
      updateAgent(updated);
      onAgentChange(updated);
      const agentLabel =
        agentOptions.find((option) => option.id === agentDefinitionId)?.displayName ??
        agentDefinitionId;
      setMessage(`Now running as ${agentLabel}.`);
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="record-form quick-runtime-switcher">
        <p className="shell-note">Loading runtime options…</p>
      </div>
    );
  }

  return (
    <div className="record-form quick-runtime-switcher">
      <div className="section-heading">
        <p className="eyebrow">Quick switch</p>
        <h3>Agent and model</h3>
        <p>Pick an agent and a hosted model. Changes apply immediately.</p>
      </div>
      {message.length > 0 ? (
        <p className="shell-note" role="status" aria-live="polite">
          {message}
        </p>
      ) : null}
      <div className="runtime-field-grid">
        <label>
          Agent
          <select
            value={selectedAgentDefinitionId}
            disabled={busy || agentOptions.length === 0}
            onChange={(event) => void activateAgentDefinition(event.target.value)}
          >
            {agentOptions.map((option) => (
              <option key={option.id} value={option.id} title={option.description}>
                {option.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Model
          <select
            value={selectedModelId}
            disabled={busy || modelOptions.length === 0}
            onChange={(event) => void activateModel(event.target.value)}
          >
            {modelOptions.length === 0 ? (
              <option value="">No executable backend model</option>
            ) : null}
            {modelOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
