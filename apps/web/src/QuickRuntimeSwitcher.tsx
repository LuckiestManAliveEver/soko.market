import { useEffect, useState } from "react";

import type {
  AgentModelActivationResult,
  AgentModelBindingSummary,
  AgentRuntimeAdapterDescriptor
} from "@soko/shared-types";

import { getJson, postJson } from "./api-helpers";
import { getErrorMessage } from "./chat-message-plumbing";
import type { ActiveBusiness, AgentSettings, AiModelSummary } from "./soko-application-shared";

export interface QuickRuntimeSwitcherProps {
  business: ActiveBusiness;
  agent: AgentSettings;
  updateAgent: (patch: Partial<AgentSettings>) => void;
  onAgentChange: (agent: AgentSettings) => void;
}

/**
 * The common-case "pick one and go" surface for the two runtime dimensions that had no simple
 * selector at all: which harness (AgentRuntimeAdapter) and which backend-hosted model run this
 * shop's agent. Selecting either activates the change immediately through the same
 * POST /api/agents/:agentId/models/:modelId/activate endpoint AgentModelPanel's advanced flow
 * uses - this is a thinner front door onto it, not a second activation path. Models that require a
 * device download (offline/local/custom GGUF) intentionally stay out of this list; that download
 * step is a hardware reality no dropdown can skip, and AgentModelPanel's advanced section below
 * still handles it.
 */
export function QuickRuntimeSwitcher({
  business,
  agent,
  updateAgent,
  onAgentChange
}: QuickRuntimeSwitcherProps) {
  const canonicalAgentId = business.id;
  const [harnessOptions, setHarnessOptions] = useState<AgentRuntimeAdapterDescriptor[]>([]);
  const [selectedHarnessId, setSelectedHarnessId] = useState("");
  const [modelOptions, setModelOptions] = useState<AiModelSummary[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [adaptersResponse, harnessResponse, modelsResponse, bindingResponse] =
          await Promise.all([
            getJson<{ adapters: AgentRuntimeAdapterDescriptor[] }>(
              "/v1/platform/agent-runtime-adapters"
            ),
            getJson<{ agentRuntimeAdapterId: string }>(
              `/api/agents/${canonicalAgentId}/harness?shopId=${business.id}`
            ),
            getJson<{ models: AiModelSummary[] }>("/v1/ai-models"),
            getJson<{ binding: AgentModelBindingSummary | null }>(
              `/api/agents/${canonicalAgentId}/model-binding?shopId=${business.id}`
            )
          ]);
        if (cancelled) return;
        const backendModels = modelsResponse.models.filter(
          (model) => model.runtimeAvailability?.backend === "configured"
        );
        setHarnessOptions(adaptersResponse.adapters);
        setSelectedHarnessId(harnessResponse.agentRuntimeAdapterId);
        setModelOptions(backendModels);
        setSelectedModelId(
          bindingResponse.binding?.modelId ??
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

  async function activate(change: { modelId?: string; agentRuntimeAdapterId?: string }) {
    const modelId = change.modelId ?? selectedModelId;
    if (busy || modelId === "") return;
    setBusy(true);
    setMessage("Switching…");
    try {
      const result = await postJson<AgentModelActivationResult>(
        `/api/agents/${canonicalAgentId}/models/${encodeURIComponent(modelId)}/activate`,
        {
          shopId: business.id,
          executionTarget: "backend",
          executionMode: "LOCAL_FIRST",
          ...(change.agentRuntimeAdapterId === undefined
            ? {}
            : { agentRuntimeAdapterId: change.agentRuntimeAdapterId }),
          permissions: { allowInstalledApp: false, allowRemoteShopDevice: false }
        }
      );
      setSelectedModelId(result.binding.modelId);
      if (change.agentRuntimeAdapterId !== undefined) {
        setSelectedHarnessId(change.agentRuntimeAdapterId);
      }
      updateAgent({ model: result.binding.modelId });
      onAgentChange({ ...agent, model: result.binding.modelId });
      const harnessLabel =
        harnessOptions.find(
          (option) => option.id === (change.agentRuntimeAdapterId ?? selectedHarnessId)
        )?.displayName ??
        change.agentRuntimeAdapterId ??
        selectedHarnessId;
      const modelLabel = modelOptions.find((option) => option.id === modelId)?.label ?? modelId;
      setMessage(`${harnessLabel} is now running ${modelLabel}.`);
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
        <h3>Harness and model</h3>
        <p>Pick a registered harness and a hosted model. Changes apply immediately.</p>
      </div>
      {message.length > 0 ? (
        <p className="shell-note" role="status" aria-live="polite">
          {message}
        </p>
      ) : null}
      <div className="runtime-field-grid">
        <label>
          Harness
          <select
            value={selectedHarnessId}
            disabled={busy || harnessOptions.length === 0}
            onChange={(event) => void activate({ agentRuntimeAdapterId: event.target.value })}
          >
            {harnessOptions.map((option) => (
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
            onChange={(event) => void activate({ modelId: event.target.value })}
          >
            {modelOptions.length === 0 ? (
              <option value="">No hosted model configured</option>
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
