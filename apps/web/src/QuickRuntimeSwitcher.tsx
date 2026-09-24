import { useEffect, useState } from "react";

import {
  platformSharedModelId,
  type AgentDefinition,
  type AgentModelActivationResult,
  type EffectiveRuntimeSummary
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
  // Set only while a merchant-funded model switch is awaiting explicit confirmation - the request
  // to actually activate it never fires until the merchant confirms, so a merchant can never be
  // switched onto a billable model by a single accidental selection. The platform-included default
  // (smollm2-360m) skips this entirely and activates immediately, matching its free/no-charge cost
  // responsibility.
  const [pendingCostConfirmationModelId, setPendingCostConfirmationModelId] = useState<
    string | null
  >(null);

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

  /**
   * The single entry point the <select> calls. A merchant-funded model (anything but the
   * platform-included smollm2-360m default) never activates from this call alone - it only opens
   * the inline confirmation below, and reverts the dropdown to whatever is actually active so nothing
   * appears switched until the merchant explicitly confirms. Returning to the platform default
   * always activates immediately, since it can never incur a charge.
   */
  function requestModelChange(modelId: string) {
    if (busy || modelId === "" || modelId === selectedModelId) return;
    const isMerchantFunded = modelId !== platformSharedModelId;
    if (!isMerchantFunded) {
      void activateModel(modelId);
      return;
    }
    setPendingCostConfirmationModelId(modelId);
  }

  function cancelCostConfirmation() {
    setPendingCostConfirmationModelId(null);
  }

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
          ...(modelId === platformSharedModelId ? {} : { costResponsibility: "merchant" })
        }
      );
      setSelectedModelId(result.binding.modelId);
      setPendingCostConfirmationModelId(null);
      updateAgent({ model: result.binding.modelId });
      onAgentChange({ ...agent, model: result.binding.modelId });
      const modelLabel = modelOptions.find((option) => option.id === modelId)?.label ?? modelId;
      setMessage(`Model changed to ${modelLabel}.`);
    } catch (error) {
      // Failed switching preserves the previous binding - selectedModelId is only ever updated
      // above, on confirmed success, so the <select> already reflects the still-active model.
      setPendingCostConfirmationModelId(null);
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
        <p>
          Pick an agent and a hosted model. The platform default applies immediately; a
          merchant-funded model asks you to confirm first.
        </p>
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
            onChange={(event) => requestModelChange(event.target.value)}
          >
            {modelOptions.length === 0 ? (
              <option value="">No executable backend model</option>
            ) : null}
            {modelOptions.map((option) => (
              <option key={option.id} value={option.id} title={modelOptionTitle(option)}>
                {option.label}
                {option.id === platformSharedModelId ? " (platform default)" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      {(() => {
        const activeModel = modelOptions.find((option) => option.id === selectedModelId);
        return activeModel === undefined ? null : (
          <p className="shell-note quick-runtime-model-detail">
            Provider: {activeModel.provider}. Billing:{" "}
            {activeModel.id === platformSharedModelId
              ? "included with the platform, no extra charge."
              : "merchant-funded - your business is billed for usage."}
          </p>
        );
      })()}
      {pendingCostConfirmationModelId !== null ? (
        <div className="shell-note quick-runtime-cost-confirmation" role="alertdialog">
          <p>
            {modelOptions.find((option) => option.id === pendingCostConfirmationModelId)?.label ??
              pendingCostConfirmationModelId}{" "}
            is merchant-funded through{" "}
            {modelOptions.find((option) => option.id === pendingCostConfirmationModelId)
              ?.provider ?? "its provider"}
            . Your business will be billed for its inference usage instead of the platform-included
            default. Switch anyway?
          </p>
          <div className="quick-runtime-cost-confirmation-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => void activateModel(pendingCostConfirmationModelId)}
            >
              Confirm switch
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={cancelCostConfirmation}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function modelOptionTitle(option: AiModelSummary): string {
  const billing =
    option.id === platformSharedModelId
      ? "platform-included"
      : "merchant-funded (usage billed to you)";
  return `${option.provider} · ${billing}`;
}
