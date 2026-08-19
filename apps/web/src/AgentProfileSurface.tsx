import { Suspense, useEffect, useState } from "react";

import type {
  AccountShopSummary,
  AgentContextSource,
  AgentEvaluationSummary,
  AgentOwnerCorrection,
  AgentRuntimeReadiness,
  AgentRuntimeVersion,
  AgentModelAssignmentSummary
} from "@soko/shared-types";

import { copyTextToClipboard } from "./misc-browser-utils";
import { SalesPricingEscalationPanel, VoiceAndCarePanel } from "./AgentPolicyPanels";
import { AgentIdentityPanel } from "./AgentIdentityPanel";
import { AgentReadinessPanel } from "./AgentReadinessPanel";
import { AgentRetentionPanel } from "./AgentRetentionPanel";
import { AgentRuntimeAccessPanel } from "./AgentRuntimeAccessPanel";
import { DeleteAccountPanel } from "./DeleteAccountPanel";
import { McpAccessTokensPanel } from "./McpAccessTokensPanel";
import { NotificationsSessionsPanel } from "./NotificationsSessionsPanel";
import { ProtectedContextFilesPanel } from "./ProtectedContextFilesPanel";
import { PublicStorefrontPanel } from "./PublicStorefrontPanel";
import { YourShopsPanel } from "./YourShopsPanel";

import {
  listLocalAiModels,
  getOrCreateDeviceModelScopeId,
  type LocalAiModel
} from "./ai-model-manager";
import {
  assignmentFromServer,
  readDeviceAgentModelAssignment,
  saveDeviceAgentModelAssignment,
  type DeviceAgentModelAssignment
} from "./agent-model-assignment";

import {
  AgentModelPanel,
  IdentitySecurityPanel,
  type ActiveBusiness,
  type AgentSettings,
  type AiModelSummary,
  type BusinessAgentProfileSummary,
  type OAuthProviderSummary,
  type SessionResponse
} from "./soko-application-shared";

import { postJson, putJson, getJson } from "./api-helpers";
import { createPublicStorefrontAgentId, createStorefrontUrl } from "./sokoid-and-storefront";
import {
  agentSettingsFromBusinessProfile,
  ensureRequiredAgentContextScripts,
  sanitizeContextScripts
} from "./owner-app-bootstrap";
import { getErrorMessage } from "./chat-message-plumbing";
import { installedModelRequest, isDownloadableCatalogModel } from "./agent-model-panel-utils";

export interface AgentProfileSurfaceProps {
  accountId: string;
  identityLevel: SessionResponse["account"]["identityLevel"];
  agent: AgentSettings;
  business: ActiveBusiness;
  oauthProviders: OAuthProviderSummary[];
  ownerLabel: string;
  ownerUser: SessionResponse["user"] | null;
  registeredEmail: string | null;
  storefrontUrl: string;
  shops: AccountShopSummary[];
  onSwitchBusiness: (shop: AccountShopSummary) => void;
  onAgentChange: (agent: AgentSettings) => void;
  onIdentityLevelChange: (identityLevel: SessionResponse["account"]["identityLevel"]) => void;
  onAccountMerged: (session: SessionResponse) => void;
  onOwnerUserChange: (user: SessionResponse["user"]) => void;
  onBack: () => void;
  onDisableNotifications: () => Promise<void>;
  onEnableNotifications: () => Promise<void>;
  onEnsureRuntimeSession: () => Promise<string>;
  onLogout: () => void;
  onLogoutAll: () => void;
  onScheduleAccountDeletion: (input: {
    pin: string;
    confirmation: string;
    reason: string;
  }) => Promise<boolean>;
  isLoggingOut: boolean;
}

