import { useEffect, useRef, useState } from "react";

import type {
  AgentModelActivationResult,
  AgentModelBindingRemovalResult,
  AgentModelBindingSummary,
  ModelRuntimeHealthSummary
} from "@soko/shared-types";

import {
  readClientInferencePreferences,
  saveClientInferencePreferences,
  type ClientInferencePreferences
} from "./inference/preferences";

import { navigateToBrowserUrl } from "./browser-navigation";

import { ApiRequestError } from "./lib/api";

import { type ModelActivationState } from "./model-activation-state";

import {
  type ActiveAiModelSummary,
  type ActiveBusiness,
  type AgentSettings,
  type AiModelSummary,
  type CatalogAiModelSearchResponse,
  backendModelProbeRequestTimeoutMs,
  clientInferenceFeatureFlags
} from "./soko-application-shared";

import { postJson, deleteJson, getJson } from "./api-helpers";
import { formatDate, formatLatency, formatModelBytes, formatExecutionTarget } from "./formatters";
import { isAgentModel } from "./owner-app-bootstrap";
import { normalizeSearchText } from "./agent-command-engine";
import { getErrorMessage } from "./chat-message-plumbing";
import {
  applyDeploymentRuntimeAvailability,
  isDownloadableCatalogModel
} from "./agent-model-panel-utils";
import { backendModelRuntimeStatusMessage } from "./backend-model-runtime-status";
import { McpAccessTokensPanel } from "./McpAccessTokensPanel";

export interface AgentModelPanelProps {
  accountId: string;
  business: ActiveBusiness;
  agent: AgentSettings;
  isEditing: boolean;
  updateAgent: (patch: Partial<AgentSettings>) => void;
  onAgentChange: (agent: AgentSettings) => void;
  profileMessage: string;
  setProfileMessage: (message: string) => void;
  pendingProfileAction: string | null;
  runProfileAction: (key: string, action: () => Promise<void>) => Promise<void>;
  copyStorefrontValue: (value: string, label: string) => Promise<void>;
  aiModels: AiModelSummary[];
  setAiModels: (models: AiModelSummary[]) => void;
  activeAiModelId: string;
  setActiveAiModelId: (modelId: string) => void;
}

/**
 * The advanced counterpart to QuickRuntimeSwitcher.tsx's simple "pick a harness + hosted model"
 * dropdown: this panel shows the full backend model binding (with a real test/activate/remove
 * round trip against /api/agents/:agentId/models/:modelId/{test,activate} and
 * /api/agents/:agentId/model-binding), plus GitHub and Hugging Face model discovery. Every model
 * this app can run is backend-hosted - there is no private per-device model copy. A discovered
 * model activates through the same hosted flow as a catalog model when the deployment has it
 * configured; otherwise it is shown browse-only until it is registered.
 */
