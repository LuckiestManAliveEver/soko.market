import type { AgentContextSource } from "@soko/shared-types";

import type { AgentSettings } from "./soko-application-shared";

export interface AgentRuntimeAccessPanelProps {
  draftAgent: AgentSettings;
  isEditing: boolean;
  updateAgent: (patch: Partial<AgentSettings>) => void;
  runtimeContextSources: AgentContextSource[];
  runtimeDetailsLoading: boolean;
}

export function AgentRuntimeAccessPanel({
  draftAgent,
  isEditing,
  updateAgent,
  runtimeContextSources,
  runtimeDetailsLoading
}: AgentRuntimeAccessPanelProps) {
  return (
    <div className="record-form agent-runtime-panel">
      <div className="section-heading">
        <p className="eyebrow">Context manifest and executable skills</p>
        <h3>Runtime access</h3>
        <p>
          Context is retrieved only when relevant and authorized. Skill availability is independent
          of the active model.
        </p>
      </div>
      <div className="runtime-context-list">
        {runtimeContextSources.map((source) => (
          <article key={source.id}>
            <div>
              <strong>{source.title}</strong>
              <small>
                {source.type} · {source.sensitivity} · version {source.version}
              </small>
            </div>
            <span className={`model-badge ${source.status === "active" ? "status-ready" : ""}`}>
              {source.status}
            </span>
          </article>
        ))}
        {!runtimeDetailsLoading && runtimeContextSources.length === 0 ? (
          <p className="shell-note">No authorized context sources are available yet.</p>
        ) : null}
      </div>
      <div className="runtime-skill-list">
        {draftAgent.skillBindings.map((binding) => (
          <label className="checkbox-row" key={binding.skillId}>
            <input
              type="checkbox"
              checked={binding.enabled}
              disabled={!isEditing}
              onChange={(event) =>
                updateAgent({
                  skillBindings: draftAgent.skillBindings.map((candidate) =>
                    candidate.skillId === binding.skillId
                      ? { ...candidate, enabled: event.target.checked }
                      : candidate
                  )
                })
              }
            />
            <span>
              <strong>{binding.skillId}</strong>
              <small>
                v{binding.version} · confirmation {binding.requiredConfirmationLevel}
              </small>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
