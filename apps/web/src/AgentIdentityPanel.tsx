import { type FormEvent, useEffect, useState } from "react";
import type { OssAgentSearchResult, OssAgentSummary } from "@soko/shared-types";

import type { DeviceModelCapability, LocalAiModel } from "./ai-model-manager";
import { applyOssAgent, rankOssAgentsForDevice } from "./agent-catalog";
import { getJson } from "./api-helpers";
import { listInstalledOssAgentManifests } from "./oss-agent-installation";
import { hydrateAccountOssAgentManifests, installOssAgentForAccount } from "./account-ai-assets";
import type { AgentSettings, AiModelSummary } from "./soko-application-shared";

export interface AgentIdentityPanelProps {
  draftAgent: AgentSettings;
  isEditing: boolean;
  updateAgent: (patch: Partial<AgentSettings>) => void;
  activeAiModelId: string;
  activeInstalledModel: LocalAiModel | null;
  activeAiModel: AiModelSummary | undefined;
  deviceCapability: DeviceModelCapability | null;
  backendAvailable: boolean;
}

export function AgentIdentityPanel({
  draftAgent,
  isEditing,
  updateAgent,
  activeAiModelId,
  activeInstalledModel,
  activeAiModel,
  deviceCapability,
  backendAvailable
}: AgentIdentityPanelProps) {
  const [agentSearch, setAgentSearch] = useState("");
  const [agents, setAgents] = useState<OssAgentSummary[]>([]);
  const [catalogueMessage, setCatalogueMessage] = useState("Loading open-source agents…");
  const [catalogueLoading, setCatalogueLoading] = useState(true);
  const [installedAgentIds, setInstalledAgentIds] = useState(
    () => new Set(listInstalledOssAgentManifests().map((manifest) => manifest.agent.id))
  );

  useEffect(() => {
    void loadOssAgents();
  }, []);

  async function loadOssAgents(search?: string) {
    setCatalogueLoading(true);
    const query = search?.trim();
    const suffix = query ? `?search=${encodeURIComponent(query)}` : "";
    try {
      const [github, huggingFace, accountManifests] = await Promise.all([
        getJson<OssAgentSearchResult>(`/v1/oss-agents/github${suffix}`).catch(() => ({
          agents: [],
          status: "unavailable" as const,
          connection: "public" as const,
          message: "GitHub discovery is unavailable."
        })),
        getJson<OssAgentSearchResult>(`/v1/oss-agents/huggingface${suffix}`).catch(() => ({
          agents: [],
          status: "unavailable" as const,
          connection: "public" as const,
          message: "Hugging Face discovery is unavailable."
        })),
        hydrateAccountOssAgentManifests().catch(() => [])
      ]);
      const merged = new Map<string, OssAgentSummary>();
      for (const item of [
        ...accountManifests.map((manifest) => manifest.agent),
        ...huggingFace.agents,
        ...github.agents
      ]) {
        merged.set(item.id, item);
      }
      setAgents([...merged.values()]);
      setInstalledAgentIds(
        new Set([
          ...listInstalledOssAgentManifests().map((manifest) => manifest.agent.id),
          ...accountManifests.map((manifest) => manifest.agent.id)
        ])
      );
      setCatalogueMessage(`${huggingFace.message} ${github.message}`);
    } catch {
      setAgents([]);
      setCatalogueMessage("Open-source agent discovery is temporarily unavailable.");
    } finally {
      setCatalogueLoading(false);
    }
  }

  function searchAgents(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadOssAgents(agentSearch);
  }

  async function downloadAndSelectAgent(definition: OssAgentSummary) {
    try {
      await installOssAgentForAccount(definition);
      setInstalledAgentIds(
        new Set(listInstalledOssAgentManifests().map((manifest) => manifest.agent.id))
      );
      updateAgent(applyOssAgent(draftAgent, definition));
      setCatalogueMessage(
        `${definition.label}'s verified manifest is saved to your account and this device. Save to link it to this shop's chat.`
      );
    } catch (error) {
      setCatalogueMessage(error instanceof Error ? error.message : "The manifest was not saved.");
    }
  }

  // An unavailable agent (unverified license, or a repository needing a backend adapter this
  // deployment doesn't have) is hidden entirely rather than shown disabled - it can't be
  // downloaded or used here, so listing it just invites a dead-end tap. An already-downloaded
  // agent stays listed even if it would now rank unavailable, so it can still be managed/removed.
  const agentOptions =
    deviceCapability === null
      ? []
      : rankOssAgentsForDevice({ agents, capability: deviceCapability, backendAvailable }).filter(
          (option) => option.status !== "unavailable" || installedAgentIds.has(option.agent.id)
        );

  return (
    <div className="record-form">
      <div className="section-heading">
        <p className="eyebrow">Identity</p>
        <h3>Agent profile</h3>
      </div>
      <div className="agent-catalog-heading">
        <div>
          <strong>Choose an open-source agent</strong>
          <small>
            Live projects from GitHub and Hugging Face. Soko downloads a verified manifest and uses
            it through the bounded Soko runtime; the conversational model remains separate.
          </small>
        </div>
        <span className="model-badge">
          {deviceCapability === null ? "Checking device…" : `${deviceCapability.level} device`}
        </span>
      </div>
      <form className="agent-catalog-search" onSubmit={searchAgents}>
        <input
          aria-label="Search open-source agents"
          placeholder="Search agents, frameworks, or capabilities"
          value={agentSearch}
          onChange={(event) => setAgentSearch(event.target.value)}
        />
        <button type="submit" className="secondary" disabled={catalogueLoading}>
          {catalogueLoading ? "Searching…" : "Search GitHub + Hugging Face"}
        </button>
      </form>
      <small className="agent-catalog-message" role="status">
        {catalogueMessage}
      </small>
      <div className="agent-catalog-list" aria-label="Open-source agent catalogue">
        {agentOptions.map(({ agent: definition, status, reason }) => {
          const selected = draftAgent.agentDefinitionId === definition.id;
          const installed = installedAgentIds.has(definition.id);
          return (
            <article
              className={`agent-catalog-card ${selected ? "selected" : ""}`}
              key={definition.id}
            >
              <div className="agent-catalog-card-heading">
                <div>
                  <strong>{definition.label}</strong>
                  <small>{definition.sourceId}</small>
                </div>
                <span className={`model-badge agent-fit-${status}`}>
                  {status === "hosted-ready"
                    ? "Hosted API"
                    : status === "backend-assisted"
                      ? "Backend assisted"
                      : "Unavailable"}
                </span>
              </div>
              <p>{definition.description}</p>
              <small>{reason}</small>
              <small>
                {definition.runtime} · {definition.minimumMemoryGb} GB minimum ·{" "}
                {definition.license} · {definition.popularity.toLocaleString()}{" "}
                {definition.source === "github" ? "stars" : "likes"}
              </small>
              {installed ? (
                <small className="agent-installed-label">Downloaded manifest</small>
              ) : null}
              <a href={definition.sourceUrl} target="_blank" rel="noreferrer">
                View on {definition.source === "github" ? "GitHub" : "Hugging Face"}
              </a>
              <button
                className={selected ? "secondary" : ""}
                type="button"
                disabled={!isEditing || status === "unavailable" || (selected && installed)}
                aria-pressed={selected}
                onClick={() => void downloadAndSelectAgent(definition)}
              >
                {selected && installed
                  ? "Selected"
                  : selected
                    ? "Download manifest"
                    : installed
                      ? "Use downloaded agent"
                      : "Download & use"}
              </button>
            </article>
          );
        })}
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
