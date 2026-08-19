import type { LocalAiModel } from "./ai-model-manager";
import type { AgentSettings, AiModelSummary } from "./soko-application-shared";

export interface AgentIdentityPanelProps {
  draftAgent: AgentSettings;
  isEditing: boolean;
  updateAgent: (patch: Partial<AgentSettings>) => void;
  activeAiModelId: string;
  activeInstalledModel: LocalAiModel | null;
  activeAiModel: AiModelSummary | undefined;
}

export function AgentIdentityPanel({
  draftAgent,
  isEditing,
  updateAgent,
  activeAiModelId,
  activeInstalledModel,
  activeAiModel
}: AgentIdentityPanelProps) {
  return (
    <div className="record-form">
      <div className="section-heading">
        <p className="eyebrow">Identity</p>
        <h3>Agent profile</h3>
      </div>
      <label>
        Agent name
        <input
          value={draftAgent.name}
          disabled={!isEditing}
          onChange={(event) => updateAgent({ name: event.target.value })}
        />
      </label>
      <label>
        Description
        <textarea
          value={draftAgent.description}
          disabled={!isEditing}
          onChange={(event) => updateAgent({ description: event.target.value })}
          rows={3}
        />
      </label>
      <label>
        Current conversational model
        <input
          value={activeInstalledModel?.displayName ?? activeAiModel?.label ?? activeAiModelId}
          disabled
          aria-label="Current conversational model"
        />
        <small className="model-select-hint">
          The selected model is synchronized with the backend. Local models become ready only after
          backend validation and a real runtime test succeed.
        </small>
      </label>
      <label>
        Agent role
        <input
          value={draftAgent.role}
          disabled={!isEditing}
          onChange={(event) => updateAgent({ role: event.target.value })}
        />
      </label>
    </div>
  );
}