export function AgentModelPanel({
  accountId,
  business,
  agent,
  isEditing,
  updateAgent,
  onAgentChange,
  profileMessage,
  setProfileMessage,
  pendingProfileAction,
  runProfileAction,
  copyStorefrontValue,
  aiModels,
  setAiModels,
  activeAiModelId,
  setActiveAiModelId
}: AgentModelPanelProps) {
  const canonicalRuntimeAgentId = business.id;
  const [visibleAiModels, setVisibleAiModels] = useState<AiModelSummary[]>([]);
  const [activeAgentModelBinding, setActiveAgentModelBinding] =
    useState<AgentModelBindingSummary | null>(null);
  const [serverBackendRuntime, setServerBackendRuntime] = useState<
    Record<
      string,
      {
        status: "available" | "unavailable";
        latencyMs: number | null;
        errorCode: string | null;
      }
    >
  >({});
  const [activatingModelId, setActivatingModelId] = useState<string | null>(null);
  const [testingBackendModelId, setTestingBackendModelId] = useState<string | null>(null);
  const [failedActivationModelId, setFailedActivationModelId] = useState<string | null>(null);
  const [modelActivationState, setModelActivationState] = useState<ModelActivationState>("idle");
  const [modelLibraryLoaded, setModelLibraryLoaded] = useState(false);
  const [modelLibraryLoading, setModelLibraryLoading] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [modelRuntimeBusy, setModelRuntimeBusy] = useState(false);
  const modelRuntimeBusyRef = useRef(false);
  const [inferencePreferences, setInferencePreferences] = useState<ClientInferencePreferences>(() =>
    readClientInferencePreferences(accountId, business.id)
  );
  const [githubModelDiscovery, setGitHubModelDiscovery] = useState<CatalogAiModelSearchResponse>({
    models: [],
    status: "unavailable",
    connection: "public",
    message: "GitHub model discovery has not run yet."
  });
  const [huggingFaceModelDiscovery, setHuggingFaceModelDiscovery] =
    useState<CatalogAiModelSearchResponse>({
      models: [],
      status: "unavailable",
      connection: "public",
      message: "Hugging Face model discovery has not run yet."
    });

  useEffect(() => {
    setInferencePreferences(readClientInferencePreferences(accountId, business.id));
    void loadCanonicalAgentModelBinding();
    const params = new URLSearchParams(location.search);
    const initialSearch = params.get("ai_search") ?? "";
    setModelSearch(initialSearch);
  }, [accountId, business.id]);

  useEffect(() => {
    if (!modelLibraryLoaded) return;
    const onPopState = () => {
      const params = new URLSearchParams(location.search);
      const searchParam = params.get("ai_search") ?? "";
      setModelSearch(searchParam);
      void loadAiModels(searchParam);
      const selectedModel = params.get("ai_model");
      if (selectedModel) {
        updateAgent({ model: selectedModel });
      }
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [modelLibraryLoaded]);

  async function openModelLibrary() {
    if (modelLibraryLoaded || modelLibraryLoading) return;
    setModelLibraryLoading(true);
    setProfileMessage("Opening model settings…");
    try {
      const initialSearch = new URLSearchParams(location.search).get("ai_search") ?? "";
      await loadAiModels(initialSearch);
      setModelLibraryLoaded(true);
      setProfileMessage("Model settings ready.");
    } catch (error) {
      setProfileMessage(getErrorMessage(error));
    } finally {
      setModelLibraryLoading(false);
    }
  }

  function updateInferencePreferences(patch: Partial<ClientInferencePreferences>) {
    const next = saveClientInferencePreferences(accountId, business.id, {
      ...inferencePreferences,
      ...patch
    });
    setInferencePreferences(next);
    setProfileMessage("Client-first inference preferences saved.");
  }

  async function loadAiModels(search?: string) {
    // Only used below in the catch block, as a bare-minimum offline fallback when the fetch to
    // GET /v1/ai-models fails entirely - the DB-hosted catalog (services/api/src/cp2/store.ts
    // listModelCatalog, infra/db/migrations/071_platform_catalog.sql) is authoritative once that
    // fetch succeeds.
    const offlineDefaults: AiModelSummary[] = [];
    try {
      const normalizedSearch = search?.trim() ?? "";
      const [
        registry,
        active,
        searchResults,
        githubRegistry,
        githubSearchResults,
        huggingFaceRegistry,
        huggingFaceSearchResults,
        canonicalBinding
      ] = await Promise.all([
        getJson<{ models: AiModelSummary[] }>("/v1/ai-models"),
        getJson<ActiveAiModelSummary>(`/businesses/${business.id}/ai-model`),
        normalizedSearch.length > 0
          ? getJson<{ models: AiModelSummary[] }>(
              `/v1/ai-models?search=${encodeURIComponent(normalizedSearch)}`
            )
          : Promise.resolve(null),
        loadGitHubModels(),
        normalizedSearch.length > 0 ? loadGitHubModels(normalizedSearch) : Promise.resolve(null),
        loadHuggingFaceModels(),
        normalizedSearch.length > 0
          ? loadHuggingFaceModels(normalizedSearch)
          : Promise.resolve(null),
        getJson<{ binding: AgentModelBindingSummary | null }>(
          `/api/agents/${encodeURIComponent(
            canonicalRuntimeAgentId
          )}/model-binding?shopId=${encodeURIComponent(business.id)}`
        ).catch(() => ({ binding: null }))
      ]);
      const externalRegistry = mergeAiModelCatalogs(
        githubRegistry.models,
        huggingFaceRegistry.models
      );
      const allModels = applyDeploymentRuntimeAvailability(
        mergeAiModelCatalogs(registry.models, externalRegistry),
        registry.models
      );
      const visibleModels = applyDeploymentRuntimeAvailability(
        mergeAiModelCatalogs(
          searchResults?.models ?? registry.models,
          mergeAiModelCatalogs(
            githubSearchResults?.models ?? githubRegistry.models,
            huggingFaceSearchResults?.models ?? huggingFaceRegistry.models
          )
        ),
        registry.models
      );
      const effectiveModelId = canonicalBinding.binding?.modelId ?? active.modelId;
      setAiModels(allModels);
      setVisibleAiModels(visibleModels);
      setActiveAiModelId(effectiveModelId);
      setActiveAgentModelBinding(canonicalBinding.binding);
      setGitHubModelDiscovery(githubSearchResults ?? githubRegistry);
      setHuggingFaceModelDiscovery(huggingFaceSearchResults ?? huggingFaceRegistry);
      if (!isEditing && isAgentModel(effectiveModelId)) {
        updateAgent({ model: effectiveModelId });
      }
    } catch (error) {
      const matchingDefaults = offlineDefaults.filter((model) =>
        (search?.trim().length ?? 0) === 0
          ? true
          : normalizeSearchText(
              `${model.label} ${model.description} ${model.capabilities.join(" ")}`
            ).includes(normalizeSearchText(search ?? ""))
      );
      setAiModels(offlineDefaults);
      setVisibleAiModels(matchingDefaults);
      setProfileMessage(getErrorMessage(error));
    }
  }

  async function loadGitHubModels(search?: string): Promise<CatalogAiModelSearchResponse> {
    try {
      const query = search?.trim();
      return await getJson<CatalogAiModelSearchResponse>(
        query ? `/v1/ai-models/github?search=${encodeURIComponent(query)}` : "/v1/ai-models/github"
      );
    } catch {
      return {
        models: [],
        status: "unavailable",
        connection: "public",
        message: "GitHub model discovery is temporarily unavailable."
      };
    }
  }

  async function loadHuggingFaceModels(search?: string): Promise<CatalogAiModelSearchResponse> {
    try {
      const query = search?.trim();
      return await getJson<CatalogAiModelSearchResponse>(
        query
          ? `/v1/ai-models/huggingface?search=${encodeURIComponent(query)}`
          : "/v1/ai-models/huggingface"
      );
    } catch {
      return {
        models: [],
        status: "unavailable",
        connection: "public",
        message: "Hugging Face model discovery is temporarily unavailable."
      };
    }
  }

  async function searchAiModels() {
    const s = modelSearch.trim();
    try {
      const u = new URL(location.href);
      if (s) u.searchParams.set("ai_search", s);
      else u.searchParams.delete("ai_search");
      navigateToBrowserUrl(`${u.pathname}${u.search}`, { replace: true });
    } catch {
      /* ignore history update errors in unusual environments */
    }
    await loadAiModels(s);
  }

  async function loadCanonicalAgentModelBinding(): Promise<AgentModelBindingSummary | null> {
    if (!navigator.onLine) return activeAgentModelBinding;
    try {
      const response = await getJson<{ binding: AgentModelBindingSummary | null }>(
        `/api/agents/${encodeURIComponent(
          canonicalRuntimeAgentId
        )}/model-binding?shopId=${encodeURIComponent(business.id)}`
      );
      setActiveAgentModelBinding(response.binding);
      if (response.binding !== null) {
        setActiveAiModelId(response.binding.modelId);
      }
      return response.binding;
    } catch (error) {
      setProfileMessage(getErrorMessage(error));
      return null;
    }
  }

  async function testServerBackendModel(model: AiModelSummary) {
    if (modelRuntimeBusyRef.current || !navigator.onLine) {
      setProfileMessage("Connect to the internet to test the backend model.");
      return;
    }
    modelRuntimeBusyRef.current = true;
    setModelRuntimeBusy(true);
    setTestingBackendModelId(model.id);
    try {
      setProfileMessage(`Testing ${model.label} through real backend inference…`);
      const result = await postJson<{ healthCheck: ModelRuntimeHealthSummary }>(
        `/api/agents/${encodeURIComponent(
          canonicalRuntimeAgentId
        )}/models/${encodeURIComponent(model.id)}/test`,
        {
          shopId: business.id,
          executionTarget: "backend"
        },
        { timeoutMs: backendModelProbeRequestTimeoutMs }
      );
      setServerBackendRuntime((current) => ({
        ...current,
        [model.id]: {
          status: "available",
          latencyMs: result.healthCheck.latencyMs,
          errorCode: null
        }
      }));
      setProfileMessage(
        `Model verified. ${model.label} responded from ${
          result.healthCheck.executionTarget
        } in ${formatLatency(result.healthCheck.latencyMs)}.`
      );
    } catch (error) {
      setServerBackendRuntime((current) => ({
        ...current,
        [model.id]: {
          status: "unavailable",
          latencyMs: null,
          errorCode: error instanceof ApiRequestError ? error.code : null
        }
      }));
      setProfileMessage(getErrorMessage(error));
    } finally {
      modelRuntimeBusyRef.current = false;
      setModelRuntimeBusy(false);
      setTestingBackendModelId(null);
    }
  }

  async function activateServerBackendModel(model: AiModelSummary) {
    if (modelRuntimeBusyRef.current || !navigator.onLine) {
      setProfileMessage("Connect to the internet to activate the backend model.");
      return;
    }
    modelRuntimeBusyRef.current = true;
    setModelRuntimeBusy(true);
    setActivatingModelId(model.id);
    setModelActivationState("validating");
    try {
      setProfileMessage(`Verifying and activating ${model.label} for ${agent.name}…`);
      const result = await postJson<AgentModelActivationResult>(
        `/api/agents/${encodeURIComponent(
          canonicalRuntimeAgentId
        )}/models/${encodeURIComponent(model.id)}/activate`,
        {
          shopId: business.id,
          executionTarget: "backend",
          executionMode: "LOCAL_FIRST",
          permissions: {
            allowInstalledApp: false,
            allowRemoteShopDevice: inferencePreferences.ownerNodeAllowed
          }
        },
        { timeoutMs: backendModelProbeRequestTimeoutMs }
      );
      setActiveAgentModelBinding(result.binding);
      setServerBackendRuntime((current) => ({
        ...current,
        [model.id]: {
          status: "available",
          latencyMs: result.healthCheck.latencyMs,
          errorCode: null
        }
      }));
      setActiveAiModelId(result.binding.modelId);
      updateAgent({ model: result.binding.modelId });
      onAgentChange({ ...agent, model: result.binding.modelId });
      setModelActivationState("active");
      setFailedActivationModelId(null);
      setProfileMessage(
        `${model.label} is active for ${agent.name}. Verified in ${formatLatency(
          result.healthCheck.latencyMs
        )}.`
      );
    } catch (error) {
      setModelActivationState("failed");
      setFailedActivationModelId(model.id);
      setProfileMessage(`${getErrorMessage(error)} The previous working model remains active.`);
      await loadCanonicalAgentModelBinding();
    } finally {
      modelRuntimeBusyRef.current = false;
      setModelRuntimeBusy(false);
      setActivatingModelId(null);
    }
  }

  async function removeServerBackendModelFromAgent(model: AiModelSummary) {
    if (
      modelRuntimeBusyRef.current ||
      !navigator.onLine ||
      activeAgentModelBinding?.status !== "active" ||
      activeAgentModelBinding.modelId !== model.id
    ) {
      if (!navigator.onLine) {
        setProfileMessage("Connect to the internet to remove this model from the agent.");
      }
      return;
    }
    modelRuntimeBusyRef.current = true;
    setModelRuntimeBusy(true);
    setActivatingModelId(model.id);
    try {
      setProfileMessage(`Removing ${model.label} from ${agent.name}…`);
      const result = await deleteJson<AgentModelBindingRemovalResult>(
        `/api/agents/${encodeURIComponent(
          canonicalRuntimeAgentId
        )}/model-binding?shopId=${encodeURIComponent(business.id)}`
      );
      if (result.binding !== null || result.agentId !== canonicalRuntimeAgentId) {
        throw new Error("The backend did not remove the active model binding.");
      }
      const fallbackModelId = "sokoclaw-local";
      setActiveAgentModelBinding(null);
      setActiveAiModelId(fallbackModelId);
      updateAgent({ model: fallbackModelId });
      onAgentChange({ ...agent, model: fallbackModelId });
      setModelActivationState("idle");
      setFailedActivationModelId(null);
      setProfileMessage(
        `${model.label} is no longer preferred for ${agent.name}. Chat will continue with automatic execution.`
      );
    } catch (error) {
      setProfileMessage(getErrorMessage(error));
      await loadCanonicalAgentModelBinding();
    } finally {
      modelRuntimeBusyRef.current = false;
      setModelRuntimeBusy(false);
      setActivatingModelId(null);
    }
  }

  const activeAiModel = aiModels.find((model) => model.id === activeAiModelId);
  const activeBackendBinding =
    activeAgentModelBinding?.status === "active" &&
    activeAgentModelBinding.executionTarget === "backend";
  const activeBackendConfigured =
    activeBackendBinding && activeAiModel?.runtimeAvailability?.backend === "configured";
  const serverBackendModels = visibleAiModels.filter(
    (model) => model.runtimeAvailability?.backend === "configured"
  );
  // A discovered GitHub/Hugging Face result that isn't yet server-registered has no hosted
  // activation path - list it as browse-only rather than offering a device download.
  // TODO(runtime-registry): route through unified registry search once it consolidates this
  // discovery surface.
  const browseOnlyDiscoveryModels = visibleAiModels.filter(
    (model) =>
      isDownloadableCatalogModel(model) &&
      model.license === "Apache-2.0" &&
      model.runtimeAvailability?.backend !== "configured"
  );

  return (
    <>
      <div className="record-form agent-model-panel">
        <div className="section-heading">
          <p className="eyebrow">Soko AI · Ready</p>
          <h3>Advanced model preferences</h3>
          <p>
            Execution is automatic and always backend-hosted. There is no private per-device model
            copy to install or manage.
          </p>
        </div>
        {modelActivationState !== "idle" && profileMessage.length > 0 ? (
          <p className="shell-note" role="status" aria-live="polite">
            {profileMessage}
          </p>
        ) : null}
        <article className="agent-model-current">
          <div>
            <span className="model-badge">Current model</span>
            <span className={`model-badge status-${activeAgentModelBinding?.status ?? "failed"}`}>
              {activeAgentModelBinding?.status === "active"
                ? `Active for ${agent.name}`
                : "Automatic"}
            </span>
          </div>
          <h4>
            {activeAgentModelBinding === null
              ? "Soko AI is ready"
              : (activeAiModel?.label ?? activeAgentModelBinding.modelId)}
          </h4>
          <p>
            {activeAgentModelBinding === null
              ? "A compatible execution host and model are selected automatically when you chat."
              : `Running on: ${formatExecutionTarget(activeAgentModelBinding.executionTarget)}`}
          </p>
          <small>
            {activeAgentModelBinding?.lastVerifiedAt === null ||
            activeAgentModelBinding?.lastVerifiedAt === undefined
              ? "No download or activation required"
              : `Verified ${formatDate(activeAgentModelBinding.lastVerifiedAt)}`}
          </small>
          {activeBackendBinding && !activeBackendConfigured ? (
            <small role="status">
              Backend inference is no longer configured for this deployment. Remove this binding or
              switch to an available model.
            </small>
          ) : null}
          <div className="ai-model-card-actions">
            {!activeBackendBinding || activeBackendConfigured ? (
              <button
                className="secondary"
                type="button"
                disabled={activeAgentModelBinding === null || modelRuntimeBusy}
                onClick={() => {
                  const model = aiModels.find(
                    (candidate) => candidate.id === activeAgentModelBinding?.modelId
                  );
                  if (model !== undefined) void testServerBackendModel(model);
                }}
              >
                Test model
              </button>
            ) : null}
            {activeBackendBinding && activeAiModel !== undefined ? (
              <button
                className="secondary"
                type="button"
                disabled={modelRuntimeBusy}
                onClick={() => void removeServerBackendModelFromAgent(activeAiModel)}
              >
                Remove from agent
              </button>
            ) : null}
            <button type="button" onClick={() => void openModelLibrary()}>
              Switch model
            </button>
          </div>
        </article>
        <McpAccessTokensPanel
          accountId={accountId}
          businessId={business.id}
          pendingProfileAction={pendingProfileAction}
          runProfileAction={runProfileAction}
          setProfileMessage={setProfileMessage}
          copyStorefrontValue={copyStorefrontValue}
        />
        <details className="agent-model-advanced">
          <summary>Advanced routing</summary>
          <section className="browser-model-control" aria-label="Client-first inference routing">
            <div>
              <strong>Client-first route permissions</strong>
              <p>
                Soko routes chat through the configured backend-hosted model. A signed-in,
                shop-owned device (for example a merchant's own laptop) can additionally be
                registered as an allowed execution host. Server tools remain confirmation-gated.
              </p>
            </div>
            <label className="browser-model-toggle">
              <input
                type="checkbox"
                checked={inferencePreferences.ownerNodeAllowed}
                disabled={!clientInferenceFeatureFlags.ownerNode || modelRuntimeBusy}
                onChange={(event) =>
                  updateInferencePreferences({ ownerNodeAllowed: event.target.checked })
                }
              />
              Allow another signed-in shop device
            </label>
            <small>
              Prompts may be relayed only to an authenticated device registered for this shop and
              model.
            </small>
          </section>
        </details>
      </div>

      <div className="record-form ai-model-library">
        <div className="section-heading">
          <p className="eyebrow">Backend-hosted AI</p>
          <h3>Model library</h3>
          <p>
            Browse Soko's hosted catalog, Hugging Face Hub, and verified GitHub release assets.
            Every model runs on the Soko backend - nothing downloads to this device.
          </p>
        </div>

        {!modelLibraryLoaded ? (
          <div className="deferred-model-library">
            <p>Remote model catalogs stay paused until you open this library.</p>
            <button
              type="button"
              disabled={modelLibraryLoading}
              aria-busy={modelLibraryLoading}
              onClick={() => void openModelLibrary()}
            >
              {modelLibraryLoading ? "Opening model settings…" : "Open model library"}
            </button>
          </div>
        ) : (
          <>
            {serverBackendModels.length > 0 ? (
              <section aria-label="Soko backend models">
                <div className="section-subheading">
                  <h4>Soko backend models</h4>
                  <p>
                    Available means the deployed runtime passed a real model probe. Active means
                    this agent has a persisted binding that passed real backend inference.
                  </p>
                </div>
                <div className="ai-model-catalog">
                  {serverBackendModels.map((model) => {
                    const activeForAgent =
                      activeAgentModelBinding?.status === "active" &&
                      activeAgentModelBinding.modelId === model.id &&
                      activeAgentModelBinding.executionTarget === "backend";
                    const runtime = serverBackendRuntime[model.id];
                    const runtimeLabel =
                      runtime?.status === "available"
                        ? "Available"
                        : runtime?.status === "unavailable"
                          ? "Unavailable"
                          : "Not verified";
                    return (
                      <article className="ai-model-card" key={`backend:${model.id}`}>
                        <div>
                          <p className="eyebrow">
                            Backend · {activeForAgent ? `Active for ${agent.name}` : runtimeLabel}
                          </p>
                          <h4>{model.label}</h4>
                          <p>{model.description}</p>
                          <small>{model.capabilities.join(" · ")}</small>
                          {runtime?.status === "unavailable" ? (
                            <small role="status">
                              {backendModelRuntimeStatusMessage(runtime.errorCode)}
                            </small>
                          ) : runtime?.status === "available" ? (
                            <small>Model verified in {formatLatency(runtime.latencyMs ?? 0)}.</small>
                          ) : null}
                          {failedActivationModelId === model.id ? (
                            <small role="status">
                              Activation failed. The previous working model remains active - try
                              again or pick a different model.
                            </small>
                          ) : null}
                        </div>
                        <div className="ai-model-card-actions">
                          <button
                            className="secondary"
                            type="button"
                            disabled={modelRuntimeBusy}
                            onClick={() => void testServerBackendModel(model)}
                          >
                            {testingBackendModelId === model.id ? "Testing…" : "Test model"}
                          </button>
                          <button
                            type="button"
                            aria-pressed={activeForAgent}
                            disabled={modelRuntimeBusy}
                            onClick={() =>
                              void (activeForAgent
                                ? removeServerBackendModelFromAgent(model)
                                : activateServerBackendModel(model))
                            }
                          >
                            {activeForAgent
                              ? activatingModelId === model.id
                                ? "Removing…"
                                : "Remove from agent"
                              : activatingModelId === model.id
                                ? "Activating…"
                                : "Use with agent"}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ) : null}

            <div className="ai-model-search">
              <label>
                Search models
                <input
                  value={modelSearch}
                  onChange={(event) => setModelSearch(event.target.value)}
                  placeholder="Search Soko, Hugging Face, and GitHub"
                />
              </label>
              <div className="ai-model-search-actions">
                <button type="button" onClick={() => void searchAiModels()}>
                  Search all model sources
                </button>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => {
                    setModelSearch("");
                    try {
                      const u = new URL(location.href);
                      u.searchParams.delete("ai_search");
                      navigateToBrowserUrl(`${u.pathname}${u.search}`, { replace: true });
                    } catch {
                      /* ignore history update errors in unusual environments */
                    }
                    void loadAiModels();
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
            <div
              className={`github-model-status ${
                githubModelDiscovery.status === "available" ? "ok" : ""
              }`}
              role="status"
            >
              <span className="github-model-connection">
                GitHub ·{" "}
                {githubModelDiscovery.connection === "authenticated"
                  ? "Authenticated API"
                  : "Public API"}{" "}
                · {githubModelDiscovery.status === "available" ? "Available" : "Unavailable"}
              </span>
              <span>{githubModelDiscovery.message}</span>
            </div>
            <div
              className={`github-model-status ${
                huggingFaceModelDiscovery.status === "available" ? "ok" : ""
              }`}
              role="status"
            >
              <span className="github-model-connection">
                Hugging Face ·{" "}
                {huggingFaceModelDiscovery.connection === "authenticated"
                  ? "Authenticated API"
                  : "Public API"}{" "}
                · {huggingFaceModelDiscovery.status === "available" ? "Available" : "Unavailable"}
              </span>
              <span>{huggingFaceModelDiscovery.message}</span>
            </div>

            <div className="ai-model-best-fit">
              <div className="section-subheading">
                <h4>Discovered models</h4>
                <p>
                  Results from Hugging Face Hub and verified GitHub release assets that are not yet
                  registered on the Soko backend. Browse them here; activation follows once a model
                  is server-registered.
                </p>
              </div>
              <div className="ai-model-catalog">
                {browseOnlyDiscoveryModels.map((model) => (
                  <article className="ai-model-card" key={model.id}>
                    <div>
                      <p className="eyebrow">
                        Browse only ·{" "}
                        {model.source === "github" ? "GitHub release · " : "Hugging Face · "}
                        {model.license} · {model.format}
                      </p>
                      <h4>{model.label}</h4>
                      <p>{model.description}</p>
                      <small>
                        {formatModelBytes(model.fileSizeBytes)} · {model.minimumMemoryGb} GB
                        minimum RAM · {model.capabilities.join(" · ")}
                      </small>
                      <small role="status">
                        Not yet available for hosted activation on this deployment.
                      </small>
                    </div>
                    <div className="ai-model-card-actions">
                      {model.modelCardUrl !== null ? (
                        <a href={model.modelCardUrl} target="_blank" rel="noreferrer">
                          {model.source === "github" ? "GitHub release" : "Model card"}
                        </a>
                      ) : null}
                    </div>
                  </article>
                ))}
                {browseOnlyDiscoveryModels.length === 0 ? (
                  <p>No additional discovered models right now. Try a different search.</p>
                ) : null}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

export function mergeAiModelCatalogs(
  primary: AiModelSummary[],
  additional: AiModelSummary[]
): AiModelSummary[] {
  const models: AiModelSummary[] = [];
  const ids = new Set<string>();
  const downloads = new Set<string>();

  for (const model of [...primary, ...additional]) {
    const downloadKey = normalizeModelDownloadUrl(model.downloadUrl);
    if (ids.has(model.id) || (downloadKey !== null && downloads.has(downloadKey))) {
      continue;
    }
    ids.add(model.id);
    if (downloadKey !== null) downloads.add(downloadKey);
    models.push({ ...model, capabilities: [...model.capabilities] });
  }

  return models;
}

export function normalizeModelDownloadUrl(downloadUrl: string | null): string | null {
  if (downloadUrl === null) return null;
  try {
    const url = new URL(downloadUrl);
    return `${url.origin}${decodeURIComponent(url.pathname).toLowerCase()}`;
  } catch {
    return downloadUrl.split("?")[0]?.toLowerCase() ?? null;
  }
}
