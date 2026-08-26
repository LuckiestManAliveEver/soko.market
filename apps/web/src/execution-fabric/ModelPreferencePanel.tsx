import { useEffect, useState } from "react";
import type { ModelPreferenceSummary } from "@soko/shared-types";
import { getJson, putJson } from "../api-helpers";
import type { AiModelSummary } from "../soko-application-shared";

type ModelChoice = "automatic" | "fast" | "balanced" | "best" | string;
type RunOnChoice = "automatic" | "this-device";

interface ModelPreferencePanelProps {
  businessId: string;
  agentName: string;
  availableModels: AiModelSummary[];
}

/**
 * Phase 2 (docs/architecture/agent-execution-fabric-phase2.md §5). The corrected "Use with Agent"
 * surface: writes a `ModelPreference` (PUT /businesses/:id/model-preference) instead of the legacy
 * device-specific permanent binding the "Use with agent" button above still writes. Deliberately a
 * separate, additive section rather than a replacement of that legacy button in this pass - see
 * the Phase 2 report for why retiring the legacy button itself is a named follow-up, not silently
 * done here. Rendered only when the client execution-fabric flag is on (the caller checks this),
 * so with the flag off - the default everywhere, including production - this component never
 * mounts and the existing panel is pixel-for-pixel unchanged.
 *
 * "Out of scope this phase" (§5): "Run on" only ever offers Automatic/This device - there is no
 * other executable host yet (browser-local and backend/cloud are the only RuntimeAdapters that
 * exist; remote shop devices get a real adapter in Phase 3), so no other option is presented.
 */
export function ModelPreferencePanel({ businessId, agentName, availableModels }: ModelPreferencePanelProps) {
  const [current, setCurrent] = useState<ModelPreferenceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelChoice, setModelChoice] = useState<ModelChoice>("automatic");
  const [runOn, setRunOn] = useState<RunOnChoice>("automatic");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getJson<ModelPreferenceSummary | null>(`/businesses/${businessId}/model-preference`)
      .then((preference) => {
        if (cancelled) return;
        setCurrent(preference);
        if (preference !== null) {
          setRunOn(preference.executionPreference === "local-first" ? "this-device" : "automatic");
          setModelChoice(
            preference.preferredModelIds.length === 1 &&
              preference.qualityPreference === "balanced" &&
              preference.preferredModelIds[0] !== undefined &&
              availableModels.some((model) => model.id === preference.preferredModelIds[0])
              ? preference.preferredModelIds[0]!
              : preference.qualityPreference
          );
        }
      })
      .catch(() => setCurrent(null))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [businessId, availableModels]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const isSpecificModel = availableModels.some((model) => model.id === modelChoice);
      const qualityPreference =
        modelChoice === "fast" ? "fastest" : modelChoice === "best" ? "best" : "balanced";
      const preferredModelIds = isSpecificModel
        ? [modelChoice]
        : availableModels.map((model) => model.id);
      const updated = await putJson<ModelPreferenceSummary>(
        `/businesses/${businessId}/model-preference`,
        {
          preferredModelIds,
          fallbackModelIds: [],
          requiredCapabilities: [],
          executionPreference: runOn === "this-device" ? "local-first" : "balanced",
          qualityPreference,
          allowCloudFallback: runOn !== "this-device",
          maxCostPerRequest: null,
          maxLatencyMs: null,
          minimumContextWindow: null
        }
      );
      setCurrent(updated);
    } catch {
      setError("Could not save the model preference. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-label="Model preference">
      <div className="section-subheading">
        <h4>Model preference</h4>
        <p>
          Sets how {agentName} picks a model for each reply - this replaces choosing one fixed
          model with a preference the Execution Planner resolves per turn.
        </p>
      </div>
      {loading ? (
        <p>Loading current preference…</p>
      ) : (
        <div className="model-preference-controls">
          <label>
            Model
            <select value={modelChoice} onChange={(event) => setModelChoice(event.target.value)}>
              <option value="automatic">Automatic</option>
              <option value="fast">Fast</option>
              <option value="balanced">Balanced</option>
              <option value="best">Best available</option>
              {availableModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Run on
            <select
              value={runOn}
              onChange={(event) => setRunOn(event.target.value as RunOnChoice)}
            >
              <option value="automatic">Automatic</option>
              <option value="this-device">This device</option>
            </select>
          </label>
          <button type="button" disabled={saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save preference"}
          </button>
          {error !== null ? <small role="status">{error}</small> : null}
          {current !== null ? (
            <small>
              Currently: {current.executionPreference} · {current.qualityPreference}
            </small>
          ) : null}
        </div>
      )}
    </section>
  );
}