export function AgentProfileSurface({
  accountId,
  identityLevel,
  agent,
  business,
  oauthProviders,
  ownerLabel,
  ownerUser,
  registeredEmail,
  storefrontUrl,
  shops,
  onSwitchBusiness,
  onAgentChange,
  onIdentityLevelChange,
  onAccountMerged,
  onOwnerUserChange,
  onBack,
  onDisableNotifications,
  onEnableNotifications,
  onEnsureRuntimeSession,
  onLogout,
  onLogoutAll,
  onScheduleAccountDeletion,
  isLoggingOut
}: AgentProfileSurfaceProps) {
  const [draftAgent, setDraftAgent] = useState(agent);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [contextPassword, setContextPassword] = useState("");
  const [contextUnlocked, setContextUnlocked] = useState(false);
  const [contextUnlockError, setContextUnlockError] = useState("");
  const [profileMessage, setProfileMessage] = useState("");
  const [runtimeReadiness, setRuntimeReadiness] = useState<AgentRuntimeReadiness | null>(null);
  const [runtimeVersions, setRuntimeVersions] = useState<AgentRuntimeVersion[]>([]);
  const [runtimeContextSources, setRuntimeContextSources] = useState<AgentContextSource[]>([]);
  const [evaluationSummary, setEvaluationSummary] = useState<AgentEvaluationSummary | null>(null);
  const [ownerCorrections, setOwnerCorrections] = useState<AgentOwnerCorrection[]>([]);
  const [correctionDraft, setCorrectionDraft] = useState("");
  const [correctionCategory, setCorrectionCategory] =
    useState<AgentOwnerCorrection["category"]>("instruction");
  const [promoteCorrection, setPromoteCorrection] = useState(true);
  const [runtimeDetailsLoading, setRuntimeDetailsLoading] = useState(false);
  const [pendingProfileAction, setPendingProfileAction] = useState<string | null>(null);
  const [aiModels, setAiModels] = useState<AiModelSummary[]>([]);
  const [activeAiModelId, setActiveAiModelId] = useState(agent.model);
  const [localAiModels, setLocalAiModels] = useState<LocalAiModel[]>(() => listLocalAiModels());
  const [deviceId] = useState(() => getOrCreateDeviceModelScopeId());
  const [agentModelAssignment, setAgentModelAssignment] =
    useState<DeviceAgentModelAssignment | null>(() =>
      readDeviceAgentModelAssignment(business.id, getOrCreateDeviceModelScopeId())
    );

  useEffect(() => {
    if (!isEditing) {
      setDraftAgent(agent);
    }
  }, [agent, isEditing]);

  useEffect(() => {
    void loadAgentProfile();
    void loadAgentRuntimeDetails();
    void loadAgentModelAssignment();
  }, [accountId, business.id]);

  async function runProfileAction(key: string, action: () => Promise<void>) {
    if (pendingProfileAction !== null) return;
    setPendingProfileAction(key);
    try {
      await action();
    } finally {
      setPendingProfileAction(null);
    }
  }

  async function loadAgentProfile() {
    try {
      const profile = await getJson<BusinessAgentProfileSummary>(
        `/businesses/${business.id}/agent-profile`
      );
      const nextAgent = agentSettingsFromBusinessProfile(profile, business);
      setDraftAgent(nextAgent);
      onAgentChange(nextAgent);
    } catch (error) {
      setProfileMessage(getErrorMessage(error));
    }
  }

  async function loadAgentRuntimeDetails() {
    setRuntimeDetailsLoading(true);
    try {
      const [readiness, versions, contextSources, evaluations, corrections] = await Promise.all([
        getJson<AgentRuntimeReadiness>(`/businesses/${business.id}/agent-runtime/readiness`),
        getJson<AgentRuntimeVersion[]>(`/businesses/${business.id}/agent-runtime/versions`),
        getJson<AgentContextSource[]>(`/businesses/${business.id}/agent-runtime/context-sources`),
        getJson<AgentEvaluationSummary>(`/businesses/${business.id}/agent-runtime/evaluations`),
        getJson<AgentOwnerCorrection[]>(`/businesses/${business.id}/agent-runtime/corrections`)
      ]);
      setRuntimeReadiness(readiness);
      setRuntimeVersions(versions);
      setRuntimeContextSources(contextSources);
      setEvaluationSummary(evaluations);
      setOwnerCorrections(corrections);
    } catch (error) {
      setProfileMessage(getErrorMessage(error));
    } finally {
      setRuntimeDetailsLoading(false);
    }
  }

  async function rollbackAgentRuntime(version: number) {
    try {
      await postJson(`/businesses/${business.id}/agent-runtime/versions/${version}/rollback`, {});
      await Promise.all([loadAgentProfile(), loadAgentRuntimeDetails()]);
      setIsEditing(false);
      setProfileMessage(`Runtime version ${version} restored as a new active version.`);
    } catch (error) {
      setProfileMessage(getErrorMessage(error));
    }
  }

  async function submitOwnerCorrection() {
    const correction = correctionDraft.trim();
    if (correction.length === 0) return;
    try {
      await postJson<AgentOwnerCorrection>(`/businesses/${business.id}/agent-runtime/corrections`, {
        correction,
        category: correctionCategory,
        promoteToInstruction: promoteCorrection
      });
      setCorrectionDraft("");
      await Promise.all([loadAgentProfile(), loadAgentRuntimeDetails()]);
      setProfileMessage(
        promoteCorrection
          ? "Correction saved and promoted into a new runtime version."
          : "Correction saved as bounded agent memory."
      );
    } catch (error) {
      setProfileMessage(getErrorMessage(error));
    }
  }

  async function disableOwnerCorrection(correctionId: string) {
    try {
      await postJson(
        `/businesses/${business.id}/agent-runtime/corrections/${encodeURIComponent(
          correctionId
        )}/disable`,
        {}
      );
      await loadAgentRuntimeDetails();
      setProfileMessage("Correction disabled.");
    } catch (error) {
      setProfileMessage(getErrorMessage(error));
    }
  }

  async function loadAgentModelAssignment() {
    const local = readDeviceAgentModelAssignment(business.id, deviceId);
    if (local !== null) setAgentModelAssignment(local);
    if (!navigator.onLine) return;
    try {
      if (
        local?.activeModelInstallationId !== null &&
        local?.activeModelInstallationId !== undefined &&
        local.readinessStatus === "READY" &&
        local.lastSuccessfulInferenceAt !== null
      ) {
        const installation = listLocalAiModels().find(
          (model) => model.id === local.activeModelInstallationId
        );
        if (installation !== undefined) {
          await registerInstalledModel(installation);
          const saved = await putJson<AgentModelAssignmentSummary>(
            `/businesses/${business.id}/agent-model`,
            {
              deviceId,
              installationId: installation.id,
              preferredExecutionMode: local.preferredExecutionMode,
              fallbackPolicy: local.fallbackPolicy,
              readinessStatus: local.readinessStatus,
              lastSuccessfulInferenceAt: local.lastSuccessfulInferenceAt,
              lastErrorCode: local.lastErrorCode
            }
          );
          const synchronized = assignmentFromServer(saved);
          saveDeviceAgentModelAssignment(synchronized);
          setAgentModelAssignment(synchronized);
          return;
        }
      }
      const server = await getJson<AgentModelAssignmentSummary>(
        `/businesses/${business.id}/agent-model?deviceId=${encodeURIComponent(deviceId)}`
      );
      if (server.activeModelInstallationId === null) {
        const restored = assignmentFromServer(server);
        saveDeviceAgentModelAssignment(restored);
        setAgentModelAssignment(restored);
        if (restored.modelId !== null) {
          setActiveAiModelId(restored.modelId);
          updateAgent({ model: restored.modelId });
          onAgentChange({ ...agent, model: restored.modelId });
        }
        setProfileMessage(
          "No downloaded model is connected on this device. Download and test a GGUF model to make it the agent default."
        );
        return;
      }
      const restored = assignmentFromServer(server);
      saveDeviceAgentModelAssignment(restored);
      setAgentModelAssignment(restored);
    } catch (error) {
      if (local === null) setProfileMessage(getErrorMessage(error));
    }
  }

  async function registerInstalledModel(model: LocalAiModel, signal?: AbortSignal): Promise<void> {
    await postJson(
      "/v1/models/installed",
      installedModelRequest(model),
      signal === undefined ? {} : { signal }
    );
  }

  function updateAgent(patch: Partial<AgentSettings>) {
    setDraftAgent((currentAgent) => ({ ...currentAgent, ...patch }));
  }

  function startEditing() {
    setDraftAgent(agent);
    setIsEditing(true);
  }

  function cancelEditing() {
    setDraftAgent(agent);
    setIsEditing(false);
    setContextUnlocked(false);
    setContextPassword("");
    setContextUnlockError("");
  }

  async function saveAgent() {
    if (isSaving) return;
    const selectedCatalogModel = aiModels.find((model) => model.id === draftAgent.model);
    if (
      selectedCatalogModel !== undefined &&
      isDownloadableCatalogModel(selectedCatalogModel) &&
      draftAgent.model !== agent.model &&
      !localAiModels.some((model) => model.modelId === draftAgent.model)
    ) {
      setProfileMessage(
        `Install ${selectedCatalogModel.label} on this phone before activating it.`
      );
      return;
    }
    const publicAgentId = createPublicStorefrontAgentId(business);
    setIsSaving(true);
    try {
      const saved = await putJson<BusinessAgentProfileSummary>(
        `/businesses/${business.id}/agent-profile`,
        {
          name: draftAgent.name,
          description: draftAgent.description,
          modelId: draftAgent.model,
          role: draftAgent.role,
          language: draftAgent.language,
          personality: draftAgent.personality,
          personalityConfig: draftAgent.personalityConfig,
          instructions: draftAgent.instructions,
          instructionPolicy: draftAgent.instructionPolicy,
          knowledge: draftAgent.knowledge,
          tools: draftAgent.tools,
          skillBindings: draftAgent.skillBindings,
          integrations: draftAgent.integrations,
          contextScripts: ensureRequiredAgentContextScripts(
            sanitizeContextScripts(draftAgent.contextScripts)
          ),
          memoryPolicy: draftAgent.memoryPolicy,
          evaluationPolicy: draftAgent.evaluationPolicy,
          supportedLanguages: draftAgent.supportedLanguages,
          businessCategory: draftAgent.businessCategory,
          publicIntroduction: draftAgent.publicIntroduction,
          status: draftAgent.status
        }
      );
      onAgentChange({
        ...agentSettingsFromBusinessProfile(saved, business),
        globalAgentId: publicAgentId,
        storefrontUrl: createStorefrontUrl(publicAgentId)
      });
      setIsEditing(false);
      setContextUnlocked(false);
      setContextPassword("");
      setContextUnlockError("");
      setProfileMessage(`Business runtime version ${saved.runtimeVersion} saved.`);
      void loadAgentRuntimeDetails();
    } catch (error) {
      setProfileMessage(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function copyStorefrontValue(value: string, label: string) {
    try {
      await copyTextToClipboard(value);
      setProfileMessage(`${label} copied.`);
    } catch (error) {
      setProfileMessage(getErrorMessage(error));
    }
  }

  const activeInstalledModel =
    agentModelAssignment?.activeModelInstallationId === null ||
    agentModelAssignment?.activeModelInstallationId === undefined
      ? null
      : (localAiModels.find(
          (model) => model.id === agentModelAssignment.activeModelInstallationId
        ) ?? null);
  const activeAiModel = aiModels.find((model) => model.id === activeAiModelId);
  const hasUnsavedRuntimeChanges = JSON.stringify(draftAgent) !== JSON.stringify(agent);

  return (
    <main className="agent-profile-surface">
      <section className="agent-profile-header">
        <button className="secondary" type="button" onClick={onBack}>
          Back
        </button>
        <div className="agent-avatar" aria-hidden="true">
          {draftAgent.name.slice(0, 1).toUpperCase()}
        </div>
        <div>
          <p className="eyebrow">{business.name}</p>
          <h2>{draftAgent.name}</h2>
          <p>{draftAgent.description}</p>
        </div>
        <div className="agent-profile-actions">
          {isEditing ? (
            <>
              <button
                type="button"
                onClick={() => void saveAgent()}
                disabled={isSaving}
                aria-busy={isSaving}
              >
                {isSaving ? "Saving…" : "Save"}
              </button>
              <button className="secondary" type="button" onClick={cancelEditing}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={startEditing}>
                Edit
              </button>
              <button
                className="secondary"
                type="button"
                onClick={onLogout}
                disabled={isLoggingOut}
                aria-busy={isLoggingOut}
              >
                {isLoggingOut ? "Signing out…" : "Sign out"}
              </button>
            </>
          )}
        </div>
      </section>

      <YourShopsPanel shops={shops} business={business} onSwitchBusiness={onSwitchBusiness} />

      <section className="agent-settings-grid">
        <AgentIdentityPanel
          draftAgent={draftAgent}
          isEditing={isEditing}
          updateAgent={updateAgent}
          activeAiModelId={activeAiModelId}
          activeInstalledModel={activeInstalledModel}
          activeAiModel={activeAiModel}
        />

        <AgentReadinessPanel
          business={business}
          draftAgent={draftAgent}
          isEditing={isEditing}
          hasUnsavedRuntimeChanges={hasUnsavedRuntimeChanges}
          runtimeReadiness={runtimeReadiness}
          runtimeVersions={runtimeVersions}
          runtimeDetailsLoading={runtimeDetailsLoading}
          pendingProfileAction={pendingProfileAction}
          runProfileAction={runProfileAction}
          rollbackAgentRuntime={rollbackAgentRuntime}
        />

        <VoiceAndCarePanel
          draftAgent={draftAgent}
          isEditing={isEditing}
          updateAgent={updateAgent}
        />

        <SalesPricingEscalationPanel
          draftAgent={draftAgent}
          isEditing={isEditing}
          updateAgent={updateAgent}
        />

        <AgentRuntimeAccessPanel
          draftAgent={draftAgent}
          isEditing={isEditing}
          updateAgent={updateAgent}
          runtimeContextSources={runtimeContextSources}
          runtimeDetailsLoading={runtimeDetailsLoading}
        />

        <AgentRetentionPanel
          draftAgent={draftAgent}
          isEditing={isEditing}
          updateAgent={updateAgent}
          evaluationSummary={evaluationSummary}
          correctionDraft={correctionDraft}
          setCorrectionDraft={setCorrectionDraft}
          correctionCategory={correctionCategory}
          setCorrectionCategory={setCorrectionCategory}
          promoteCorrection={promoteCorrection}
          setPromoteCorrection={setPromoteCorrection}
          pendingProfileAction={pendingProfileAction}
          runProfileAction={runProfileAction}
          submitOwnerCorrection={submitOwnerCorrection}
          ownerCorrections={ownerCorrections}
          disableOwnerCorrection={disableOwnerCorrection}
        />

        <Suspense fallback={<div className="inline-loading-card">Opening model settings…</div>}>
          <AgentModelPanel
            accountId={accountId}
            business={business}
            agent={agent}
            isEditing={isEditing}
            updateAgent={updateAgent}
            onAgentChange={onAgentChange}
            ownerUser={ownerUser}
            onEnsureRuntimeSession={onEnsureRuntimeSession}
            profileMessage={profileMessage}
            setProfileMessage={setProfileMessage}
            aiModels={aiModels}
            setAiModels={setAiModels}
            localAiModels={localAiModels}
            setLocalAiModels={setLocalAiModels}
            activeAiModelId={activeAiModelId}
            setActiveAiModelId={setActiveAiModelId}
            agentModelAssignment={agentModelAssignment}
            setAgentModelAssignment={setAgentModelAssignment}
            deviceId={deviceId}
            registerInstalledModel={registerInstalledModel}
          />
        </Suspense>

        <PublicStorefrontPanel
          business={business}
          storefrontUrl={storefrontUrl}
          ownerLabel={ownerLabel}
          draftAgent={draftAgent}
          isEditing={isEditing}
          updateAgent={updateAgent}
          copyStorefrontValue={copyStorefrontValue}
        />

        <Suspense fallback={<div className="inline-loading-card">Opening account security…</div>}>
          <IdentitySecurityPanel
            accountId={accountId}
            identityLevel={identityLevel}
            business={business}
            oauthProviders={oauthProviders}
            ownerUser={ownerUser}
            registeredEmail={registeredEmail}
            onAccountMerged={onAccountMerged}
            onOwnerUserChange={onOwnerUserChange}
            onIdentityLevelChange={onIdentityLevelChange}
            pendingProfileAction={pendingProfileAction}
            runProfileAction={runProfileAction}
            profileMessage={profileMessage}
            setProfileMessage={setProfileMessage}
          />
        </Suspense>

        <NotificationsSessionsPanel
          accountId={accountId}
          businessId={business.id}
          pendingProfileAction={pendingProfileAction}
          runProfileAction={runProfileAction}
          setProfileMessage={setProfileMessage}
          onEnableNotifications={onEnableNotifications}
          onDisableNotifications={onDisableNotifications}
          onLogout={onLogout}
          onLogoutAll={onLogoutAll}
          isLoggingOut={isLoggingOut}
        />

        <McpAccessTokensPanel
          accountId={accountId}
          businessId={business.id}
          pendingProfileAction={pendingProfileAction}
          runProfileAction={runProfileAction}
          setProfileMessage={setProfileMessage}
          copyStorefrontValue={copyStorefrontValue}
        />

        <DeleteAccountPanel
          business={business}
          pendingProfileAction={pendingProfileAction}
          runProfileAction={runProfileAction}
          setProfileMessage={setProfileMessage}
          onScheduleAccountDeletion={onScheduleAccountDeletion}
        />

        <ProtectedContextFilesPanel
          draftAgent={draftAgent}
          isEditing={isEditing}
          isSaving={isSaving}
          updateAgent={updateAgent}
          saveAgent={saveAgent}
          contextPassword={contextPassword}
          setContextPassword={setContextPassword}
          contextUnlocked={contextUnlocked}
          setContextUnlocked={setContextUnlocked}
          contextUnlockError={contextUnlockError}
          setContextUnlockError={setContextUnlockError}
        />
      </section>
    </main>
  );
}
