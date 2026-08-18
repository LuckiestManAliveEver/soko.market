import { Suspense, useEffect, useRef, useState, type ChangeEvent } from "react";
import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";

import {
  defaultProductVocabularyContextScript,
  parseProductContextScriptCommand
} from "@soko/tool-core";

import type {
  AccountShopSummary,
  AgentContextSource,
  AgentEvaluationSummary,
  AgentInstructions,
  AgentOwnerCorrection,
  AgentPersonality,
  AgentRuntimeReadiness,
  AgentRuntimeVersion,
  DeviceSessionSummary,
  AgentModelActivationResult,
  AgentModelAssignmentSummary,
  AgentModelBindingRemovalResult,
  AgentModelBindingSummary,
  AgentModelFallbackPolicy,
  BrowserInferenceAssignmentSummary,
  ConnectedMailboxOAuthStartSummary,
  ConnectedMailboxProvider,
  ConnectedMailboxProviderSummary,
  ConnectedMailboxSummary,
  ConnectedMailboxSyncSummary,
  ModelRuntimeHealthSummary,
  PreferredExecutionMode,
  InstalledAgentModelSummary,
  McpAccessScope,
  McpAccessTokenCreated,
  McpAccessTokenSummary,
  PasskeySummary
} from "@soko/shared-types";

import { normalizeOwnerPhoneInput } from "./phone-identity";
import { PhoneNumberField } from "./PhoneNumberField";

import {
  canRunCatalogModel,
  browserGgufRuntimeSupported,
  defaultOfflineAiModels,
  downloadCatalogModel,
  importCustomGgufModel,
  inspectDeviceModelCapability,
  listBrowserModels,
  listLocalAiModels,
  rankCatalogModelsForDevice,
  removeLocalAiModel,
  validateLocalAiModel,
  getOrCreateDeviceModelScopeId,
  type DeviceModelCapability,
  type LocalAiModel,
  type ModelTransferProgress
} from "./ai-model-manager";
import {
  assignmentAfterReadiness,
  assignmentFromServer,
  clearDeviceAgentModelAssignment,
  createPendingDeviceAssignment,
  readDeviceAgentModelAssignment,
  saveDeviceAgentModelAssignment,
  type DeviceAgentModelAssignment
} from "./agent-model-assignment";
import { testAgentModelRuntime, type AgentModelRuntime } from "./agent-model-runtime";
import { createAdaptiveAgentModelRuntime } from "./browser-gguf-runtime";
import {
  cancelBrowserModelLoad,
  disableBrowserInference,
  enableBrowserInference,
  loadBrowserInferenceState,
  removeBrowserModel,
  type BrowserInferenceState
} from "./browser-inference-session";

import {
  loadSyncedBrowserInferenceAssignment,
  removeSyncedBrowserInferenceAssignment,
  synchronizeBrowserInferenceAssignment
} from "./browser-inference-sync";
import { browserLocalInferenceDeploymentEnabled } from "./browser-model-registry";

import type { BrowserInferenceCapability, BrowserModelProgress } from "./browser-inference-types";

import {
  readClientInferencePreferences,
  saveClientInferencePreferences,
  type ClientInferencePreferences
} from "./inference/preferences";

import { routes } from "./routes";
import { navigateToBrowserUrl } from "./browser-navigation";

import { ApiRequestError, apiFetch } from "./lib/api";

import { recordOnboardingEvent } from "./performance";

import { AuthenticationActionMessage } from "./AuthenticationActionMessage";

import {
  ModelActivationCoordinator,
  ModelActivationError,
  modelActivationMessage,
  withActivationTimeout,
  type ModelActivationState
} from "./model-activation-state";

import {
  AccountBackendControls,
  type AccountDeletionRequestSummary,
  type ActiveAiModelSummary,
  type ActiveBusiness,
  type AgentSettings,
  type AiModelSummary,
  type BusinessAgentProfileSummary,
  type CatalogAiModelSearchResponse,
  type ConnectedSocialAccountSummary,
  type ConnectedSocialAccountsResponse,
  type CountryDialCode,
  type OAuthProviderSummary,
  type OAuthStartResponse,
  type PasskeyListResponse,
  type PasskeyRegistrationOptionsResponse,
  type SessionResponse,
  type ShopDeletionPreviewSummary,
  type ShopDeletionRequestResult,
  type SocialSignupProvider,
  type SupportedLanguage,
  backendModelProbeRequestTimeoutMs,
  clientInferenceFeatureFlags,
  defaultAgentContextScripts,
  pendingOAuthStorageKey,
  phoneCountryOptions
} from "./soko-application-shared";

import { postJson, patchJson, putJson, deleteJson, getJson } from "./api-helpers";
import {
  formatDate,
  formatLatency,
  formatModelBytes,
  formatModelParameters,
  formatModelStatus,
  formatExecutionTarget
} from "./formatters";
import { createPublicStorefrontAgentId, createStorefrontUrl } from "./sokoid-and-storefront";
import {
  getCountryDialCode,
  getCountryDialCodeByCountry,
  inferCountryCode
} from "./country-dial-codes";
import {
  agentSettingsFromBusinessProfile,
  isAgentModel,
  ensureRequiredAgentContextScripts,
  sanitizeContextScripts
} from "./owner-app-bootstrap";
import { resolveContextScriptCommand, normalizeSearchText } from "./agent-command-engine";
import { getErrorMessage } from "./chat-message-plumbing";

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
  // `globalAgentId` is the public storefront identifier. The API persists the executable agent
  // profile and its model binding under the business UUID (`BusinessAgentProfileSummary.agentId`).
  const canonicalRuntimeAgentId = business.id;
  const [draftAgent, setDraftAgent] = useState(agent);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [contextPassword, setContextPassword] = useState("");
  const [contextUnlocked, setContextUnlocked] = useState(false);
  const [contextUnlockError, setContextUnlockError] = useState("");
  const [contextTestPhrase, setContextTestPhrase] = useState("Show products");
  const [connectedSocialAccounts, setConnectedSocialAccounts] = useState<
    ConnectedSocialAccountSummary[]
  >([]);
  const [passkeys, setPasskeys] = useState<PasskeySummary[]>([]);
  const [passkeyLabels, setPasskeyLabels] = useState<Record<string, string>>({});
  const [mfaFactors, setMfaFactors] = useState<
    Array<{ id: string; type: "totp"; createdAt: string }>
  >([]);
  const [pendingTotp, setPendingTotp] = useState<{
    factorId: string;
    secret: string;
    otpauthUri: string;
  } | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaRecoveryCodes, setMfaRecoveryCodes] = useState<string[]>([]);
  const [changePasswordCurrent, setChangePasswordCurrent] = useState("");
  const [changePasswordNew, setChangePasswordNew] = useState("");
  const [changePasswordConfirm, setChangePasswordConfirm] = useState("");
  const [changePasswordMfaCode, setChangePasswordMfaCode] = useState("");
  const [businessSocialAccounts, setBusinessSocialAccounts] = useState<
    ConnectedSocialAccountSummary[]
  >([]);
  const [connectedMailboxProviders, setConnectedMailboxProviders] = useState<
    ConnectedMailboxProviderSummary[]
  >([]);
  const [connectedMailboxes, setConnectedMailboxes] = useState<ConnectedMailboxSummary[]>([]);
  const [deviceSessions, setDeviceSessions] = useState<DeviceSessionSummary[]>([]);
  const [mcpTokens, setMcpTokens] = useState<McpAccessTokenSummary[]>([]);
  const [mcpTokenName, setMcpTokenName] = useState("My integration");
  const [mcpReadEnabled, setMcpReadEnabled] = useState(true);
  const [mcpActEnabled, setMcpActEnabled] = useState(false);
  const [mcpPin, setMcpPin] = useState("");
  const [newMcpAccessToken, setNewMcpAccessToken] = useState("");
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
  const [ownerPhoneCountryCode, setOwnerPhoneCountryCode] = useState<CountryDialCode>(
    inferCountryCode(ownerUser?.phoneNumberE164 ?? "") ?? "+254"
  );
  const [ownerPhoneNumber, setOwnerPhoneNumber] = useState(ownerUser?.phoneNumberE164 ?? "");
  const [ownerPhoneError, setOwnerPhoneError] = useState("");
  const [ownerPhoneMergeRequired, setOwnerPhoneMergeRequired] = useState(false);
  const [ownerPhoneMergePin, setOwnerPhoneMergePin] = useState("");
  const [ownerEmail, setOwnerEmail] = useState(ownerUser?.emailAddress ?? "");
  const [emailChallengeId, setEmailChallengeId] = useState("");
  const [emailVerificationCode, setEmailVerificationCode] = useState("");
  const [emailMergeRequired, setEmailMergeRequired] = useState(false);
  const [pendingProfileAction, setPendingProfileAction] = useState<string | null>(null);
  const [aiModels, setAiModels] = useState<AiModelSummary[]>([]);
  const [visibleAiModels, setVisibleAiModels] = useState<AiModelSummary[]>([]);
  const [activeAiModelId, setActiveAiModelId] = useState(agent.model);
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
  const [cloudFallbackModelId, setCloudFallbackModelId] = useState<string | null>(null);
  const [activatingModelId, setActivatingModelId] = useState<string | null>(null);
  const [testingBackendModelId, setTestingBackendModelId] = useState<string | null>(null);
  const [failedActivationModelId, setFailedActivationModelId] = useState<string | null>(null);
  const [modelActivationState, setModelActivationState] = useState<ModelActivationState>("idle");
  const [modelLibraryLoaded, setModelLibraryLoaded] = useState(false);
  const [modelLibraryLoading, setModelLibraryLoading] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [localAiModels, setLocalAiModels] = useState<LocalAiModel[]>(() => listLocalAiModels());
  const [deviceCapability, setDeviceCapability] = useState<DeviceModelCapability | null>(null);
  const [deviceId] = useState(() => getOrCreateDeviceModelScopeId());
  const [agentModelAssignment, setAgentModelAssignment] =
    useState<DeviceAgentModelAssignment | null>(() =>
      readDeviceAgentModelAssignment(business.id, getOrCreateDeviceModelScopeId())
    );
  const [modelChooserOpen, setModelChooserOpen] = useState(false);
  const [modelRuntimeBusy, setModelRuntimeBusy] = useState(false);
  const modelRuntimeBusyRef = useRef(false);
  const modelActivationCoordinator = useRef(new ModelActivationCoordinator());
  const activatingInstallationIdRef = useRef<string | null>(null);
  const modelRuntime = useRef<AgentModelRuntime | null>(null);
  const [browserInferenceState, setBrowserInferenceState] = useState<BrowserInferenceState | null>(
    null
  );
  const [syncedBrowserInference, setSyncedBrowserInference] =
    useState<BrowserInferenceAssignmentSummary | null>(null);
  const [selectedBrowserModelId, setSelectedBrowserModelId] = useState(
    () => listBrowserModels()[0]?.id ?? ""
  );
  const [inferencePreferences, setInferencePreferences] = useState<ClientInferencePreferences>(() =>
    readClientInferencePreferences(accountId, business.id)
  );
  const [browserModelProgress, setBrowserModelProgress] = useState<BrowserModelProgress | null>(
    null
  );
  const browserModelOptions = browserInferenceState?.modelOptions ?? [];
  const selectedBrowserModel =
    browserModelOptions.find((option) => option.model.id === selectedBrowserModelId)?.model ??
    listBrowserModels().find((model) => model.id === selectedBrowserModelId) ??
    null;
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
  const [modelTransfers, setModelTransfers] = useState<Record<string, ModelTransferProgress>>({});
  const [customLicenseConfirmed, setCustomLicenseConfirmed] = useState(false);
  const customModelInput = useRef<HTMLInputElement>(null);
  const [deletionStep, setDeletionStep] = useState<
    | "idle"
    | "choose"
    | "shop-confirm"
    | "shop-verify"
    | "shop-status"
    | "account-confirm"
    | "account-verify"
  >("idle");
  const [deletionPreview, setDeletionPreview] = useState<ShopDeletionPreviewSummary | null>(null);
  const [deletionRequest, setDeletionRequest] = useState<AccountDeletionRequestSummary | null>(
    null
  );
  const [deletionShopId, setDeletionShopId] = useState("");
  const [deletionPin, setDeletionPin] = useState("");
  const [deletionAcknowledged, setDeletionAcknowledged] = useState(false);
  const [accountDeletionConfirmation, setAccountDeletionConfirmation] = useState("");
  const [accountDeletionReason, setAccountDeletionReason] = useState("");
  const [accountDeletionPin, setAccountDeletionPin] = useState("");
  const [accountDeletionAcknowledged, setAccountDeletionAcknowledged] = useState(false);

  useEffect(() => {
    if (!isEditing) {
      setDraftAgent(agent);
    }
  }, [agent, isEditing]);

  useEffect(
    () => () => {
      modelActivationCoordinator.current.cancel();
      modelRuntimeBusyRef.current = false;
      const installationId = activatingInstallationIdRef.current;
      if (installationId !== null) void getModelRuntime().unload(installationId);
    },
    []
  );

  useEffect(() => {
    const savedPhone = ownerUser?.phoneNumberE164;
    if (savedPhone === undefined || savedPhone === null) return;

    setOwnerPhoneNumber(savedPhone);
    setOwnerPhoneCountryCode(inferCountryCode(savedPhone) ?? "+254");
  }, [ownerUser?.phoneNumberE164]);

  useEffect(() => {
    setInferencePreferences(readClientInferencePreferences(accountId, business.id));
    void loadConnectedSocialAccounts();
    void loadBusinessSocialAccounts();
    void loadConnectedMailboxes();
    void loadPasskeys();
    void loadMfaFactors();
    void loadDeviceSessions();
    void loadMcpTokens();
    void loadShopDeletionPreview();
    void loadAgentProfile();
    void loadAgentRuntimeDetails();
    void loadAgentModelAssignment();
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
        setDraftAgent((current) => ({ ...current, model: selectedModel }));
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
      const [browserState, capability, syncedAssignment] = await Promise.all([
        loadBrowserInferenceState(accountId, business.id),
        inspectDeviceModelCapability(),
        loadSyncedBrowserInferenceAssignment(business.id).catch(() => null),
        loadAiModels(initialSearch)
      ]);
      setBrowserInferenceState(browserState);
      setSyncedBrowserInference(syncedAssignment);
      setSelectedBrowserModelId(
        browserState.settings?.selectedModelId ??
          syncedAssignment?.selectedModelId ??
          browserState.modelOptions.find((option) => option.compatible)?.model.id ??
          ""
      );
      setDeviceCapability(capability);
      setModelLibraryLoaded(true);
      setProfileMessage("Model settings ready.");
      if (navigator.onLine && browserState.settings !== null) {
        void synchronizeBrowserInferenceAssignment({
          businessId: business.id,
          state: browserState
        })
          .then(setSyncedBrowserInference)
          .catch(() => undefined);
      }
    } catch (error) {
      setProfileMessage(getErrorMessage(error));
    } finally {
      setModelLibraryLoading(false);
    }
  }

  async function setBrowserInferenceEnabled(enabled: boolean) {
    if (modelRuntimeBusy) return;
    setModelRuntimeBusy(true);
    setBrowserModelProgress(null);
    try {
      if (!enabled) {
        const state = await disableBrowserInference(accountId, business.id);
        setBrowserInferenceState(state);
        if (navigator.onLine) {
          setSyncedBrowserInference(
            await synchronizeBrowserInferenceAssignment({
              businessId: business.id,
              state
            })
          );
        }
        setProfileMessage(
          "Browser-local inference is off. Allowed native, owner-device, or cloud routing remains."
        );
        return;
      }
      const model = listBrowserModels().find(
        (candidate) => candidate.id === selectedBrowserModelId
      );
      if (model === undefined) throw new Error("No approved browser model is configured.");
      const option = browserInferenceState?.modelOptions.find(
        (candidate) => candidate.model.id === model.id
      );
      if (option?.compatible === false) {
        throw new Error(option.reason ?? "This browser model is incompatible with this device.");
      }
      setProfileMessage(
        `Downloading ${model.displayName} after your consent. Keep Soko open until it is ready.`
      );
      const state = await enableBrowserInference({
        accountId,
        businessId: business.id,
        modelId: model.id,
        onProgress: setBrowserModelProgress
      });
      setBrowserInferenceState(state);
      if (navigator.onLine) {
        setSyncedBrowserInference(
          await synchronizeBrowserInferenceAssignment({
            businessId: business.id,
            state
          })
        );
      }
      setProfileMessage(
        navigator.onLine
          ? `${model.displayName} is ready and connected to this shop's browser inference workflow.`
          : `${model.displayName} is ready locally. Reconnect to synchronize its database assignment.`
      );
    } catch (error) {
      setBrowserInferenceState(await loadBrowserInferenceState(accountId, business.id));
      setProfileMessage(getErrorMessage(error));
    } finally {
      setBrowserModelProgress(null);
      setModelRuntimeBusy(false);
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

  async function deleteBrowserModel() {
    if (modelRuntimeBusy) return;
    setModelRuntimeBusy(true);
    try {
      const state = await removeBrowserModel(accountId, business.id);
      setBrowserInferenceState(state);
      if (navigator.onLine) {
        await removeSyncedBrowserInferenceAssignment(business.id);
        setSyncedBrowserInference(null);
      }
      setProfileMessage(
        navigator.onLine
          ? "The cached browser model and its database assignment were removed. Chat history was left unchanged."
          : "The cached browser model was removed locally. Reconnect to clear its database assignment."
      );
    } catch (error) {
      setProfileMessage(getErrorMessage(error));
    } finally {
      setModelRuntimeBusy(false);
    }
  }

  function getModelRuntime(): AgentModelRuntime {
    modelRuntime.current ??= createAdaptiveAgentModelRuntime();
    return modelRuntime.current;
  }

  async function runProfileAction(key: string, action: () => Promise<void>) {
    if (pendingProfileAction !== null) return;
    setPendingProfileAction(key);
    try {
      await action();
    } finally {
      setPendingProfileAction(null);
    }
  }

  async function loadAiModels(search?: string) {
    const offlineDefaults: AiModelSummary[] = defaultOfflineAiModels;
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
      const allModels = mergeAiModelCatalogs(
        offlineDefaults,
        mergeAiModelCatalogs(registry.models, externalRegistry)
      );
      const visibleModels = mergeAiModelCatalogs(
        offlineDefaults.filter((model) =>
          normalizedSearch.length === 0
            ? true
            : normalizeSearchText(
                `${model.label} ${model.description} ${model.capabilities.join(" ")}`
              ).includes(normalizeSearchText(normalizedSearch))
        ),
        mergeAiModelCatalogs(
          searchResults?.models ?? registry.models,
          mergeAiModelCatalogs(
            githubSearchResults?.models ?? githubRegistry.models,
            huggingFaceSearchResults?.models ?? huggingFaceRegistry.models
          )
        )
      );
      const deviceSelection = readDeviceAgentModelAssignment(business.id, deviceId);
      const effectiveModelId =
        canonicalBinding.binding?.modelId ?? deviceSelection?.modelId ?? active.modelId;
      setAiModels(allModels);
      setVisibleAiModels(visibleModels);
      setActiveAiModelId(effectiveModelId);
      setActiveAgentModelBinding(canonicalBinding.binding);
      setCloudFallbackModelId(
        allModels.some(
          (model) =>
            model.id === active.modelId &&
            model.available &&
            model.provider === "openai" &&
            model.source === "hosted"
        )
          ? active.modelId
          : null
      );
      setGitHubModelDiscovery(githubSearchResults ?? githubRegistry);
      setHuggingFaceModelDiscovery(huggingFaceSearchResults ?? huggingFaceRegistry);
      if (!isEditing && isAgentModel(effectiveModelId)) {
        setDraftAgent((current) => ({ ...current, model: effectiveModelId }));
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

  async function predownloadAiModel(model: AiModelSummary) {
    try {
      setProfileMessage(`Downloading ${model.label} to this device…`);
      const installed = await downloadCatalogModel(model, (progress) => {
        setModelTransfers((current) => ({ ...current, [model.id]: progress }));
      });
      const verified = await validateLocalAiModel(installed, deviceCapability);
      setLocalAiModels(listLocalAiModels());
      if (navigator.onLine) await registerInstalledModel(verified);
      setProfileMessage(
        "Installed on this device. Choose ‘Activate on this device’ to run a readiness check and attach it locally."
      );
    } catch (error) {
      setProfileMessage(getErrorMessage(error));
    } finally {
      setModelTransfers((current) => {
        const next = { ...current };
        delete next[model.id];
        return next;
      });
    }
  }

  async function importCustomModel(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file === undefined) return;
    if (deviceCapability?.customModelsAllowed !== true || !customLicenseConfirmed) {
      setProfileMessage("Custom model import requires a capable device and license confirmation.");
      return;
    }
    const transferId = "custom-import";
    try {
      setProfileMessage(`Importing ${file.name} into private device storage…`);
      const model = await importCustomGgufModel(file, (progress) => {
        setModelTransfers((current) => ({ ...current, [transferId]: progress }));
      });
      const verified = await validateLocalAiModel(model, deviceCapability);
      setLocalAiModels(listLocalAiModels());
      if (navigator.onLine) await registerInstalledModel(verified);
      setProfileMessage(
        "Installed on this device. Choose ‘Activate on this device’ to run a readiness check and attach it locally."
      );
    } catch (error) {
      setProfileMessage(getErrorMessage(error));
    } finally {
      setModelTransfers((current) => {
        const next = { ...current };
        delete next[transferId];
        return next;
      });
    }
  }

  async function deleteDeviceModel(model: LocalAiModel) {
    try {
      if (agentModelAssignment?.activeModelInstallationId === model.id) {
        await removeModelFromAgent();
      }
      await getModelRuntime().unload(model.id);
      await removeLocalAiModel(model);
      setLocalAiModels(listLocalAiModels());
      setProfileMessage(`${model.label} was removed from this device.`);
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

  async function registerInstalledModel(model: LocalAiModel, signal?: AbortSignal): Promise<void> {
    await postJson(
      "/v1/models/installed",
      installedModelRequest(model),
      signal === undefined ? {} : { signal }
    );
  }

  async function validateInstalledModelOnBackend(
    model: LocalAiModel,
    signal?: AbortSignal
  ): Promise<InstalledAgentModelSummary> {
    return postJson<InstalledAgentModelSummary>(
      `/v1/models/${encodeURIComponent(model.id)}/validate`,
      {
        deviceId,
        installationStatus: model.installationStatus,
        compatibilityStatus: model.compatibilityStatus,
        validationError: model.validationError
      },
      signal === undefined ? {} : { signal }
    );
  }

  async function synchronizeAgentModelAssignment(
    assignment: DeviceAgentModelAssignment,
    signal?: AbortSignal
  ): Promise<DeviceAgentModelAssignment> {
    if (!navigator.onLine) return assignment;
    const saved = await putJson<AgentModelAssignmentSummary>(
      `/businesses/${business.id}/agent-model`,
      {
        deviceId,
        installationId: assignment.activeModelInstallationId,
        preferredExecutionMode: assignment.preferredExecutionMode,
        fallbackPolicy: assignment.fallbackPolicy,
        readinessStatus: assignment.readinessStatus,
        lastSuccessfulInferenceAt: assignment.lastSuccessfulInferenceAt,
        lastErrorCode: assignment.lastErrorCode
      },
      signal === undefined ? {} : { signal }
    );
    return assignmentFromServer(saved);
  }

  async function activationApiReachable(signal?: AbortSignal): Promise<boolean> {
    if (!navigator.onLine) return false;
    try {
      await withActivationTimeout(
        (timeoutSignal) => apiFetch<SessionResponse>("/session", { signal: timeoutSignal }),
        8_000,
        signal
      );
      return true;
    } catch (error) {
      if (signal?.aborted) throw error;
      if (error instanceof TypeError) return false;
      if (error instanceof ModelActivationError && error.code === "ACTIVATION_TIMEOUT") {
        return false;
      }
      throw error;
    }
  }

  function cancelModelActivation() {
    modelActivationCoordinator.current.cancel();
    setProfileMessage("Cancelling model activation…");
  }

  async function useModelWithAgent(model: LocalAiModel) {
    const activation = modelActivationCoordinator.current.begin(model.id);
    if (activation === null) return;
    const previous = agentModelAssignment;
    const phaseDurations: Partial<Record<ModelActivationState, number>> = {};
    let phase: ModelActivationState = "idle";
    let phaseStartedAt = performance.now();
    let runtimeSessionId: string | null = null;
    let apiReachable = false;
    const transition = (next: ModelActivationState, message: string) => {
      if (activation.signal.aborted || !modelActivationCoordinator.current.isCurrent(activation))
        return;
      phaseDurations[phase] = Math.round(performance.now() - phaseStartedAt);
      phase = next;
      phaseStartedAt = performance.now();
      setModelActivationState(next);
      setProfileMessage(message);
    };
    const assertCurrent = () => {
      if (activation.signal.aborted || !modelActivationCoordinator.current.isCurrent(activation)) {
        throw new ModelActivationError("ACTIVATION_ABORTED", "Model activation was cancelled.");
      }
    };
    modelRuntimeBusyRef.current = true;
    activatingInstallationIdRef.current = model.id;
    setModelRuntimeBusy(true);
    setActivatingModelId(model.modelId);
    setFailedActivationModelId(null);
    setModelActivationState("validating");
    setModelChooserOpen(false);
    try {
      transition("validating", "Checking model…");
      const verified = await validateLocalAiModel(model, deviceCapability);
      assertCurrent();
      setLocalAiModels(listLocalAiModels());
      if (
        verified.installationStatus !== "INSTALLED" ||
        verified.compatibilityStatus !== "COMPATIBLE"
      ) {
        throw new ModelActivationError(
          verified.validationError === "MODEL_FILE_MISSING" ||
            verified.installationStatus === "CORRUPT"
            ? "MODEL_FILES_MISSING"
            : "MODEL_RUNTIME_FAILED",
          verified.validationError === "MODEL_FILE_MISSING" ||
            verified.installationStatus === "CORRUPT"
            ? "The model files are missing or incomplete. Download the model again."
            : verified.compatibilityStatus === "INSUFFICIENT_MEMORY"
              ? "This device does not have enough memory for the model."
              : "The installed model is not compatible with this device."
        );
      }
      if (!verified.commercialUseAllowed) {
        throw new Error("This model is not approved for commercial use.");
      }
      if (window.SokoAgentModelRuntime === undefined && !browserGgufRuntimeSupported()) {
        throw new ModelActivationError(
          "MODEL_RUNTIME_FAILED",
          "This browser does not provide WebAssembly workers or the installed-app GGUF runtime."
        );
      }

      apiReachable = await activationApiReachable(activation.signal);
      assertCurrent();
      if (apiReachable) {
        await withActivationTimeout(
          (signal) => registerInstalledModel(verified, signal),
          45_000,
          activation.signal
        );
        const backendValidation = await withActivationTimeout(
          (signal) => validateInstalledModelOnBackend(verified, signal),
          45_000,
          activation.signal
        );
        assertCurrent();
        if (
          backendValidation.installationStatus !== "INSTALLED" ||
          backendValidation.compatibilityStatus !== "COMPATIBLE"
        ) {
          throw new Error(
            backendValidation.validationError ??
              "The backend could not validate this model installation."
          );
        }
      }

      if (
        verified.runtimeBackend === "LLAMA_CPP_ANDROID" &&
        clientInferenceFeatureFlags.nativeBridge &&
        !inferencePreferences.nativePermission
      ) {
        const nextPreferences = saveClientInferencePreferences(accountId, business.id, {
          ...inferencePreferences,
          nativePermission: true
        });
        setInferencePreferences(nextPreferences);
      }
      transition("creating_runtime", "Starting runtime…");
      if (apiReachable) {
        runtimeSessionId = await withActivationTimeout(
          () => onEnsureRuntimeSession(),
          45_000,
          activation.signal
        );
        if (runtimeSessionId.trim().length === 0) {
          throw new ModelActivationError(
            "RUNTIME_SESSION_INVALID",
            "The runtime session could not be created."
          );
        }
      } else {
        runtimeSessionId = `local:${business.id}:${deviceId}:${activation.id}`;
      }
      assertCurrent();

      transition("loading_model", `Loading ${verified.displayName}…`);
      const result = await testAgentModelRuntime(getModelRuntime(), verified, {
        signal: activation.signal,
        onEvent: (event) => {
          if (event.type === "MODEL_LOAD_PROGRESS" && event.progress !== null) {
            transition("loading_model", `Loading ${verified.displayName}… ${event.progress}%`);
          }
        }
      });
      assertCurrent();
      if (!result.success) {
        throw new ModelActivationError(
          result.errorCode === "MODEL_FILE_MISSING"
            ? "MODEL_FILES_MISSING"
            : "MODEL_RUNTIME_FAILED",
          result.errorCode === "MODEL_FILE_MISSING"
            ? "The model files are missing or incomplete. Download the model again."
            : result.message
        );
      }
      transition("binding_agent", "Connecting model to agent…");
      const pending = createPendingDeviceAssignment({
        businessId: business.id,
        deviceId,
        installation: verified,
        preferredExecutionMode: previous?.preferredExecutionMode ?? "LOCAL_FIRST",
        fallbackPolicy: previous?.fallbackPolicy ?? "WHEN_LOCAL_UNAVAILABLE",
        runtimeSessionId
      });
      let readyAssignment = assignmentAfterReadiness(pending, result);
      if (apiReachable) {
        readyAssignment = await withActivationTimeout(
          (signal) => synchronizeAgentModelAssignment(readyAssignment, signal),
          45_000,
          activation.signal
        );
        readyAssignment.runtimeSessionId = runtimeSessionId;
      }
      assertCurrent();
      saveDeviceAgentModelAssignment(readyAssignment);
      setAgentModelAssignment(readyAssignment);
      setActiveAiModelId(readyAssignment.modelId ?? verified.modelId);
      if (
        previous?.activeModelInstallationId !== null &&
        previous?.activeModelInstallationId !== undefined &&
        previous.activeModelInstallationId !== verified.id
      ) {
        await getModelRuntime().unload(previous.activeModelInstallationId);
      }
      updateAgent({ model: verified.modelId });
      onAgentChange({ ...agent, model: verified.modelId });
      setModelActivationState("active");
      setFailedActivationModelId(null);
      setProfileMessage(`${verified.displayName} is now connected to ${business.name}.`);
      recordModelActivationDiagnostic({
        activationRequestId: activation.id,
        userId: ownerUser?.id ?? accountId,
        shopId: business.id,
        agentId: readyAssignment.agentId,
        modelId: model.modelId,
        modelSource: model.provider,
        runtimeType: model.runtimeBackend,
        runtimeSessionId,
        online: apiReachable,
        phaseDurations: {
          ...phaseDurations,
          [phase]: Math.round(performance.now() - phaseStartedAt)
        },
        failureCode: null
      });
    } catch (error) {
      void getModelRuntime().unload(model.id);
      if (!modelActivationCoordinator.current.isCurrent(activation)) return;
      setModelActivationState("failed");
      setFailedActivationModelId(model.modelId);
      const message = getErrorMessage(error);
      if (previous === null) {
        clearDeviceAgentModelAssignment(business.id, deviceId);
        setAgentModelAssignment(null);
      } else {
        saveDeviceAgentModelAssignment(previous);
        setAgentModelAssignment(previous);
      }
      setProfileMessage(`${message} The previous working model was left unchanged.`);
      recordModelActivationDiagnostic({
        activationRequestId: activation.id,
        userId: ownerUser?.id ?? accountId,
        shopId: business.id,
        agentId: previous?.agentId ?? business.id,
        modelId: model.modelId,
        modelSource: model.provider,
        runtimeType: model.runtimeBackend,
        runtimeSessionId,
        online: apiReachable,
        phaseDurations: {
          ...phaseDurations,
          [phase]: Math.round(performance.now() - phaseStartedAt)
        },
        failureCode: error instanceof ModelActivationError ? error.code : "MODEL_RUNTIME_FAILED"
      });
    } finally {
      if (modelActivationCoordinator.current.isCurrent(activation)) {
        modelActivationCoordinator.current.finish(activation);
        modelRuntimeBusyRef.current = false;
        activatingInstallationIdRef.current = null;
        setActivatingModelId(null);
        setModelRuntimeBusy(false);
      }
    }
  }

  async function useBackendModelWithAgent(model: AiModelSummary) {
    if (modelRuntimeBusyRef.current || !model.available) return;
    if (model.provider !== "openai" || model.source !== "hosted") {
      setProfileMessage("Only configured hosted models can be selected as cloud fallbacks.");
      return;
    }
    if (!inferencePreferences.cloudConsent) {
      setProfileMessage(
        "Enable explicit OpenAI fallback consent before selecting an OpenAI model."
      );
      return;
    }
    const hasReadyLocalModel =
      agentModelAssignment?.activeModelInstallationId !== null &&
      agentModelAssignment?.activeModelInstallationId !== undefined &&
      agentModelAssignment.readinessStatus === "READY" &&
      agentModelAssignment.lastSuccessfulInferenceAt !== null &&
      agentModelAssignment.runtimeBackend !== "CLOUD";
    if (!hasReadyLocalModel) {
      setProfileMessage(
        "Download, connect, and test a GGUF model before selecting an OpenAI fallback."
      );
      return;
    }
    if (!navigator.onLine) {
      setModelActivationState("offline_blocked");
      setProfileMessage("Connect to the internet to activate this model.");
      return;
    }

    modelRuntimeBusyRef.current = true;
    setModelRuntimeBusy(true);
    setActivatingModelId(model.id);
    try {
      if (!(await activationApiReachable())) {
        setModelActivationState("offline_blocked");
        setProfileMessage("Connect to the internet to activate this model.");
        return;
      }
      setProfileMessage(`Setting ${model.label} as the cloud fallback…`);
      await onEnsureRuntimeSession();
      const activated = await putJson<ActiveAiModelSummary>(`/businesses/${business.id}/ai-model`, {
        modelId: model.id
      });
      if (activated.modelId !== model.id) {
        throw new Error("The backend did not activate the selected model.");
      }

      setCloudFallbackModelId(activated.modelId);
      setProfileMessage(
        `${model.label} is the explicit cloud fallback. The downloaded llama.cpp model remains connected and always runs first.`
      );
    } catch (error) {
      setProfileMessage(getErrorMessage(error));
    } finally {
      modelRuntimeBusyRef.current = false;
      setActivatingModelId(null);
      setModelRuntimeBusy(false);
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
      const allowOpenAIFallback =
        inferencePreferences.cloudConsent && cloudFallbackModelId !== null;
      const result = await postJson<AgentModelActivationResult>(
        `/api/agents/${encodeURIComponent(
          canonicalRuntimeAgentId
        )}/models/${encodeURIComponent(model.id)}/activate`,
        {
          shopId: business.id,
          executionTarget: "backend",
          executionMode: "LOCAL_FIRST",
          fallbackPolicy: agentModelAssignment?.fallbackPolicy ?? "WHEN_LOCAL_UNAVAILABLE",
          permissions: {
            allowInstalledApp: inferencePreferences.nativePermission,
            allowRemoteShopDevice: inferencePreferences.ownerNodeAllowed,
            allowOpenAIFallback
          },
          fallbackModelId: allowOpenAIFallback ? cloudFallbackModelId : null
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
      const fallbackModelId = cloudFallbackModelId ?? "sokoclaw-local";
      setActiveAgentModelBinding(null);
      setActiveAiModelId(fallbackModelId);
      updateAgent({ model: fallbackModelId });
      onAgentChange({ ...agent, model: fallbackModelId });
      setModelActivationState("idle");
      setFailedActivationModelId(null);
      setProfileMessage(
        `${model.label} was removed from ${agent.name}. Activate a verified model before using server chat.`
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

  async function testAssignedModel() {
    const assignment = agentModelAssignment;
    if (modelRuntimeBusy || assignment === null || assignment.activeModelInstallationId === null) {
      return;
    }
    const model = localAiModels.find(
      (candidate) => candidate.id === assignment.activeModelInstallationId
    );
    if (model === undefined) {
      setProfileMessage("The attached model file is missing from this device.");
      return;
    }
    setModelRuntimeBusy(true);
    try {
      setProfileMessage(`Testing ${model.displayName} with a real local inference…`);
      const result = await testAgentModelRuntime(getModelRuntime(), model);
      const next = assignmentAfterReadiness(assignment, result);
      saveDeviceAgentModelAssignment(next);
      setAgentModelAssignment(next);
      setProfileMessage(result.message);
    } finally {
      setModelRuntimeBusy(false);
    }
  }

  async function removeModelFromAgent() {
    const installationId = agentModelAssignment?.activeModelInstallationId;
    if (installationId === null || installationId === undefined) return;
    if (!navigator.onLine) {
      throw new Error("Connect to the internet to synchronize removal from this agent.");
    }
    await deleteJson(
      `/businesses/${business.id}/agent-model?deviceId=${encodeURIComponent(deviceId)}`
    );
    const fallback = assignmentFromServer(
      await getJson<AgentModelAssignmentSummary>(
        `/businesses/${business.id}/agent-model?deviceId=${encodeURIComponent(deviceId)}`
      )
    );
    await getModelRuntime().unload(installationId);
    saveDeviceAgentModelAssignment(fallback);
    setAgentModelAssignment(fallback);
    const fallbackModelId = fallback.modelId ?? "sokoclaw-local";
    setActiveAiModelId(fallbackModelId);
    updateAgent({ model: fallbackModelId });
    onAgentChange({ ...agent, model: fallbackModelId });
    setProfileMessage(
      "The downloaded model was removed. Download and test another GGUF model to reconnect the agent; the cloud selection remains fallback-only."
    );
  }

  async function updateAgentModelPolicy(
    patch: Partial<Pick<DeviceAgentModelAssignment, "preferredExecutionMode" | "fallbackPolicy">>
  ) {
    if (agentModelAssignment === null) return;
    const next = { ...agentModelAssignment, ...patch, updatedAt: new Date().toISOString() };
    saveDeviceAgentModelAssignment(next);
    setAgentModelAssignment(next);
    if (navigator.onLine && next.activeModelInstallationId !== null) {
      const saved = await putJson<AgentModelAssignmentSummary>(
        `/businesses/${business.id}/agent-model`,
        {
          deviceId,
          installationId: next.activeModelInstallationId,
          preferredExecutionMode: next.preferredExecutionMode,
          fallbackPolicy: next.fallbackPolicy,
          readinessStatus: next.readinessStatus,
          lastSuccessfulInferenceAt: next.lastSuccessfulInferenceAt,
          lastErrorCode: next.lastErrorCode
        }
      );
      const synchronized = assignmentFromServer(saved);
      saveDeviceAgentModelAssignment(synchronized);
      setAgentModelAssignment(synchronized);
    }
  }

  async function loadConnectedSocialAccounts() {
    try {
      const response = await getJson<ConnectedSocialAccountsResponse>("/auth/accounts");
      setConnectedSocialAccounts(response.accounts);
    } catch (error) {
      setProfileMessage(getErrorMessage(error));
    }
  }

  // Same account identities as loadConnectedSocialAccounts, gated by business:read on this shop
  // instead of plain session ownership - useful for a staff member with shop access who needs to
  // confirm which login methods are attached to the account without leaving the shop context.
  async function loadBusinessSocialAccounts() {
    try {
      const response = await getJson<ConnectedSocialAccountsResponse>(
        `/businesses/${business.id}/social-accounts`
      );
      setBusinessSocialAccounts(response.accounts);
    } catch (error) {
      setProfileMessage(getErrorMessage(error));
    }
  }

  async function loadConnectedMailboxes() {
    try {
      const [providerResponse, mailboxResponse] = await Promise.all([
        getJson<{ providers: ConnectedMailboxProviderSummary[] }>(
          `/businesses/${business.id}/mailboxes/providers`
        ),
        getJson<{ mailboxes: ConnectedMailboxSummary[] }>(`/businesses/${business.id}/mailboxes`)
      ]);
      setConnectedMailboxProviders(providerResponse.providers);
      setConnectedMailboxes(mailboxResponse.mailboxes);
    } catch (error) {
      setProfileMessage(getErrorMessage(error));
    }
  }

  async function connectMailbox(provider: ConnectedMailboxProvider) {
    const started = await postJson<ConnectedMailboxOAuthStartSummary>(
      `/businesses/${business.id}/mailboxes/oauth/${provider}/start`,
      {}
    );
    window.location.assign(started.authorizationUrl);
  }

  async function updateMailbox(
    mailboxId: string,
    patch: {
      isDefault?: boolean;
      ingestUnknownSenders?: boolean;
      automaticReplyEnabled?: boolean;
      automaticReplyText?: string | null;
    }
  ) {
    await patchJson<ConnectedMailboxSummary>(
      `/businesses/${business.id}/mailboxes/${encodeURIComponent(mailboxId)}`,
      patch
    );
    await loadConnectedMailboxes();
    setProfileMessage("Connected mailbox settings saved.");
  }

  async function syncMailbox(mailboxId: string, historyDays?: number) {
    const result = await postJson<ConnectedMailboxSyncSummary>(
      `/businesses/${business.id}/mailboxes/${encodeURIComponent(mailboxId)}/sync`,
      historyDays === undefined ? {} : { historyDays }
    );
    await loadConnectedMailboxes();
    setProfileMessage(
      `Mailbox synced: ${result.ingested} received, ${result.deduplicated} already known, ${result.filtered} filtered.`
    );
  }

  async function disconnectMailbox(mailboxId: string) {
    await deleteJson<ConnectedMailboxSummary>(
      `/businesses/${business.id}/mailboxes/${encodeURIComponent(mailboxId)}`
    );
    await loadConnectedMailboxes();
    setProfileMessage("Connected mailbox disconnected. Your Soko account email was unchanged.");
  }

  async function disconnectBusinessSocialAccount(identityId: string) {
    try {
      await deleteJson<{ disconnected: true; identityId: string }>(
        `/businesses/${business.id}/social-accounts/${encodeURIComponent(identityId)}`
      );
      await loadBusinessSocialAccounts();
      setProfileMessage("Social account disconnected.");
    } catch (error) {
      setProfileMessage(getErrorMessage(error));
    }
  }

  async function loadPasskeys() {
    if (!browserSupportsWebAuthn()) {
      setPasskeys([]);
      return;
    }

    try {
      const response = await getJson<PasskeyListResponse>("/auth/passkeys");
      setPasskeys(response.passkeys);
      setPasskeyLabels(
        Object.fromEntries(response.passkeys.map((passkey) => [passkey.id, passkey.label]))
      );
    } catch (error) {
      setProfileMessage(getErrorMessage(error));
    }
  }

  async function loadMfaFactors() {
    try {
      const response = await getJson<{
        factors: Array<{ id: string; type: "totp"; createdAt: string }>;
      }>("/auth/mfa/factors");
      setMfaFactors(response.factors);
    } catch (error) {
      setProfileMessage(getErrorMessage(error));
    }
  }

  async function beginTotpSetup() {
    try {
      const setup = await postJson<{ factorId: string; secret: string; otpauthUri: string }>(
        "/auth/mfa/totp/setup",
        {}
      );
      setPendingTotp(setup);
      setMfaRecoveryCodes([]);
      setProfileMessage("Add this secret to your authenticator app, then enter its code.");
    } catch (error) {
      setProfileMessage(getErrorMessage(error));
    }
  }

  async function confirmTotpSetup() {
    if (pendingTotp === null) return;
    try {
      const result = await postJson<{ recoveryCodes: string[] }>("/auth/mfa/totp/confirm", {
        factorId: pendingTotp.factorId,
        code: mfaCode
      });
      setMfaRecoveryCodes(result.recoveryCodes);
      setPendingTotp(null);
      setMfaCode("");
      await loadMfaFactors();
      setProfileMessage("MFA enabled. Save the recovery codes; they are shown once.");
    } catch (error) {
      setProfileMessage(getErrorMessage(error));
    }
  }

  async function disableTotpFactor(factorId: string) {
    try {
      await deleteJson<{ disabled: true }>(`/auth/mfa/factors/${encodeURIComponent(factorId)}`, {
        code: mfaCode
      });
      setMfaCode("");
      await loadMfaFactors();
      setProfileMessage("MFA disabled.");
    } catch (error) {
      setProfileMessage(getErrorMessage(error));
    }
  }

  async function regenerateMfaRecoveryCodes() {
    try {
      const result = await postJson<{ recoveryCodes: string[] }>(
        "/auth/mfa/recovery-codes/regenerate",
        {}
      );
      setMfaRecoveryCodes(result.recoveryCodes);
      setProfileMessage("New recovery codes generated. Save them - the old codes no longer work.");
    } catch (error) {
      setProfileMessage(getErrorMessage(error));
    }
  }

  async function loadDeviceSessions() {
    try {
      const response = await getJson<{ sessions: DeviceSessionSummary[] }>("/auth/sessions");
      setDeviceSessions(response.sessions);
    } catch (error) {
      setProfileMessage(getErrorMessage(error));
    }
  }

  async function revokeDeviceSession(sessionId: string) {
    const revoked = await deleteJson<DeviceSessionSummary>(
      `/auth/sessions/${encodeURIComponent(sessionId)}`
    );
    if (revoked.current) {
      onLogout();
      return;
    }
    await loadDeviceSessions();
    setProfileMessage("The selected device session was revoked.");
  }

  async function updateOwnerPhone() {
    const selectedCountry = getCountryDialCode(ownerPhoneCountryCode);

    try {
      const normalizedPhone = normalizeOwnerPhoneInput(
        ownerPhoneNumber,
        selectedCountry.countryCode
      );
      const response = await putJson<{ user: SessionResponse["user"] }>("/account/phone", {
        phoneNumber: normalizedPhone,
        country: selectedCountry.countryCode
      });
      onOwnerUserChange(response.user);
      setOwnerPhoneNumber(response.user.phoneNumberE164 ?? normalizedPhone);
      setOwnerPhoneError("");
      setOwnerPhoneMergeRequired(false);
      setOwnerPhoneMergePin("");
      setProfileMessage("Private owner phone number updated. Verification status: unverified.");
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === "PHONE_ALREADY_IN_USE") {
        setOwnerPhoneMergeRequired(true);
        setOwnerPhoneError("");
        setProfileMessage(
          "That number belongs to your existing Soko account. Enter its PIN to verify ownership and join both accounts without losing data."
        );
        return;
      }
      const message = getErrorMessage(error);
      setOwnerPhoneError(message);
      setProfileMessage(message);
    }
  }

  async function mergeOwnerPhoneAccount() {
    const selectedCountry = getCountryDialCode(ownerPhoneCountryCode);
    const normalizedPhone = normalizeOwnerPhoneInput(ownerPhoneNumber, selectedCountry.countryCode);
    const response = await postJson<SessionResponse>("/auth/identity/merge/pin", {
      method: "phone",
      contact: normalizedPhone,
      pin: ownerPhoneMergePin
    });
    setOwnerPhoneMergeRequired(false);
    setOwnerPhoneMergePin("");
    onAccountMerged(response);
    setProfileMessage("Identity verified. Both accounts and their Soko data are now joined.");
  }

  async function startEmailIdentityUpgrade() {
    recordOnboardingEvent("identity_upgrade_started");
    const response = await postJson<{
      challengeId: string;
      developmentCode?: string;
      mergeRequired: boolean;
    }>("/auth/identity/email/start", { email: ownerEmail });
    setEmailChallengeId(response.challengeId);
    setEmailVerificationCode(response.developmentCode ?? "");
    setEmailMergeRequired(response.mergeRequired);
    setProfileMessage(
      response.mergeRequired
        ? "That email belongs to your existing Soko account. Enter the emailed code to verify ownership and join both accounts."
        : "Check your email for the verification code."
    );
  }

  async function verifyEmailIdentityUpgrade() {
    if (emailMergeRequired) {
      const merged = await postJson<SessionResponse>("/auth/identity/email/merge/verify", {
        challengeId: emailChallengeId,
        code: emailVerificationCode
      });
      onAccountMerged(merged);
      setEmailChallengeId("");
      setEmailVerificationCode("");
      setEmailMergeRequired(false);
      setProfileMessage("Email verified. Both accounts and their Soko data are now joined.");
      return;
    }
    const result = await postJson<{
      verified: true;
      accountId: string;
      identityLevel: "verified_contact" | "strong";
    }>("/auth/identity/email/verify", {
      challengeId: emailChallengeId,
      code: emailVerificationCode
    });
    onIdentityLevelChange(result.identityLevel);
    if (ownerUser !== null) {
      onOwnerUserChange({
        ...ownerUser,
        emailAddress: ownerEmail.trim(),
        emailVerificationStatus: "verified"
      });
    }
    setEmailChallengeId("");
    setEmailVerificationCode("");
    setEmailMergeRequired(false);
    setProfileMessage("Email verified. Your existing Soko account is now recoverable by email.");
  }

  async function registerPasskey() {
    if (!browserSupportsWebAuthn()) {
      setProfileMessage("Passkeys are not supported in this browser.");
      return;
    }

    try {
      const challenge = await postJson<PasskeyRegistrationOptionsResponse>(
        "/auth/passkeys/register/options",
        {}
      );
      const credential = await startRegistration({
        optionsJSON: challenge.options
      });
      await postJson<PasskeySummary>("/auth/passkeys/register/verify", {
        ceremonyId: challenge.ceremonyId,
        label: passkeyDeviceLabel(),
        response: credential
      });
      await loadPasskeys();
      setProfileMessage("Passkey added. You can now sign in with this device or synced passkey.");
    } catch (error) {
      setProfileMessage(getErrorMessage(error));
    }
  }

  async function revokePasskey(credentialId: string) {
    try {
      await deleteJson<{ revoked: true }>(`/auth/passkeys/${encodeURIComponent(credentialId)}`);
      await loadPasskeys();
      setProfileMessage("Passkey revoked.");
    } catch (error) {
      setProfileMessage(getErrorMessage(error));
    }
  }

  async function renamePasskey(credentialId: string, currentLabel: string, nextLabel: string) {
    const label = nextLabel.trim();
    if (!label || label === currentLabel) return;
    try {
      await patchJson<PasskeySummary>(`/auth/passkeys/${encodeURIComponent(credentialId)}`, {
        label
      });
      await loadPasskeys();
      setProfileMessage("Passkey renamed.");
    } catch (error) {
      setProfileMessage(getErrorMessage(error));
    }
  }

  async function loadMcpTokens() {
    try {
      const response = await getJson<{ tokens: McpAccessTokenSummary[] }>("/v1/mcp/tokens");
      setMcpTokens(response.tokens);
    } catch (error) {
      setProfileMessage(getErrorMessage(error));
    }
  }

  async function createMcpToken() {
    const scopes: McpAccessScope[] = [
      ...(mcpReadEnabled ? (["mcp:read"] as const) : []),
      ...(mcpActEnabled ? (["mcp:act"] as const) : [])
    ];
    if (scopes.length === 0) {
      setProfileMessage("Select at least one MCP permission.");
      return;
    }
    try {
      if (mcpActEnabled) {
        await postJson<{ verified: boolean }>("/auth/pin/verify", { pin: mcpPin });
      }
      const created = await postJson<McpAccessTokenCreated>("/v1/mcp/tokens", {
        name: mcpTokenName,
        scopes,
        shopId: business.id,
        expiresInSeconds: 86_400
      });
      setNewMcpAccessToken(created.accessToken);
      setMcpPin("");
      await loadMcpTokens();
      setProfileMessage("MCP token created. Copy it now; the secret is shown only once.");
    } catch (error) {
      setProfileMessage(getErrorMessage(error));
    }
  }

  async function revokeMcpToken(tokenId: string) {
    try {
      await deleteJson<McpAccessTokenSummary>(`/v1/mcp/tokens/${encodeURIComponent(tokenId)}`);
      await loadMcpTokens();
      setProfileMessage("MCP token revoked.");
    } catch (error) {
      setProfileMessage(getErrorMessage(error));
    }
  }

  async function loadShopDeletionPreview() {
    try {
      const preview = await getJson<ShopDeletionPreviewSummary>(
        `/businesses/${business.id}/shop-deletion/preview`
      );
      setDeletionPreview(preview);
    } catch {
      setDeletionPreview(null);
    }
  }

  async function disconnectSocialAccount(identityId: string) {
    try {
      await deleteJson<{ disconnected: true; identityId: string }>(
        `/auth/accounts/${encodeURIComponent(identityId)}/disconnect`
      );
      await loadConnectedSocialAccounts();
      setProfileMessage("Social account disconnected.");
    } catch (error) {
      setProfileMessage(getErrorMessage(error));
    }
  }

  async function changeAccountPassword() {
    if (changePasswordNew !== changePasswordConfirm) {
      setProfileMessage("New password and confirmation do not match.");
      return;
    }
    try {
      const result = await postJson<{ changed: true; revokedSessions: number }>(
        "/auth/password/change",
        {
          currentPassword: changePasswordCurrent,
          password: changePasswordNew,
          passwordConfirmation: changePasswordConfirm,
          ...(changePasswordMfaCode.trim() ? { mfaCode: changePasswordMfaCode.trim() } : {})
        }
      );
      setChangePasswordCurrent("");
      setChangePasswordNew("");
      setChangePasswordConfirm("");
      setChangePasswordMfaCode("");
      setProfileMessage(
        result.revokedSessions > 0
          ? `Password changed. ${result.revokedSessions} other device session(s) were signed out.`
          : "Password changed."
      );
    } catch (error) {
      setProfileMessage(getErrorMessage(error));
    }
  }

  async function reconnectLoginAccount(provider: SocialSignupProvider) {
    const configured = oauthProviders.find((item) => item.id === provider)?.configured === true;
    if (!configured) {
      setProfileMessage("This login provider is not configured yet.");
      return;
    }
    try {
      const response = await postJson<OAuthStartResponse>(
        `/auth/accounts/${encodeURIComponent(provider)}/link/start`,
        { redirectUri: `${window.location.origin}${routes.oauthCallback}` }
      );
      sessionStorage.setItem(
        pendingOAuthStorageKey,
        JSON.stringify({
          csrfToken: response.csrfToken,
          provider: response.provider,
          state: response.state
        })
      );
      setProfileMessage(`Redirecting to ${response.provider} to verify the login account.`);
      window.location.assign(response.authorizationUrl);
    } catch (error) {
      setProfileMessage(getErrorMessage(error));
    }
  }

  async function startShopDeletion() {
    try {
      const response = await postJson<ShopDeletionRequestResult>(
        `/businesses/${business.id}/shop-deletion/request`,
        {
          shopId: deletionShopId
        }
      );

      setDeletionRequest(response.request);
      setDeletionPreview(response.preview);
      setDeletionStep("shop-verify");
      setProfileMessage("Confirm with your owner PIN. No OTP is required.");
    } catch (error) {
      setProfileMessage(getErrorMessage(error));
    }
  }

  async function finalizeShopDeletion() {
    if (deletionRequest === null) {
      return;
    }

    try {
      const result = await postJson<AccountDeletionRequestSummary>(
        `/businesses/${business.id}/shop-deletion/${deletionRequest.id}/finalize`,
        {
          pin: deletionPin,
          acknowledgement: deletionAcknowledged,
          idempotencyKey: `web-${business.id}-${deletionRequest.id}`
        }
      );
      setDeletionRequest(result);
      setDeletionStep("shop-status");
      setProfileMessage(
        result.status === "QUARANTINED"
          ? "Shop hidden and quarantined. You can restore it for 30 days."
          : "Shop deletion is being processed."
      );
    } catch (error) {
      setProfileMessage(getErrorMessage(error));
    }
  }

  async function restoreShop() {
    if (deletionRequest === null) return;
    try {
      const result = await postJson<AccountDeletionRequestSummary>(
        `/businesses/${business.id}/shop-deletion/${deletionRequest.id}/restore`,
        {}
      );
      setDeletionRequest(result);
      setProfileMessage("Shop restored to active service.");
      await loadShopDeletionPreview();
    } catch (error) {
      setProfileMessage(getErrorMessage(error));
    }
  }

  async function finalizeAccountDeletion() {
    const deleted = await onScheduleAccountDeletion({
      pin: accountDeletionPin,
      confirmation: accountDeletionConfirmation,
      reason: accountDeletionReason
    });

    if (!deleted) {
      setProfileMessage("The account deletion request could not be completed.");
    }
  }

  function cancelDeletion() {
    setDeletionStep("idle");
    setDeletionShopId("");
    setDeletionPin("");
    setDeletionAcknowledged(false);
    setAccountDeletionConfirmation("");
    setAccountDeletionReason("");
    setAccountDeletionPin("");
    setAccountDeletionAcknowledged(false);
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

  async function unlockContextScripts() {
    const pin = contextPassword.trim();
    if (!/^\d{4}$/u.test(pin)) {
      setContextUnlockError("Enter your 4-digit owner PIN.");
      return;
    }

    try {
      await postJson<{ verified: boolean }>("/auth/pin/verify", { pin });
      setContextUnlocked(true);
      setContextPassword("");
      setContextUnlockError("");
    } catch (error) {
      setContextUnlockError(getErrorMessage(error));
    }
  }

  function updateContextScript(index: number, value: string) {
    updateAgent({
      contextScripts: draftAgent.contextScripts.map((script, scriptIndex) =>
        scriptIndex === index ? value : script
      )
    });
  }

  function addContextScript() {
    updateAgent({
      contextScripts: [
        ...draftAgent.contextScripts,
        "# Local vocabulary\n\n- script: local_vocabulary\n- priority: required\n- allow: read, add, edit, remove\n"
      ]
    });
  }

  function addContextLanguage() {
    updateAgent({
      contextScripts: [
        ...draftAgent.contextScripts,
        "# Swahili local vocabulary\n\n- script: local_vocabulary_sw\n- language: sw\n- priority: required\n- allow: read, add, edit, remove\n"
      ]
    });
    setContextUnlockError("Swahili Markdown context file added. Review it before saving.");
  }

  async function importContextFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;

    const markdownFiles = files.filter(
      (file) => /\.(?:md|markdown)$/i.test(file.name) && file.size <= 1_000_000
    );
    if (markdownFiles.length !== files.length) {
      setContextUnlockError("Context files must be Markdown (.md) files no larger than 1 MB.");
      return;
    }

    try {
      const contents = sanitizeContextScripts(
        await Promise.all(markdownFiles.map((file) => file.text()))
      );
      updateAgent({
        contextScripts: [...draftAgent.contextScripts, ...contents].slice(0, 12)
      });
      setContextUnlockError(
        `Imported ${contents.length} Markdown context ${contents.length === 1 ? "file" : "files"}.`
      );
    } catch (error) {
      setContextUnlockError(getErrorMessage(error));
    }
  }

  function editFirstContextPhrase() {
    const editor = document.getElementById("agent-context-script-0");
    if (editor instanceof HTMLTextAreaElement) {
      editor.focus();
      editor.setSelectionRange(0, editor.value.length);
      setContextUnlockError("Edit the selected script, then save changes.");
      return;
    }
    setContextUnlockError("Add a phrase before editing.");
  }

  function testContextPhrase() {
    const phrase = contextTestPhrase.trim();
    if (phrase.length === 0) {
      setContextUnlockError("Enter a phrase to test.");
      return;
    }
    const result = resolveContextScriptCommand(draftAgent.contextScripts, phrase);
    setContextUnlockError(
      result === null
        ? "No product context-script match was found."
        : `Matched ${result.intent} with ${Math.round(result.confidence * 100)}% confidence.`
    );
  }

  function testProductVocabularyScript() {
    const enabledEntries = defaultProductVocabularyContextScript.entries.filter(
      (entry) => entry.enabled
    );
    const failedEntries = enabledEntries.filter((entry) => {
      const match = parseProductContextScriptCommand({
        message: entry.phrase,
        contextScripts: draftAgent.contextScripts,
        tenantId: "settings-validation"
      });
      return match === null || match.intent !== entry.intent;
    });

    setContextUnlockError(
      failedEntries.length === 0
        ? `Product vocabulary validation passed ${enabledEntries.length}/${enabledEntries.length} configured phrases.`
        : `Product vocabulary validation matched ${enabledEntries.length - failedEntries.length}/${enabledEntries.length} phrases. Review the context files before saving.`
    );
  }

  function removeContextScript(index: number) {
    updateAgent({
      contextScripts: draftAgent.contextScripts.filter((_, scriptIndex) => scriptIndex !== index)
    });
  }

  const bestFitModels =
    deviceCapability === null
      ? []
      : rankCatalogModelsForDevice(visibleAiModels, deviceCapability).slice(0, 3);
  const offlineStarter =
    deviceCapability === null
      ? defaultOfflineAiModels[0]
      : rankCatalogModelsForDevice(defaultOfflineAiModels, deviceCapability)[0]?.model;
  const offlineStarterInstalled =
    offlineStarter !== undefined &&
    localAiModels.some((localModel) => localModel.modelId === offlineStarter.id);
  const activeInstalledModel =
    agentModelAssignment?.activeModelInstallationId === null ||
    agentModelAssignment?.activeModelInstallationId === undefined
      ? null
      : (localAiModels.find(
          (model) => model.id === agentModelAssignment.activeModelInstallationId
        ) ?? null);
  const activeAiModel = aiModels.find((model) => model.id === activeAiModelId);
  const cloudFallbackModel = aiModels.find((model) => model.id === cloudFallbackModelId);
  const backendModels = visibleAiModels.filter(
    (model) => model.provider === "openai" && model.source === "hosted" && model.format === "remote"
  );
  const serverBackendModels = visibleAiModels.filter(
    (model) =>
      model.id === "qwen2.5-0.5b-android" || model.capabilities.includes("backend-inference")
  );
  const hasReadyLocalModel =
    activeInstalledModel !== null &&
    agentModelAssignment?.readinessStatus === "READY" &&
    agentModelAssignment.lastSuccessfulInferenceAt !== null;
  const orderedInstalledModels = [...localAiModels].sort((left, right) => {
    const leftCompatible = left.compatibilityStatus === "COMPATIBLE" ? 0 : 1;
    const rightCompatible = right.compatibilityStatus === "COMPATIBLE" ? 0 : 1;
    return leftCompatible - rightCompatible || left.displayName.localeCompare(right.displayName);
  });
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

      {shops.length > 1 ? (
        <section className="record-form" aria-label="Your shops">
          <div className="section-heading">
            <p className="eyebrow">Account</p>
            <h3>Your shops</h3>
          </div>
          <div className="connected-social-list" role="list">
            {shops.map((shop) => (
              <article className="connected-social-card" role="listitem" key={shop.business.id}>
                <div>
                  <span>{shop.business.sokoId}</span>
                  <strong>{shop.business.name}</strong>
                  <p>{shop.membership.role}</p>
                </div>
                {shop.business.id === business.id ? (
                  <span className="shell-note">Current shop</span>
                ) : (
                  <button type="button" onClick={() => onSwitchBusiness(shop)}>
                    Switch to this shop
                  </button>
                )}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="agent-settings-grid">
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
              The selected model is synchronized with the backend. Local models become ready only
              after backend validation and a real runtime test succeed.
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

        <div className="record-form agent-runtime-panel">
          <div className="section-heading">
            <p className="eyebrow">Business runtime</p>
            <h3>Readiness and versions</h3>
            <p>
              The server binds this agent to {business.name}, compiles policy, retrieves permitted
              context, and records the exact runtime version used for every turn.
            </p>
          </div>
          <div className="runtime-status-grid" aria-live="polite">
            <span
              className={`model-badge ${runtimeReadiness?.ready ? "status-ready" : "status-loading"}`}
            >
              {runtimeDetailsLoading
                ? "Checking…"
                : runtimeReadiness?.ready
                  ? "Ready"
                  : "Needs attention"}
            </span>
            <strong>
              Active version {runtimeReadiness?.runtimeVersion ?? draftAgent.runtimeVersion}
            </strong>
            {hasUnsavedRuntimeChanges ? (
              <span className="runtime-unsaved">Unsaved draft changes</span>
            ) : null}
          </div>
          {runtimeReadiness?.issues.map((issue) => (
            <p className="security-warning" key={issue.code}>
              {issue.message}
            </p>
          ))}
          <div className="runtime-version-list" aria-label="Agent runtime version history">
            {runtimeVersions.slice(0, 5).map((version) => (
              <article key={version.id}>
                <div>
                  <strong>Version {version.version}</strong>
                  <small>
                    {version.changeSummary} · {formatDate(version.createdAt)}
                  </small>
                </div>
                {version.version !== runtimeReadiness?.runtimeVersion ? (
                  <button
                    className="secondary"
                    type="button"
                    disabled={isEditing || pendingProfileAction !== null}
                    onClick={() =>
                      void runProfileAction(`runtime-rollback-${version.version}`, () =>
                        rollbackAgentRuntime(version.version)
                      )
                    }
                  >
                    Restore as new version
                  </button>
                ) : (
                  <span className="model-badge status-ready">Active</span>
                )}
              </article>
            ))}
            {!runtimeDetailsLoading && runtimeVersions.length === 0 ? (
              <p className="shell-note">Save the profile to create its first version.</p>
            ) : null}
          </div>
        </div>

        <div className="record-form agent-runtime-panel">
          <div className="section-heading">
            <p className="eyebrow">Structured personality</p>
            <h3>Voice and customer care</h3>
            <p>Style can shape wording, but it cannot override business or security policy.</p>
          </div>
          <div className="runtime-field-grid">
            <label>
              Tone
              <select
                value={draftAgent.personalityConfig.tone}
                disabled={!isEditing}
                onChange={(event) =>
                  updateAgent({
                    personalityConfig: {
                      ...draftAgent.personalityConfig,
                      tone: event.target.value as AgentPersonality["tone"]
                    }
                  })
                }
              >
                <option value="warm">Warm</option>
                <option value="neutral">Neutral</option>
                <option value="direct">Direct</option>
                <option value="formal">Formal</option>
              </select>
            </label>
            <label>
              Formality
              <select
                value={draftAgent.personalityConfig.formality}
                disabled={!isEditing}
                onChange={(event) =>
                  updateAgent({
                    personalityConfig: {
                      ...draftAgent.personalityConfig,
                      formality: event.target.value as AgentPersonality["formality"]
                    }
                  })
                }
              >
                <option value="casual">Casual</option>
                <option value="balanced">Balanced</option>
                <option value="formal">Formal</option>
              </select>
            </label>
            <label>
              Response length
              <select
                value={draftAgent.personalityConfig.responseLength}
                disabled={!isEditing}
                onChange={(event) =>
                  updateAgent({
                    personalityConfig: {
                      ...draftAgent.personalityConfig,
                      responseLength: event.target.value as AgentPersonality["responseLength"]
                    }
                  })
                }
              >
                <option value="brief">Brief</option>
                <option value="balanced">Balanced</option>
                <option value="detailed">Detailed</option>
              </select>
            </label>
            <label>
              Selling style
              <select
                value={draftAgent.personalityConfig.sellingStyle}
                disabled={!isEditing}
                onChange={(event) =>
                  updateAgent({
                    personalityConfig: {
                      ...draftAgent.personalityConfig,
                      sellingStyle: event.target.value as AgentPersonality["sellingStyle"]
                    }
                  })
                }
              >
                <option value="consultative">Consultative</option>
                <option value="informative">Informative</option>
                <option value="proactive">Proactive</option>
              </select>
            </label>
          </div>
          <label>
            Public introduction
            <textarea
              value={draftAgent.publicIntroduction}
              disabled={!isEditing}
              rows={2}
              onChange={(event) => updateAgent({ publicIntroduction: event.target.value })}
            />
          </label>
          <label>
            Additional style guidance
            <textarea
              value={draftAgent.personalityConfig.additionalGuidance}
              disabled={!isEditing}
              rows={3}
              onChange={(event) =>
                updateAgent({
                  personality: event.target.value,
                  personalityConfig: {
                    ...draftAgent.personalityConfig,
                    additionalGuidance: event.target.value
                  }
                })
              }
            />
          </label>
        </div>

        <div className="record-form agent-runtime-panel">
          <div className="section-heading">
            <p className="eyebrow">Structured business policy</p>
            <h3>Sales, pricing, and escalation</h3>
            <p>These rules are enforced server-side before a tool proposal can run.</p>
          </div>
          <div className="runtime-field-grid">
            <label>
              Maximum discount (%)
              <input
                type="number"
                min={0}
                max={100}
                value={draftAgent.instructionPolicy.maximumDiscountPercent}
                disabled={!isEditing}
                onChange={(event) =>
                  updateAgent({
                    instructionPolicy: {
                      ...draftAgent.instructionPolicy,
                      maximumDiscountPercent: Number(event.target.value)
                    }
                  })
                }
              />
            </label>
            <label>
              Maximum credit days
              <input
                type="number"
                min={0}
                max={3650}
                value={draftAgent.instructionPolicy.maximumCreditDays}
                disabled={!isEditing || !draftAgent.instructionPolicy.creditSalesAllowed}
                onChange={(event) =>
                  updateAgent({
                    instructionPolicy: {
                      ...draftAgent.instructionPolicy,
                      maximumCreditDays: Number(event.target.value)
                    }
                  })
                }
              />
            </label>
          </div>
          <div className="runtime-policy-toggles">
            {(
              [
                { key: "negotiationAllowed", label: "Allow negotiation" },
                { key: "creditSalesAllowed", label: "Allow credit sales" },
                { key: "substituteOutOfStockAllowed", label: "Allow stock substitutions" },
                { key: "catalogueModificationAllowed", label: "Allow catalogue changes" },
                { key: "externalMessagingAllowed", label: "Allow external messaging" }
              ] as const
            ).map(({ key, label }) => (
              <label className="checkbox-row" key={key}>
                <input
                  type="checkbox"
                  disabled={!isEditing}
                  checked={Boolean(draftAgent.instructionPolicy[key as keyof AgentInstructions])}
                  onChange={(event) =>
                    updateAgent({
                      instructionPolicy: {
                        ...draftAgent.instructionPolicy,
                        [key]: event.target.checked
                      }
                    })
                  }
                />
                {label}
              </label>
            ))}
          </div>
          <label>
            General operating rules (one per line)
            <textarea
              value={draftAgent.instructionPolicy.generalOperatingRules.join("\n")}
              disabled={!isEditing}
              rows={4}
              onChange={(event) =>
                updateAgent({
                  instructions: event.target.value,
                  instructionPolicy: {
                    ...draftAgent.instructionPolicy,
                    generalOperatingRules: splitMultilineInput(event.target.value)
                  }
                })
              }
            />
          </label>
          <label>
            Pricing rules (one per line)
            <textarea
              value={draftAgent.instructionPolicy.pricingRules.join("\n")}
              disabled={!isEditing}
              rows={3}
              onChange={(event) =>
                updateAgent({
                  instructionPolicy: {
                    ...draftAgent.instructionPolicy,
                    pricingRules: splitMultilineInput(event.target.value)
                  }
                })
              }
            />
          </label>
          <label>
            Escalation rules (one per line)
            <textarea
              value={draftAgent.instructionPolicy.escalationRules.join("\n")}
              disabled={!isEditing}
              rows={3}
              onChange={(event) =>
                updateAgent({
                  instructionPolicy: {
                    ...draftAgent.instructionPolicy,
                    escalationRules: splitMultilineInput(event.target.value)
                  }
                })
              }
            />
          </label>
        </div>

        <div className="record-form agent-runtime-panel">
          <div className="section-heading">
            <p className="eyebrow">Context manifest and executable skills</p>
            <h3>Runtime access</h3>
            <p>
              Context is retrieved only when relevant and authorized. Skill availability is
              independent of the active model.
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

        <div className="record-form agent-runtime-panel">
          <div className="section-heading">
            <p className="eyebrow">Memory and evaluation</p>
            <h3>Retention, feedback, and corrections</h3>
            <p>
              Memory is bounded by shop and policy. Evaluation records outcomes, not hidden
              reasoning.
            </p>
          </div>
          <div className="runtime-policy-toggles">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={draftAgent.memoryPolicy.ownerCorrectionsEnabled}
                disabled={!isEditing}
                onChange={(event) =>
                  updateAgent({
                    memoryPolicy: {
                      ...draftAgent.memoryPolicy,
                      ownerCorrectionsEnabled: event.target.checked
                    }
                  })
                }
              />
              Remember active owner corrections
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={draftAgent.memoryPolicy.customerConversationMemoryEnabled}
                disabled={!isEditing}
                onChange={(event) =>
                  updateAgent({
                    memoryPolicy: {
                      ...draftAgent.memoryPolicy,
                      customerConversationMemoryEnabled: event.target.checked
                    }
                  })
                }
              />
              Customer conversation memory (consent required)
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={draftAgent.evaluationPolicy.enabled}
                disabled={!isEditing}
                onChange={(event) =>
                  updateAgent({
                    evaluationPolicy: {
                      ...draftAgent.evaluationPolicy,
                      enabled: event.target.checked
                    }
                  })
                }
              />
              Record privacy-safe evaluation events
            </label>
          </div>
          <div className="runtime-evaluation-summary">
            <strong>{evaluationSummary?.total ?? 0} evaluated events</strong>
            <span>{evaluationSummary?.success ?? 0} successful</span>
            <span>{evaluationSummary?.blocked ?? 0} policy-blocked</span>
            <span>{evaluationSummary?.failure ?? 0} failed</span>
          </div>
          <div className="runtime-context-list" role="list" aria-label="Recent agent issues">
            {evaluationSummary?.recentEvents
              .filter((event) => event.outcome === "failure" || event.outcome === "blocked")
              .slice(0, 5)
              .map((event) => (
                <article key={event.id} role="listitem">
                  <div>
                    <strong>{event.eventType.replaceAll("_", " ")}</strong>
                    <small>
                      Runtime {event.runtimeVersion} · {event.reason ?? "No reason recorded"} ·{" "}
                      {formatDate(event.createdAt)}
                    </small>
                  </div>
                  <span className="model-badge">{event.outcome}</span>
                </article>
              ))}
          </div>
          <label>
            Owner correction
            <textarea
              value={correctionDraft}
              rows={3}
              placeholder="Example: Never offer free delivery outside Nairobi."
              onChange={(event) => setCorrectionDraft(event.target.value)}
            />
          </label>
          <div className="runtime-field-grid">
            <label>
              Correction type
              <select
                value={correctionCategory}
                onChange={(event) =>
                  setCorrectionCategory(event.target.value as AgentOwnerCorrection["category"])
                }
              >
                <option value="instruction">Instruction</option>
                <option value="business_fact">Business fact</option>
                <option value="memory">Memory</option>
                <option value="response">Response</option>
              </select>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={promoteCorrection}
                onChange={(event) => setPromoteCorrection(event.target.checked)}
              />
              Promote to versioned instructions
            </label>
          </div>
          <button
            type="button"
            disabled={correctionDraft.trim().length === 0 || pendingProfileAction !== null}
            onClick={() => void runProfileAction("agent-owner-correction", submitOwnerCorrection)}
          >
            Save correction
          </button>
          <div className="runtime-correction-list">
            {ownerCorrections.slice(0, 5).map((correction) => (
              <article key={correction.id}>
                <div>
                  <strong>{correction.category.replace("_", " ")}</strong>
                  <p>{correction.correction}</p>
                  <small>
                    Runtime {correction.runtimeVersion}
                    {correction.promotedToInstruction ? " · promoted" : " · memory only"}
                  </small>
                </div>
                {correction.status === "active" ? (
                  <button
                    className="secondary"
                    type="button"
                    disabled={pendingProfileAction !== null}
                    onClick={() =>
                      void runProfileAction(`disable-correction-${correction.id}`, () =>
                        disableOwnerCorrection(correction.id)
                      )
                    }
                  >
                    Disable
                  </button>
                ) : (
                  <span className="model-badge">Disabled</span>
                )}
              </article>
            ))}
          </div>
        </div>

        <div className="record-form agent-model-panel">
          <div className="section-heading">
            <p className="eyebrow">Device model first · cloud fallback second</p>
            <h3>Agent model</h3>
            <p>Choose, verify, and connect an installed model to this business agent.</p>
          </div>
          {modelActivationState !== "idle" && profileMessage.length > 0 ? (
            <p className="shell-note" role="status" aria-live="polite">
              {profileMessage}
            </p>
          ) : null}
          {modelRuntimeBusy && activatingModelId !== null ? (
            <button className="secondary" type="button" onClick={cancelModelActivation}>
              Cancel activation
            </button>
          ) : null}
          {activeInstalledModel === null ? (
            <article className="agent-model-current">
              <div>
                <span className="model-badge">Current model</span>
                <span
                  className={`model-badge status-${activeAgentModelBinding?.status ?? "failed"}`}
                >
                  {activeAgentModelBinding?.status === "active"
                    ? `Active for ${agent.name}`
                    : "Not configured"}
                </span>
              </div>
              <h4>
                {activeAgentModelBinding === null
                  ? "No verified model"
                  : (activeAiModel?.label ?? activeAgentModelBinding.modelId)}
              </h4>
              <p>
                {activeAgentModelBinding === null
                  ? "This agent does not have a working model yet. Test and activate one below."
                  : `Running on: ${formatExecutionTarget(activeAgentModelBinding.executionTarget)}`}
              </p>
              <small>
                {activeAgentModelBinding?.lastVerifiedAt === null ||
                activeAgentModelBinding?.lastVerifiedAt === undefined
                  ? "Not verified"
                  : `Verified ${formatDate(activeAgentModelBinding.lastVerifiedAt)}`}
              </small>
              <div className="ai-model-card-actions">
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
                <button type="button" onClick={() => void openModelLibrary()}>
                  Switch model
                </button>
              </div>
            </article>
          ) : (
            <article className="agent-model-current">
              <div>
                <span className="model-badge">Local</span>
                <span
                  className={`model-badge status-${agentModelAssignment?.readinessStatus.toLowerCase()}`}
                >
                  {agentModelAssignment?.readinessStatus === "READY"
                    ? modelActivationState === "active"
                      ? "Active"
                      : "Validated · runtime starts on use"
                    : agentModelAssignment?.readinessStatus === "LOADING"
                      ? "Loading"
                      : agentModelAssignment?.readinessStatus === "FAILED"
                        ? "Failed"
                        : "Attached to agent"}
                </span>
              </div>
              <h4>{activeInstalledModel.displayName}</h4>
              <p>
                {formatModelBytes(activeInstalledModel.fileSizeBytes)}
                {activeInstalledModel.quantization === null
                  ? ""
                  : ` · ${activeInstalledModel.quantization}`}
                {` · ${formatModelStatus(activeInstalledModel.installationStatus)}`}
                {` · ${formatModelStatus(activeInstalledModel.compatibilityStatus)}`}
              </p>
              <small>
                Last successful inference:{" "}
                {agentModelAssignment?.lastSuccessfulInferenceAt === null ||
                agentModelAssignment?.lastSuccessfulInferenceAt === undefined
                  ? "Not yet"
                  : formatDate(agentModelAssignment.lastSuccessfulInferenceAt)}
              </small>
              <small>Cloud fallback: {cloudFallbackModel?.label ?? "Not configured"}</small>
            </article>
          )}
          <details className="agent-model-advanced">
            <summary>Advanced routing</summary>
            <section className="browser-model-control" aria-label="Browser-local inference">
              <div>
                <strong>Browser-local inference</strong>
                <p>
                  Run supported short chats on this device. A compatible model downloads only after
                  you turn this on; requests that need server tools stay on the confirmation-gated
                  server route.
                </p>
              </div>
              {browserLocalInferenceDeploymentEnabled ? (
                <label>
                  Browser model
                  <select
                    value={selectedBrowserModelId}
                    disabled={modelRuntimeBusy || browserInferenceState?.settings?.enabled === true}
                    onChange={(event) => setSelectedBrowserModelId(event.target.value)}
                  >
                    {browserModelOptions.map((option) => (
                      <option
                        key={option.model.id}
                        value={option.model.id}
                        disabled={!option.compatible}
                      >
                        {option.model.displayName}
                        {option.compatible ? "" : ` — ${option.reason ?? "incompatible"}`}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {browserLocalInferenceDeploymentEnabled ? (
                <label className="browser-model-toggle">
                  <input
                    type="checkbox"
                    checked={browserInferenceState?.settings?.enabled === true}
                    disabled={modelRuntimeBusy}
                    onChange={(event) => void setBrowserInferenceEnabled(event.target.checked)}
                  />
                  Use the browser model on this device
                </label>
              ) : (
                <p>Browser-local inference is unavailable in this deployment</p>
              )}
              <small>
                {browserLocalInferenceDeploymentEnabled
                  ? browserInferenceState?.capability.supported === true
                    ? `${browserInferenceState.capability.browser.name} · ${browserInferenceState.capability.backend.toUpperCase()} · ${browserInferenceState.capability.deviceTier} device`
                    : (browserInferenceState?.capability.reasons[0] ??
                      "Checking device compatibility…")
                  : "Disabled by deployment"}
              </small>
              <small>
                Status:{" "}
                {browserModelProgress === null
                  ? (browserInferenceState?.settings?.status ?? "Not downloaded")
                  : `${browserModelProgress.status} ${Math.round(browserModelProgress.percent)}%`}
                {selectedBrowserModel === null
                  ? ""
                  : ` · ${selectedBrowserModel.displayName} · about ${Math.round(
                      selectedBrowserModel.approximateDownloadBytes / 1_000_000
                    )} MB download · about ${Math.round(
                      selectedBrowserModel.approximateRuntimeMemoryBytes / 1_000_000
                    )} MB working memory`}
              </small>
              <small>
                Database workflow:{" "}
                {syncedBrowserInference === null
                  ? "Not synchronized"
                  : `${syncedBrowserInference.enabled ? "Enabled" : "Disabled"} · ${
                      syncedBrowserInference.readinessStatus
                    } · ${syncedBrowserInference.runtimeContract?.adapterId ?? "no adapter"} ${
                      syncedBrowserInference.runtimeContract?.adapterVersion ?? ""
                    }`}
              </small>
              <small>
                Only device, model, runtime-contract, readiness, and failure metadata are
                synchronized. Prompts and generated replies remain outside this record.
              </small>
              <div className="ai-model-card-actions">
                {browserModelProgress !== null ? (
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => {
                      cancelBrowserModelLoad();
                      setProfileMessage(
                        "Browser model download cancelled. Partial engine cache can be removed below."
                      );
                    }}
                  >
                    Cancel download
                  </button>
                ) : null}
                <button
                  className="secondary"
                  type="button"
                  disabled={
                    modelRuntimeBusy ||
                    browserInferenceState?.settings?.selectedModelId === null ||
                    browserInferenceState?.settings === null ||
                    browserInferenceState === null
                  }
                  onClick={() => void deleteBrowserModel()}
                >
                  Delete browser model
                </button>
              </div>
            </section>
            <section className="browser-model-control" aria-label="Client-first inference routing">
              <div>
                <strong>Client-first route permissions</strong>
                <p>
                  Soko uses the downloaded GGUF model through its llama.cpp-compatible harness
                  first. Another owner device or OpenAI can only be used as an allowed fallback.
                  Server tools remain confirmation-gated.
                </p>
              </div>
              <label className="browser-model-toggle">
                <input
                  type="checkbox"
                  checked={inferencePreferences.nativePermission}
                  disabled={!clientInferenceFeatureFlags.nativeBridge || modelRuntimeBusy}
                  onChange={(event) =>
                    updateInferencePreferences({ nativePermission: event.target.checked })
                  }
                />
                Allow installed-app GGUF inference
              </label>
              <small>
                Requires the trusted Soko installed-app bridge. Ordinary browsers reject GGUF
                activation without loading the model.
              </small>
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
              <label className="browser-model-toggle">
                <input
                  type="checkbox"
                  checked={inferencePreferences.cloudConsent}
                  disabled={!clientInferenceFeatureFlags.cloudFallback || modelRuntimeBusy}
                  onChange={(event) =>
                    updateInferencePreferences({ cloudConsent: event.target.checked })
                  }
                />
                Allow explicitly selected OpenAI fallback
              </label>
              <small>
                Off by default. OpenAI is used only after you select an available fallback model and
                the downloaded model cannot process the request. API credentials remain server-only.
              </small>
            </section>
            <label>
              Execution mode
              <select
                value={agentModelAssignment?.preferredExecutionMode ?? "LOCAL_FIRST"}
                disabled={agentModelAssignment === null || modelRuntimeBusy}
                onChange={(event) =>
                  void updateAgentModelPolicy({
                    preferredExecutionMode: event.target.value as PreferredExecutionMode
                  }).catch((error) => setProfileMessage(getErrorMessage(error)))
                }
              >
                <option value="LOCAL_ONLY">Local only</option>
                <option value="LOCAL_FIRST">Local first</option>
              </select>
            </label>
            <label>
              Fallback policy
              <select
                value={agentModelAssignment?.fallbackPolicy ?? "WHEN_LOCAL_UNAVAILABLE"}
                disabled={agentModelAssignment === null || modelRuntimeBusy}
                onChange={(event) =>
                  void updateAgentModelPolicy({
                    fallbackPolicy: event.target.value as AgentModelFallbackPolicy
                  }).catch((error) => setProfileMessage(getErrorMessage(error)))
                }
              >
                <option value="NEVER">Never</option>
                <option value="WHEN_LOCAL_UNAVAILABLE">When local is unavailable</option>
                <option value="WHEN_LOCAL_FAILS">When local fails</option>
                <option value="WHEN_CONTEXT_EXCEEDED">When context is exceeded</option>
              </select>
            </label>
          </details>
          <div className="ai-model-card-actions">
            <button
              type="button"
              disabled={modelRuntimeBusy}
              onClick={() => setModelChooserOpen(true)}
            >
              Choose model
            </button>
            <button
              className="secondary"
              type="button"
              disabled={activeInstalledModel === null || modelRuntimeBusy}
              onClick={() => void testAssignedModel()}
            >
              Test model
            </button>
            <button
              className="secondary"
              type="button"
              disabled={activeInstalledModel === null || modelRuntimeBusy}
              onClick={() =>
                void removeModelFromAgent().catch((error) =>
                  setProfileMessage(getErrorMessage(error))
                )
              }
            >
              Remove from agent
            </button>
          </div>
          {modelChooserOpen ? (
            <div
              className="agent-model-chooser"
              role="dialog"
              aria-modal="true"
              aria-label="Choose model"
            >
              <div className="section-heading">
                <h4>Installed models</h4>
                <button
                  className="secondary"
                  type="button"
                  aria-label="Close model chooser"
                  onClick={() => setModelChooserOpen(false)}
                >
                  Close
                </button>
              </div>
              {orderedInstalledModels.map((model) => {
                const usable =
                  model.installationStatus === "INSTALLED" &&
                  (model.compatibilityStatus === "COMPATIBLE" ||
                    model.compatibilityStatus === "UNKNOWN") &&
                  model.commercialUseAllowed;
                const modelInUse =
                  agentModelAssignment?.activeModelInstallationId === model.id &&
                  agentModelAssignment.readinessStatus === "READY";
                const modelActivating = activatingModelId === model.modelId;
                return (
                  <article className="agent-model-choice" key={model.id}>
                    <div>
                      <strong>{model.displayName}</strong>
                      <small>
                        {formatModelParameters(model.parameterCount)} ·{" "}
                        {model.quantization ?? "Quantization unknown"} ·{" "}
                        {formatModelBytes(model.fileSizeBytes)}
                      </small>
                      <small>
                        {model.license} ·{" "}
                        {model.commercialUseAllowed
                          ? "Commercial use allowed"
                          : "Commercial use restricted"}{" "}
                        · estimated {formatModelBytes(Math.ceil(model.fileSizeBytes * 2.5))} RAM
                      </small>
                      <small>
                        {formatModelStatus(model.compatibilityStatus)} ·{" "}
                        {agentModelAssignment?.activeModelInstallationId === model.id
                          ? formatModelStatus(agentModelAssignment.readinessStatus)
                          : "Installed, not attached"}
                      </small>
                    </div>
                    <button
                      className={`model-use-button ${
                        modelInUse ? "in-use" : modelActivating ? "activating" : "not-in-use"
                      }`}
                      type="button"
                      aria-pressed={modelInUse}
                      disabled={!usable || modelRuntimeBusy || modelInUse}
                      title={
                        usable ? undefined : (model.validationError ?? "Model is not compatible")
                      }
                      onClick={() => void useModelWithAgent(model)}
                    >
                      {modelInUse
                        ? "Active on this device"
                        : modelActivating
                          ? modelActivationMessage(modelActivationState)
                          : failedActivationModelId === model.modelId
                            ? "Not active · Retry device activation"
                            : "Not active · Activate on this device"}
                    </button>
                  </article>
                );
              })}
              {orderedInstalledModels.length === 0 ? (
                <p>No installed local models. Install one from the library below.</p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="record-form ai-model-library">
          <div className="section-heading">
            <p className="eyebrow">Private on-device AI</p>
            <h3>Android model library</h3>
            <p>
              Find commercially permissible small OSS models in the curated catalog, Hugging Face
              Hub, and verified GitHub release assets, then install the best fit into
              browser-private storage.
            </p>
            <p>
              Device activation validates and runs a downloaded GGUF model in this browser or the
              installed app. It is separate from the persisted backend “Use with agent” binding
              above.
            </p>
          </div>

          {!modelLibraryLoaded ? (
            <div className="deferred-model-library">
              <p>
                Device checks and remote model catalogs stay paused until you open this library.
              </p>
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
                              {runtime.errorCode === "MODEL_NOT_INSTALLED"
                                ? "Model not installed on the inference service."
                                : "Backend model unavailable. The Soko inference service cannot currently be reached."}
                            </small>
                          ) : runtime?.status === "available" ? (
                            <small>
                              Model verified in {formatLatency(runtime.latencyMs ?? 0)}.
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
                  {serverBackendModels.length === 0 ? (
                    <p>No server-managed backend model matches this search.</p>
                  ) : null}
                </div>
              </section>
              <section aria-label="Cloud fallback models">
                <div className="section-subheading">
                  <h4>Cloud fallback models</h4>
                  <p>
                    OpenAI is optional and off by default. It can be selected only after a
                    downloaded GGUF model is connected and tested, and is used only when local
                    inference cannot run under your fallback policy.
                  </p>
                </div>
                <div className="ai-model-catalog">
                  {backendModels.map((model) => (
                    <article className="ai-model-card" key={model.id}>
                      <div>
                        <p className="eyebrow">
                          {model.source === "hosted" ? "Hosted" : "Server runtime"} ·{" "}
                          {model.available ? "Available" : "Not configured"}
                        </p>
                        <h4>{model.label}</h4>
                        <p>{model.description}</p>
                        <small>{model.capabilities.join(" · ")}</small>
                      </div>
                      <div className="ai-model-card-actions">
                        <button
                          type="button"
                          disabled={
                            !model.available ||
                            modelRuntimeBusy ||
                            !hasReadyLocalModel ||
                            !inferencePreferences.cloudConsent ||
                            cloudFallbackModelId === model.id
                          }
                          title={
                            model.available
                              ? undefined
                              : "Configure this inference provider on the backend first."
                          }
                          onClick={() => void useBackendModelWithAgent(model)}
                        >
                          {cloudFallbackModelId === model.id
                            ? "Default fallback"
                            : activatingModelId === model.id
                              ? "Activating…"
                              : model.available
                                ? "Set as fallback"
                                : "Unavailable"}
                        </button>
                      </div>
                    </article>
                  ))}
                  {backendModels.length === 0 ? <p>No backend models match this search.</p> : null}
                </div>
              </section>

              <section
                className={`offline-starter-card ${offlineStarterInstalled ? "installed" : ""}`}
                aria-label="Offline starter model"
              >
                <div>
                  <p className="eyebrow">
                    {offlineStarterInstalled ? "Installed on this device" : "One-time setup"}
                  </p>
                  <h4>
                    {offlineStarterInstalled
                      ? `${offlineStarter?.label ?? "Offline model"} is installed`
                      : "Install an offline starter"}
                  </h4>
                  <p>
                    {offlineStarterInstalled
                      ? "The file is in private storage. Choose ‘Activate on this device’ to validate it and run a local readiness check."
                      : offlineStarter === undefined
                        ? "This device does not report enough storage for a default offline model."
                        : `${offlineStarter.label} is the best default for this device (${formatModelBytes(
                            offlineStarter.fileSizeBytes
                          )}). Download it once while connected, then keep it available on the go.`}
                  </p>
                </div>
                {!offlineStarterInstalled && offlineStarter !== undefined ? (
                  <button
                    type="button"
                    disabled={modelTransfers[offlineStarter.id] !== undefined}
                    onClick={() => void predownloadAiModel(offlineStarter)}
                  >
                    {modelTransfers[offlineStarter.id] === undefined
                      ? "Install offline starter"
                      : `Installing ${modelTransfers[offlineStarter.id]?.percent ?? 0}%`}
                  </button>
                ) : null}
              </section>

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

              {deviceCapability === null ? (
                <p className="model-device-status">Checking this device…</p>
              ) : (
                <div className={`model-device-status ${deviceCapability.level}`}>
                  <strong>{deviceCapability.level} device profile</strong>
                  <span>{deviceCapability.reason}</span>
                  <small>
                    {deviceCapability.deviceMemoryGb === null
                      ? "RAM not reported"
                      : `${deviceCapability.deviceMemoryGb} GB RAM reported`}
                    {` · ${deviceCapability.hardwareConcurrency} CPU threads`}
                    {deviceCapability.freeStorageBytes === null
                      ? " · storage not reported"
                      : ` · ${formatModelBytes(deviceCapability.freeStorageBytes)} free`}
                  </small>
                </div>
              )}

              <div className="ai-model-best-fit">
                <div className="section-subheading">
                  <h4>Best fit models</h4>
                  <p>
                    Ranked across the Soko and GitHub catalogs using reported RAM, CPU, storage,
                    model size, and useful agent capabilities.
                  </p>
                </div>
                {deviceCapability === null ? (
                  <p className="model-device-status">Checking compatibility…</p>
                ) : (
                  <div className="ai-model-best-fit-list">
                    {bestFitModels.map(({ model, reasons }) => (
                      <div className="ai-model-best-fit-card" key={model.id}>
                        <strong>
                          {model.label} · {model.source === "github" ? "GitHub" : "Hugging Face"}
                        </strong>
                        <span>{model.description}</span>
                        <small>{reasons.slice(0, 2).join(" · ")}</small>
                      </div>
                    ))}
                    {bestFitModels.length === 0 ? (
                      <p>No compatible catalog models were found for this device.</p>
                    ) : null}
                  </div>
                )}
              </div>

              <div className="ai-model-catalog">
                {visibleAiModels
                  .filter(
                    (model) => isDownloadableCatalogModel(model) && model.license === "Apache-2.0"
                  )
                  .map((model) => {
                    const localModel = localAiModels.find(
                      (candidate) => candidate.modelId === model.id
                    );
                    const transfer = modelTransfers[model.id];
                    const localModelInUse =
                      localModel !== undefined &&
                      agentModelAssignment?.activeModelInstallationId === localModel.id &&
                      agentModelAssignment.readinessStatus === "READY";
                    const localModelActivating = activatingModelId === localModel?.modelId;
                    const compatible =
                      deviceCapability === null ||
                      canRunCatalogModel(
                        deviceCapability,
                        model.minimumMemoryGb,
                        model.fileSizeBytes
                      );
                    return (
                      <article className="ai-model-card" key={model.id}>
                        <div>
                          <p className="eyebrow">
                            {localModel === undefined ? "Available to install · " : "Installed · "}
                            {model.recommended ? "Recommended · " : ""}
                            {model.source === "github" ? "GitHub release · " : "Hugging Face · "}
                            {model.license} · {model.format}
                          </p>
                          <h4>{model.label}</h4>
                          <p>{model.description}</p>
                          <small>
                            {formatModelBytes(model.fileSizeBytes)} · {model.minimumMemoryGb} GB
                            minimum RAM · {model.capabilities.join(" · ")}
                          </small>
                        </div>
                        <div className="ai-model-card-actions">
                          {model.modelCardUrl !== null ? (
                            <a href={model.modelCardUrl} target="_blank" rel="noreferrer">
                              {model.source === "github" ? "GitHub release" : "Model card"}
                            </a>
                          ) : null}
                          {localModel === undefined ? (
                            <button
                              type="button"
                              disabled={!compatible || transfer !== undefined}
                              onClick={() => void predownloadAiModel(model)}
                            >
                              {transfer === undefined
                                ? "Predownload & install"
                                : `Installing ${transfer.percent}%`}
                            </button>
                          ) : (
                            <>
                              <button
                                className={`model-use-button ${
                                  localModelInUse
                                    ? "in-use"
                                    : localModelActivating
                                      ? "activating"
                                      : "not-in-use"
                                }`}
                                type="button"
                                aria-pressed={localModelInUse}
                                disabled={modelRuntimeBusy || localModelInUse}
                                onClick={() => void useModelWithAgent(localModel)}
                              >
                                {localModelInUse
                                  ? "Active on this device"
                                  : localModelActivating
                                    ? "Activating…"
                                    : failedActivationModelId === localModel.modelId
                                      ? "Not active · Retry device activation"
                                      : "Not active · Activate on this device"}
                              </button>
                              <button
                                className="secondary"
                                type="button"
                                disabled={modelRuntimeBusy}
                                onClick={() => void deleteDeviceModel(localModel)}
                              >
                                Remove
                              </button>
                            </>
                          )}
                        </div>
                        {!compatible ? (
                          <p className="model-compatibility-warning">
                            This model exceeds the reported memory or storage available on this
                            device.
                          </p>
                        ) : null}
                      </article>
                    );
                  })}
              </div>

              <div className="custom-model-import">
                <div>
                  <h4>Add a custom AI model</h4>
                  <p>
                    High-capability devices can import a local GGUF file. Soko does not upload or
                    verify custom model licenses.
                  </p>
                </div>
                <label className="license-confirmation">
                  <input
                    type="checkbox"
                    checked={customLicenseConfirmed}
                    disabled={deviceCapability?.customModelsAllowed !== true}
                    onChange={(event) => setCustomLicenseConfirmed(event.target.checked)}
                  />
                  I confirm this model's license permits my commercial use.
                </label>
                <input
                  ref={customModelInput}
                  className="model-file-input"
                  type="file"
                  accept=".gguf,application/octet-stream"
                  onChange={(event) => void importCustomModel(event)}
                />
                <button
                  type="button"
                  disabled={
                    deviceCapability?.customModelsAllowed !== true ||
                    !customLicenseConfirmed ||
                    modelTransfers["custom-import"] !== undefined
                  }
                  onClick={() => customModelInput.current?.click()}
                >
                  {modelTransfers["custom-import"] === undefined
                    ? "Choose custom GGUF"
                    : `Importing ${modelTransfers["custom-import"].percent}%`}
                </button>
                {localAiModels
                  .filter((model) => model.provider === "custom")
                  .map((model) => {
                    const modelInUse =
                      agentModelAssignment?.activeModelInstallationId === model.id &&
                      agentModelAssignment.readinessStatus === "READY";
                    const modelActivating = activatingModelId === model.modelId;
                    return (
                      <div className="custom-model-row" key={model.id}>
                        <span>
                          <strong>{model.label}</strong>
                          <small>
                            {formatModelBytes(model.fileSizeBytes)} · stored on this device
                          </small>
                        </span>
                        <button
                          className={`model-use-button ${
                            modelInUse ? "in-use" : modelActivating ? "activating" : "not-in-use"
                          }`}
                          type="button"
                          aria-pressed={modelInUse}
                          disabled={modelRuntimeBusy || modelInUse}
                          onClick={() => void useModelWithAgent(model)}
                        >
                          {modelInUse
                            ? "Active on this device"
                            : modelActivating
                              ? "Activating…"
                              : failedActivationModelId === model.modelId
                                ? "Not active · Retry device activation"
                                : "Not active · Activate on this device"}
                        </button>
                        <button
                          className="secondary"
                          type="button"
                          disabled={modelRuntimeBusy}
                          onClick={() => void deleteDeviceModel(model)}
                        >
                          Remove
                        </button>
                      </div>
                    );
                  })}
              </div>
            </>
          )}
        </div>

        <div className="record-form">
          <div className="section-heading">
            <p className="eyebrow">Soko Global Shop ID</p>
            <h3>Public storefront</h3>
          </div>
          <div className="soko-id-card">
            <span>Permanent shop identity</span>
            <strong>{business.sokoId}</strong>
            <p>Print this on packaging, receipts, QR codes, and storefront material.</p>
            <div className="storefront-share-actions">
              <button
                type="button"
                onClick={() => void copyStorefrontValue(business.sokoId, "Soko ID")}
              >
                Copy ID
              </button>
              <button
                className="secondary"
                type="button"
                onClick={() => void copyStorefrontValue(storefrontUrl, "Storefront URL")}
              >
                Copy URL
              </button>
            </div>
          </div>
          <label>
            Storefront ID
            <input value={business.sokoId} disabled />
          </label>
          <label>
            Storefront URL
            <input value={storefrontUrl} disabled />
          </label>
          <label>
            Language
            <select
              value={draftAgent.language}
              disabled={!isEditing}
              onChange={(event) =>
                updateAgent({ language: event.target.value as SupportedLanguage })
              }
            >
              <option value="en">English</option>
              <option value="sw">Swahili</option>
            </select>
          </label>
          <p className="shell-note">{ownerLabel} owns this public storefront assistant.</p>
        </div>

        <div className="record-form shop-profile-card">
          <div className="section-heading">
            <p className="eyebrow">Account</p>
            <h3>Passkeys and login accounts</h3>
            <p>
              Passkeys use your device unlock and keep biometric data on the device. Email, social
              login, and your private recovery contact remain available if your passkey is lost.
            </p>
            <p className="shell-note">Identity strength: {identityLevel.replace("_", " ")}</p>
          </div>
          <Suspense fallback={<div className="inline-loading-card">Opening account security…</div>}>
            <AccountBackendControls
              accountId={accountId}
              displayName={ownerUser?.displayName ?? ""}
              onDisplayNameChanged={(displayName) =>
                ownerUser === null ? undefined : onOwnerUserChange({ ...ownerUser, displayName })
              }
            />
          </Suspense>
          <div className="record-form">
            <div className="section-heading">
              <p className="eyebrow">Private identity contact</p>
              <h4>Owner phone number</h4>
              <p>
                Required for shop identity, recovery, support escalation, and fraud review. It is
                unverified and hidden from customers by default.
              </p>
            </div>
            <PhoneNumberField
              country={getCountryDialCode(ownerPhoneCountryCode).countryCode}
              countries={phoneCountryOptions}
              value={ownerPhoneNumber}
              label="Owner phone number"
              error={ownerPhoneError}
              onCountryChange={(country) => {
                setOwnerPhoneCountryCode(getCountryDialCodeByCountry(country).code);
                setOwnerPhoneError("");
              }}
              onValueChange={(value) => {
                setOwnerPhoneNumber(value);
                setOwnerPhoneError("");
              }}
            />
            <div className="compact-actions">
              <button
                type="button"
                disabled={ownerPhoneNumber.trim().length === 0 || pendingProfileAction !== null}
                aria-busy={pendingProfileAction === "owner-phone-update"}
                onClick={() => void runProfileAction("owner-phone-update", updateOwnerPhone)}
              >
                {pendingProfileAction === "owner-phone-update" ? "Saving…" : "Save phone number"}
              </button>
              <span className="shell-note">
                Status: {ownerUser?.phoneVerificationStatus ?? "unverified"} · Public display: off
              </span>
            </div>
            {ownerPhoneMergeRequired ? (
              <div className="record-form" role="group" aria-label="Join existing phone account">
                <p className="shell-note">
                  Verify the PIN for this phone number. Soko will move this device account’s chats,
                  shops, and records into the verified account and keep this device signed in.
                </p>
                <label>
                  Existing account PIN
                  <input
                    type="password"
                    inputMode="numeric"
                    autoComplete="current-password"
                    value={ownerPhoneMergePin}
                    onChange={(event) => setOwnerPhoneMergePin(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void runProfileAction("owner-phone-merge", mergeOwnerPhoneAccount)}
                  disabled={ownerPhoneMergePin.trim().length < 4 || pendingProfileAction !== null}
                >
                  {pendingProfileAction === "owner-phone-merge"
                    ? "Verifying…"
                    : "Verify and join accounts"}
                </button>
              </div>
            ) : null}
          </div>
          <div className="record-form">
            <div className="section-heading">
              <p className="eyebrow">Recovery identity</p>
              <h4>Email address</h4>
              <p>Add and verify email without changing this account or any of its data.</p>
              {emailMergeRequired ? (
                <p className="shell-note">
                  Verification will join this device account’s chats, shops, and records to the
                  existing email account.
                </p>
              ) : null}
            </div>
            <label>
              Email address
              <input
                type="email"
                autoComplete="email"
                value={ownerEmail}
                onChange={(event) => setOwnerEmail(event.target.value)}
                placeholder="you@example.com"
              />
            </label>
            {emailChallengeId ? (
              <label>
                Verification code
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={emailVerificationCode}
                  onChange={(event) => setEmailVerificationCode(event.target.value)}
                />
              </label>
            ) : null}
            <button
              type="button"
              onClick={() =>
                void runProfileAction(
                  "owner-email-upgrade",
                  emailChallengeId ? verifyEmailIdentityUpgrade : startEmailIdentityUpgrade
                )
              }
              disabled={
                ownerEmail.trim().length === 0 ||
                pendingProfileAction !== null ||
                (emailChallengeId.length > 0 && emailVerificationCode.trim().length === 0)
              }
            >
              {pendingProfileAction === "owner-email-upgrade"
                ? "Working…"
                : emailChallengeId
                  ? "Verify email"
                  : "Add email"}
            </button>
          </div>
          <div className="connected-social-list" role="group" aria-label="Passkeys">
            {passkeys.map((passkey) => (
              <article className="connected-social-card" key={passkey.id}>
                <div>
                  <span>Passkey</span>
                  <strong>{passkey.label}</strong>
                  <p>{passkey.backedUp ? "Synced or backed up" : "Stored on one device"}</p>
                </div>
                <div className="connected-social-meta">
                  <span>Added: {formatDate(passkey.createdAt)}</span>
                  <span>
                    Last used: {passkey.lastUsedAt === null ? "—" : formatDate(passkey.lastUsedAt)}
                  </span>
                </div>
                <div className="row-actions">
                  <label>
                    Passkey name
                    <input
                      type="text"
                      maxLength={80}
                      value={passkeyLabels[passkey.id] ?? passkey.label}
                      onChange={(event) =>
                        setPasskeyLabels((current) => ({
                          ...current,
                          [passkey.id]: event.target.value
                        }))
                      }
                    />
                  </label>
                  <button
                    className="secondary"
                    type="button"
                    disabled={pendingProfileAction !== null}
                    onClick={() =>
                      void runProfileAction("passkey-rename", () =>
                        renamePasskey(
                          passkey.id,
                          passkey.label,
                          passkeyLabels[passkey.id] ?? passkey.label
                        )
                      )
                    }
                  >
                    Rename
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    disabled={pendingProfileAction !== null}
                    onClick={() =>
                      void runProfileAction("passkey-revoke", () => revokePasskey(passkey.id))
                    }
                  >
                    Revoke
                  </button>
                </div>
              </article>
            ))}
          </div>
          <button
            type="button"
            disabled={!browserSupportsWebAuthn() || pendingProfileAction !== null}
            onClick={() => void runProfileAction("passkey-register", registerPasskey)}
          >
            {browserSupportsWebAuthn()
              ? "Secure this device with a passkey"
              : "Passkeys unavailable"}
          </button>
          <div className="record-form" role="group" aria-label="Multi-factor authentication">
            <div className="section-heading">
              <p className="eyebrow">Multi-factor authentication</p>
              <h4>Authenticator app</h4>
              <p>MFA is optional. Enabling it adds a second step after password sign-in.</p>
            </div>
            {mfaFactors.map((factor) => (
              <div className="connected-social-card" key={factor.id}>
                <span>Enabled {formatDate(factor.createdAt)}</span>
                <button
                  className="secondary"
                  type="button"
                  disabled={pendingProfileAction !== null || mfaCode.length !== 6}
                  onClick={() =>
                    void runProfileAction("mfa-disable", () => disableTotpFactor(factor.id))
                  }
                >
                  Disable with current code
                </button>
              </div>
            ))}
            {pendingTotp !== null ? (
              <>
                <label>
                  Authenticator secret
                  <input readOnly value={pendingTotp.secret} autoComplete="off" />
                </label>
                <a href={pendingTotp.otpauthUri}>Open authenticator app</a>
                <button
                  type="button"
                  disabled={mfaCode.length !== 6 || pendingProfileAction !== null}
                  onClick={() => void runProfileAction("mfa-confirm", confirmTotpSetup)}
                >
                  Confirm authenticator
                </button>
              </>
            ) : mfaFactors.length === 0 ? (
              <button
                type="button"
                disabled={pendingProfileAction !== null}
                onClick={() => void runProfileAction("mfa-setup", beginTotpSetup)}
              >
                Set up authenticator
              </button>
            ) : null}
            <label>
              Authenticator code
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={mfaCode}
                onChange={(event) => setMfaCode(event.target.value.replace(/\D/gu, ""))}
              />
            </label>
            {mfaRecoveryCodes.length > 0 ? (
              <div>
                <strong>Recovery codes (shown once)</strong>
                <pre>{mfaRecoveryCodes.join("\n")}</pre>
              </div>
            ) : null}
            {mfaFactors.length > 0 ? (
              <button
                className="secondary"
                type="button"
                disabled={pendingProfileAction !== null}
                onClick={() =>
                  void runProfileAction("mfa-recovery-codes-regenerate", regenerateMfaRecoveryCodes)
                }
              >
                Regenerate recovery codes
              </button>
            ) : null}
          </div>
          <div className="record-form" role="group" aria-label="Change password">
            <div className="section-heading">
              <p className="eyebrow">Password fallback</p>
              <h4>Change password</h4>
              <p>
                Only applies if this account has a password set. PIN and passkey sign-in are
                unaffected.
              </p>
            </div>
            <label>
              Current password
              <input
                type="password"
                autoComplete="current-password"
                value={changePasswordCurrent}
                onChange={(event) => setChangePasswordCurrent(event.target.value)}
              />
            </label>
            <label>
              New password
              <input
                type="password"
                minLength={10}
                maxLength={256}
                autoComplete="new-password"
                value={changePasswordNew}
                onChange={(event) => setChangePasswordNew(event.target.value)}
              />
            </label>
            <label>
              Confirm new password
              <input
                type="password"
                minLength={10}
                maxLength={256}
                autoComplete="new-password"
                value={changePasswordConfirm}
                onChange={(event) => setChangePasswordConfirm(event.target.value)}
              />
            </label>
            <label>
              MFA code (if enabled)
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={changePasswordMfaCode}
                onChange={(event) =>
                  setChangePasswordMfaCode(event.target.value.replace(/\D/gu, ""))
                }
              />
            </label>
            <button
              type="button"
              disabled={
                pendingProfileAction !== null ||
                changePasswordCurrent.length === 0 ||
                changePasswordNew.length < 10 ||
                changePasswordNew !== changePasswordConfirm
              }
              aria-busy={pendingProfileAction === "password-change"}
              onClick={() => void runProfileAction("password-change", changeAccountPassword)}
            >
              {pendingProfileAction === "password-change" ? "Saving…" : "Change password"}
            </button>
          </div>
          <div className="connected-social-list">
            {oauthProviders
              .filter((provider) =>
                ["google", "facebook", "tiktok", "x", "linkedin"].includes(provider.id)
              )
              .map((provider) => {
                const connected = connectedSocialAccounts.find(
                  (account) => account.provider === provider.id
                );
                return (
                  <article className="connected-social-card" key={provider.id}>
                    <div>
                      <span>{provider.displayName}</span>
                      <strong>{connected === undefined ? "Disconnected" : "Connected"}</strong>
                      <p>
                        {connected?.displayName ??
                          connected?.email ??
                          (provider.configured
                            ? "Ready to connect"
                            : "Login provider not configured")}
                      </p>
                    </div>
                    <div className="connected-social-meta">
                      <span>
                        Connected:{" "}
                        {connected === undefined ? "—" : formatDate(connected.connectedAt)}
                      </span>
                      <span>
                        Last used:{" "}
                        {connected?.lastUsedAt === null || connected === undefined
                          ? "—"
                          : formatDate(connected.lastUsedAt)}
                      </span>
                    </div>
                    <div className="row-actions">
                      <button
                        className="secondary"
                        type="button"
                        onClick={() =>
                          void runProfileAction("account-reconnect", () =>
                            reconnectLoginAccount(provider.id)
                          )
                        }
                        disabled={!provider.configured || pendingProfileAction !== null}
                        title={
                          provider.configured
                            ? undefined
                            : "This login provider is not configured yet."
                        }
                      >
                        Reconnect
                      </button>
                      <button
                        className="secondary"
                        type="button"
                        disabled={connected === undefined || pendingProfileAction !== null}
                        onClick={() =>
                          connected === undefined
                            ? undefined
                            : void runProfileAction("account-disconnect", () =>
                                disconnectSocialAccount(connected.id)
                              )
                        }
                      >
                        Disconnect
                      </button>
                    </div>
                  </article>
                );
              })}
          </div>
          <div className="section-heading">
            <p className="eyebrow">Connected email channel</p>
            <h4>Mailboxes for customer conversations</h4>
            <p>
              These are authorized business mailboxes used to send and receive customer email. They
              are separate from the email used to sign in to or recover your Soko account.
            </p>
          </div>
          <div className="connected-social-list" role="list" aria-label="Connected mailboxes">
            <article className="connected-social-card" role="listitem">
              <div>
                <span>Soko account email</span>
                <strong>{registeredEmail ?? "No account email registered"}</strong>
                <p>Identity and recovery only. This address is not an email channel.</p>
              </div>
            </article>
            {connectedMailboxes.map((mailbox) => (
              <article className="connected-social-card" role="listitem" key={mailbox.id}>
                <div>
                  <span>{mailbox.provider === "gmail" ? "Gmail" : "Microsoft Outlook"}</span>
                  <strong>{mailbox.address}</strong>
                  <p>
                    {mailbox.status.replaceAll("_", " ")}
                    {mailbox.isDefault ? " · default sender" : ""}
                  </p>
                </div>
                <div className="connected-social-meta">
                  <span>Connected: {formatDate(mailbox.connectedAt)}</span>
                  <span>
                    Last sync:{" "}
                    {mailbox.lastSyncAt === null ? "Never" : formatDate(mailbox.lastSyncAt)}
                  </span>
                </div>
                <label>
                  <input
                    type="checkbox"
                    checked={mailbox.ingestUnknownSenders}
                    disabled={pendingProfileAction !== null || mailbox.status !== "connected"}
                    onChange={(event) =>
                      void runProfileAction(`mailbox-unknown-${mailbox.id}`, () =>
                        updateMailbox(mailbox.id, {
                          ingestUnknownSenders: event.target.checked
                        })
                      )
                    }
                  />
                  Import mail from unknown senders
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={mailbox.automaticReplyEnabled}
                    disabled={pendingProfileAction !== null || mailbox.status !== "connected"}
                    onChange={(event) =>
                      void runProfileAction(`mailbox-auto-reply-${mailbox.id}`, () =>
                        updateMailbox(mailbox.id, {
                          automaticReplyEnabled: event.target.checked,
                          automaticReplyText:
                            mailbox.automaticReplyText ??
                            "Thanks for your message. We received it and will follow up shortly."
                        })
                      )
                    }
                  />
                  Send one automatic acknowledgement per thread every 24 hours
                </label>
                <label>
                  <span>Automatic acknowledgement</span>
                  <textarea
                    rows={2}
                    maxLength={1000}
                    defaultValue={mailbox.automaticReplyText ?? ""}
                    disabled={pendingProfileAction !== null || mailbox.status !== "connected"}
                    onBlur={(event) => {
                      const next = event.target.value.trim();
                      if (next === (mailbox.automaticReplyText ?? "")) return;
                      void runProfileAction(`mailbox-auto-reply-text-${mailbox.id}`, () =>
                        updateMailbox(mailbox.id, {
                          automaticReplyText: next === "" ? null : next,
                          ...(next === "" ? { automaticReplyEnabled: false } : {})
                        })
                      );
                    }}
                    placeholder="Acknowledgement text"
                  />
                </label>
                <div className="row-actions">
                  <button
                    className="secondary"
                    type="button"
                    disabled={pendingProfileAction !== null || mailbox.status !== "connected"}
                    onClick={() =>
                      void runProfileAction(`mailbox-sync-${mailbox.id}`, () =>
                        syncMailbox(mailbox.id)
                      )
                    }
                  >
                    Sync inbox
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    disabled={pendingProfileAction !== null || mailbox.status !== "connected"}
                    onClick={() =>
                      void runProfileAction(`mailbox-history-${mailbox.id}`, () =>
                        syncMailbox(mailbox.id, 30)
                      )
                    }
                  >
                    Import 30 days
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    disabled={
                      pendingProfileAction !== null ||
                      mailbox.isDefault ||
                      mailbox.status !== "connected"
                    }
                    onClick={() =>
                      void runProfileAction(`mailbox-default-${mailbox.id}`, () =>
                        updateMailbox(mailbox.id, { isDefault: true })
                      )
                    }
                  >
                    Make default
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    disabled={pendingProfileAction !== null || mailbox.status === "disconnected"}
                    onClick={() =>
                      void runProfileAction(`mailbox-disconnect-${mailbox.id}`, () =>
                        disconnectMailbox(mailbox.id)
                      )
                    }
                  >
                    Disconnect
                  </button>
                </div>
              </article>
            ))}
            {connectedMailboxProviders
              .filter((provider) => provider.configured)
              .map((provider) => {
                const alreadyConnected = connectedMailboxes.some(
                  (mailbox) =>
                    mailbox.provider === provider.provider && mailbox.status === "connected"
                );
                return (
                  <article
                    className="connected-social-card"
                    role="listitem"
                    key={provider.provider}
                  >
                    <div>
                      <span>{provider.displayName}</span>
                      <strong>{alreadyConnected ? "Add another mailbox" : "Not connected"}</strong>
                      <p>Authorize with OAuth. Soko never stores your mailbox password.</p>
                    </div>
                    <button
                      type="button"
                      disabled={pendingProfileAction !== null}
                      onClick={() =>
                        void runProfileAction(`mailbox-connect-${provider.provider}`, () =>
                          connectMailbox(provider.provider)
                        )
                      }
                    >
                      Connect {provider.displayName}
                    </button>
                  </article>
                );
              })}
          </div>
          <div className="section-heading">
            <p className="eyebrow">{business.name}</p>
            <h4>Login methods visible to this shop</h4>
            <p>
              The same login accounts above, shown through this shop's access rather than your
              personal session - useful when checking access from a shop-scoped view.
            </p>
          </div>
          <div
            className="connected-social-list"
            role="list"
            aria-label="Shop-scoped login accounts"
          >
            {businessSocialAccounts.length === 0 ? (
              <p className="form-hint" role="listitem">
                No connected login accounts for this shop yet.
              </p>
            ) : (
              businessSocialAccounts.map((account) => (
                <article className="connected-social-card" role="listitem" key={account.id}>
                  <div>
                    <span>{account.providerName}</span>
                    <strong>{account.displayName ?? account.email ?? "Connected"}</strong>
                  </div>
                  <div className="connected-social-meta">
                    <span>Connected: {formatDate(account.connectedAt)}</span>
                    <span>
                      Last used:{" "}
                      {account.lastUsedAt === null ? "—" : formatDate(account.lastUsedAt)}
                    </span>
                  </div>
                  <button
                    className="secondary"
                    type="button"
                    disabled={pendingProfileAction !== null}
                    onClick={() =>
                      void runProfileAction("business-account-disconnect", () =>
                        disconnectBusinessSocialAccount(account.id)
                      )
                    }
                  >
                    Disconnect
                  </button>
                </article>
              ))
            )}
          </div>
          {profileMessage.length > 0 ? (
            <p className="shell-note">
              <AuthenticationActionMessage message={profileMessage} />
            </p>
          ) : null}
        </div>

        <div className="record-form shop-profile-card">
          <div className="section-heading">
            <p className="eyebrow">Devices and sessions</p>
            <h3>Notifications and account sessions</h3>
          </div>
          <p className="shell-note">
            Control push delivery on this device, or revoke every signed-in session if a device is
            lost.
          </p>
          <div className="connected-social-list" role="list" aria-label="Signed-in devices">
            {deviceSessions.map((deviceSession) => (
              <article className="connected-social-card" role="listitem" key={deviceSession.id}>
                <div>
                  <span>{deviceSession.current ? "This device" : "Signed-in device"}</span>
                  <strong>{deviceSession.deviceName}</strong>
                  <p>
                    {deviceSession.platform} · {deviceSession.browserOrApp} · {deviceSession.status}
                  </p>
                </div>
                <div className="connected-social-meta">
                  <span>Last active: {formatDate(deviceSession.lastUsedAt)}</span>
                  <span>Expires: {formatDate(deviceSession.expiresAt)}</span>
                </div>
                <button
                  className="secondary"
                  type="button"
                  disabled={deviceSession.status !== "active" || pendingProfileAction !== null}
                  onClick={() =>
                    void runProfileAction("device-session-revoke", () =>
                      revokeDeviceSession(deviceSession.id)
                    )
                  }
                >
                  {deviceSession.current ? "Log out this device" : "Log out device"}
                </button>
              </article>
            ))}
          </div>
          <div className="row-actions">
            <button
              type="button"
              disabled={pendingProfileAction !== null}
              onClick={() =>
                void runProfileAction("push-enable", async () => onEnableNotifications())
              }
            >
              Enable notifications
            </button>
            <button
              className="secondary"
              type="button"
              disabled={pendingProfileAction !== null}
              onClick={() =>
                void runProfileAction("push-disable", async () => onDisableNotifications())
              }
            >
              Disable on this device
            </button>
            <button
              className="destructive-button"
              type="button"
              disabled={pendingProfileAction !== null || isLoggingOut}
              onClick={onLogoutAll}
              aria-busy={isLoggingOut}
            >
              {isLoggingOut ? "Signing out all devices…" : "Sign out all devices"}
            </button>
          </div>
        </div>

        <div className="record-form shop-profile-card">
          <div className="section-heading">
            <p className="eyebrow">Developer access</p>
            <h3>MCP access tokens</h3>
            <p>
              Create short-lived tokens for trusted AI clients. Action access still preserves Soko
              confirmation gates.
            </p>
          </div>
          <label>
            Token name
            <input value={mcpTokenName} onChange={(event) => setMcpTokenName(event.target.value)} />
          </label>
          <div className="checkbox-list">
            <label>
              <input
                type="checkbox"
                checked={mcpReadEnabled}
                onChange={(event) => setMcpReadEnabled(event.target.checked)}
              />
              Read shops and sync changes
            </label>
            <label>
              <input
                type="checkbox"
                checked={mcpActEnabled}
                onChange={(event) => setMcpActEnabled(event.target.checked)}
              />
              Propose actions through the runtime
            </label>
          </div>
          {mcpActEnabled ? (
            <label>
              Owner PIN
              <input
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                value={mcpPin}
                onChange={(event) => setMcpPin(event.target.value)}
                placeholder="Required for action access"
              />
            </label>
          ) : null}
          <button
            type="button"
            disabled={
              pendingProfileAction !== null ||
              mcpTokenName.trim().length < 3 ||
              (mcpActEnabled && !/^\d{4}$/.test(mcpPin))
            }
            onClick={() => void runProfileAction("mcp-create", createMcpToken)}
          >
            Create 24-hour token
          </button>
          {newMcpAccessToken.length > 0 ? (
            <div className="soko-id-card" role="status">
              <span>Copy this secret now—it will not be shown again.</span>
              <code>{newMcpAccessToken}</code>
              <button
                type="button"
                onClick={() => void copyStorefrontValue(newMcpAccessToken, "MCP token")}
              >
                Copy token
              </button>
            </div>
          ) : null}
          <div className="connected-social-list" aria-label="MCP access tokens">
            {mcpTokens.length === 0 ? <p className="shell-note">No MCP tokens yet.</p> : null}
            {mcpTokens.map((token) => (
              <article className="connected-social-card" key={token.id}>
                <div>
                  <span>{token.scopes.join(" · ")}</span>
                  <strong>{token.name}</strong>
                  <p>
                    {token.revokedAt !== null
                      ? "Revoked"
                      : Date.parse(token.expiresAt) <= Date.now()
                        ? "Expired"
                        : `Expires ${formatDate(token.expiresAt)}`}
                  </p>
                </div>
                <div className="connected-social-meta">
                  <span>Created: {formatDate(token.createdAt)}</span>
                  <span>
                    Last used: {token.lastUsedAt === null ? "—" : formatDate(token.lastUsedAt)}
                  </span>
                </div>
                <button
                  className="secondary"
                  type="button"
                  disabled={token.revokedAt !== null || pendingProfileAction !== null}
                  onClick={() =>
                    void runProfileAction("mcp-revoke", () => revokeMcpToken(token.id))
                  }
                >
                  Revoke
                </button>
              </article>
            ))}
          </div>
        </div>

        <div className="record-form danger-zone-card">
          <div className="section-heading">
            <p className="eyebrow">Danger zone</p>
            <h3>Delete account</h3>
          </div>
          <p className="security-warning">
            Choose whether to delete only this shop or your entire Soko.market account.
          </p>
          {deletionStep === "idle" ? (
            <button
              className="destructive-button"
              type="button"
              onClick={() => setDeletionStep("choose")}
            >
              Delete account
            </button>
          ) : null}
          {deletionStep === "choose" ? (
            <div className="shop-deletion-card">
              <div className="storefront-card-header">
                <div>
                  <span>Choose deletion scope</span>
                  <strong>Shop or entire account</strong>
                </div>
                <button className="secondary" type="button" onClick={cancelDeletion}>
                  Cancel
                </button>
              </div>
              <div className="connected-social-list" aria-label="Deletion options">
                <article className="connected-social-card">
                  <div>
                    <span>Current shop</span>
                    <strong>Delete this shop only</strong>
                    <p>
                      Hides {business.name} immediately and schedules its business data for purge.
                      Your Soko login and other shops remain active.
                    </p>
                  </div>
                  <button type="button" onClick={() => setDeletionStep("shop-confirm")}>
                    Delete this shop
                  </button>
                </article>
                <article className="connected-social-card">
                  <div>
                    <span>Entire account</span>
                    <strong>Delete your Soko.market account</strong>
                    <p>
                      Disables your login, revokes every session, and schedules all associated
                      personal and shop data for deletion.
                    </p>
                  </div>
                  <button
                    className="destructive-button"
                    type="button"
                    onClick={() => setDeletionStep("account-confirm")}
                  >
                    Delete entire account
                  </button>
                </article>
              </div>
              <a href={routes.accountDeletion}>Read the account-deletion process</a>
            </div>
          ) : null}
          {deletionStep === "shop-confirm" ? (
            <div className="shop-deletion-card">
              <div className="storefront-card-header">
                <div>
                  <span>Delete this shop</span>
                  <strong>Step 1 of 2</strong>
                </div>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => setDeletionStep("choose")}
                >
                  Back
                </button>
              </div>
              <p>This will remove:</p>
              <ul>
                <li>Products and catalogue</li>
                <li>Customers, suppliers and sales agents</li>
                <li>Sales, invoices and payments</li>
                <li>Messages, notifications and context scripts</li>
                <li>Uploaded business files and connected services</li>
              </ul>
              {deletionPreview === null ? null : (
                <div className="supplier-card-metrics">
                  <span>Products: {deletionPreview.counts.products}</span>
                  <span>Customers: {deletionPreview.counts.customers}</span>
                  <span>Suppliers: {deletionPreview.counts.suppliers}</span>
                  <span>Sales records: {deletionPreview.counts.salesRecords}</span>
                  <span>Files: {deletionPreview.counts.uploadedFiles}</span>
                </div>
              )}
              <label>
                Type the shop ID to continue
                <input
                  value={deletionShopId}
                  onChange={(event) => setDeletionShopId(event.target.value)}
                  placeholder={business.sokoId}
                />
              </label>
              <div className="row-actions">
                <button className="secondary" type="button" onClick={cancelDeletion}>
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={deletionShopId !== business.sokoId || pendingProfileAction !== null}
                  onClick={() => void runProfileAction("shop-deletion-start", startShopDeletion)}
                  aria-busy={pendingProfileAction === "shop-deletion-start"}
                >
                  Continue
                </button>
              </div>
            </div>
          ) : null}
          {deletionStep === "shop-verify" ? (
            <div className="shop-deletion-card">
              <div className="storefront-card-header">
                <div>
                  <span>Verify deletion</span>
                  <strong>Step 2 of 2</strong>
                </div>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => setDeletionStep("shop-confirm")}
                >
                  Back
                </button>
              </div>
              <p>
                Confirm this request with your owner PIN. OTP is reserved for lost-account recovery.
              </p>
              <label>
                Login PIN
                <input
                  autoFocus
                  value={deletionPin}
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  onChange={(event) => setDeletionPin(sanitizePin(event.target.value))}
                />
              </label>
              <label className="checkbox-row">
                <input
                  checked={deletionAcknowledged}
                  type="checkbox"
                  onChange={(event) => setDeletionAcknowledged(event.target.checked)}
                />
                I understand the shop will be hidden now and permanently purged after 30 days.
              </label>
              <div className="row-actions">
                <button className="secondary" type="button" onClick={cancelDeletion}>
                  Cancel
                </button>
                <button
                  className="destructive-button"
                  type="button"
                  disabled={
                    !isValidPin(deletionPin) ||
                    !deletionAcknowledged ||
                    pendingProfileAction !== null
                  }
                  onClick={() =>
                    void runProfileAction("shop-deletion-finalize", finalizeShopDeletion)
                  }
                  aria-busy={pendingProfileAction === "shop-deletion-finalize"}
                >
                  Quarantine shop
                </button>
              </div>
            </div>
          ) : null}
          {deletionStep === "shop-status" ? (
            <div className="shop-deletion-card" role="status">
              <strong>{deletionRequest?.status ?? "Processing"}</strong>
              <p>
                {deletionRequest?.status === "QUARANTINED"
                  ? `This shop is hidden. Restore it before ${new Date(
                      deletionRequest.anonymizeAfter
                    ).toLocaleDateString()}.`
                  : deletionRequest?.status === "RESTORED"
                    ? "This shop has been restored."
                    : "Your shop deletion is being processed. You can close this screen."}
              </p>
              {deletionRequest?.status === "QUARANTINED" ? (
                <button
                  type="button"
                  onClick={() => void runProfileAction("shop-restore", restoreShop)}
                  disabled={pendingProfileAction !== null}
                  aria-busy={pendingProfileAction === "shop-restore"}
                >
                  {pendingProfileAction === "shop-restore" ? "Restoring…" : "Restore shop"}
                </button>
              ) : null}
            </div>
          ) : null}
          {deletionStep === "account-confirm" ? (
            <div className="shop-deletion-card">
              <div className="storefront-card-header">
                <div>
                  <span>Delete entire account</span>
                  <strong>Step 1 of 2</strong>
                </div>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => setDeletionStep("choose")}
                >
                  Back
                </button>
              </div>
              <p>
                Access is disabled immediately. Recoverable data is held for up to 30 days and then
                deleted or irreversibly anonymized, except records retained for legal, security,
                fraud-prevention, or regulatory reasons.
              </p>
              <label>
                Type DELETE to confirm
                <input
                  value={accountDeletionConfirmation}
                  onChange={(event) => setAccountDeletionConfirmation(event.target.value)}
                />
              </label>
              <label>
                Deletion reason
                <input
                  value={accountDeletionReason}
                  onChange={(event) => setAccountDeletionReason(event.target.value)}
                />
              </label>
              <div className="row-actions">
                <button className="secondary" type="button" onClick={cancelDeletion}>
                  Cancel
                </button>
                <button
                  className="destructive-button"
                  type="button"
                  disabled={accountDeletionConfirmation !== "DELETE"}
                  onClick={() => setDeletionStep("account-verify")}
                >
                  Continue to verification
                </button>
              </div>
            </div>
          ) : null}
          {deletionStep === "account-verify" ? (
            <div
              className="account-deletion-verification"
              role="group"
              aria-label="Verify account deletion"
            >
              <div className="storefront-card-header">
                <div>
                  <span>Delete entire account</span>
                  <strong>Step 2 of 2</strong>
                </div>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => setDeletionStep("account-confirm")}
                  disabled={pendingProfileAction !== null}
                >
                  Back
                </button>
              </div>
              <p>
                Enter your owner PIN. If accepted, every active session is revoked. You can restore
                the account through the authenticated recovery screen for up to 30 days.
              </p>
              <label>
                Owner PIN
                <input
                  autoFocus
                  type="password"
                  inputMode="numeric"
                  autoComplete="current-password"
                  maxLength={4}
                  value={accountDeletionPin}
                  onChange={(event) => setAccountDeletionPin(sanitizePin(event.target.value))}
                />
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={accountDeletionAcknowledged}
                  onChange={(event) => setAccountDeletionAcknowledged(event.target.checked)}
                />
                I understand that all account access is disabled immediately and permanent purge is
                scheduled after the recovery window.
              </label>
              <div className="row-actions">
                <button
                  className="secondary"
                  type="button"
                  onClick={cancelDeletion}
                  disabled={pendingProfileAction !== null}
                >
                  Cancel
                </button>
                <button
                  className="destructive-button"
                  type="button"
                  data-testid="delete-account-confirm"
                  disabled={
                    !isValidPin(accountDeletionPin) ||
                    !accountDeletionAcknowledged ||
                    pendingProfileAction !== null
                  }
                  aria-busy={pendingProfileAction === "account-deletion"}
                  onClick={() => void runProfileAction("account-deletion", finalizeAccountDeletion)}
                >
                  {pendingProfileAction === "account-deletion"
                    ? "Deleting account…"
                    : "Delete account and associated data"}
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="record-form agent-context-window advanced-context-window">
          <div className="section-heading">
            <p className="eyebrow">Advanced features</p>
            <h3>Protected context files</h3>
          </div>
          <p className="security-warning">
            Changes made here affect the response of the agent. Edit, write, or delete context files
            only with absolute necessity and skill. Context files are always Markdown so the agent
            can parse and follow them.
          </p>
          {!contextUnlocked ? (
            <div className="context-unlock-panel">
              <label>
                Owner PIN
                <input
                  value={contextPassword}
                  disabled={!isEditing}
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  autoComplete="current-password"
                  onChange={(event) => setContextPassword(event.target.value)}
                  placeholder="4-digit PIN"
                />
              </label>
              <button
                type="button"
                onClick={() => void unlockContextScripts()}
                disabled={!isEditing}
              >
                Unlock context files
              </button>
              {contextUnlockError.length > 0 ? (
                <p>
                  <AuthenticationActionMessage message={contextUnlockError} />
                </p>
              ) : null}
            </div>
          ) : (
            <div className="context-script-editor">
              <article className="product-vocabulary-card" aria-label="Product Vocabulary">
                <div className="storefront-card-header">
                  <div>
                    <span>Markdown context files</span>
                    <strong>Product Vocabulary</strong>
                  </div>
                  <button
                    className="secondary"
                    type="button"
                    disabled={!isEditing}
                    onClick={testProductVocabularyScript}
                  >
                    Test script
                  </button>
                </div>
                <div className="supplier-card-metrics">
                  <span>
                    Status: {defaultProductVocabularyContextScript.enabled ? "Active" : "Inactive"}
                  </span>
                  <span>Priority: Required</span>
                  <span>
                    Supported intents:{" "}
                    {
                      Array.from(
                        new Set(
                          defaultProductVocabularyContextScript.entries.map((entry) => entry.intent)
                        )
                      ).length
                    }
                  </span>
                  <span>
                    Configured phrases: {defaultProductVocabularyContextScript.entries.length}
                  </span>
                  <span>
                    Last updated: {formatDate(defaultProductVocabularyContextScript.lastUpdated)}
                  </span>
                </div>
                <div className="context-vocabulary-intents" aria-label="Supported product intents">
                  {Array.from(
                    new Set(
                      defaultProductVocabularyContextScript.entries.map((entry) => entry.intent)
                    )
                  ).map((intent) => (
                    <span key={intent}>{intent}</span>
                  ))}
                </div>
                <div className="row-actions">
                  <button type="button" disabled={!isEditing} onClick={addContextScript}>
                    Add phrase
                  </button>
                  <button
                    type="button"
                    disabled={!isEditing || draftAgent.contextScripts.length === 0}
                    onClick={editFirstContextPhrase}
                  >
                    Edit phrase
                  </button>
                  <button
                    type="button"
                    disabled={!isEditing || draftAgent.contextScripts.length === 0}
                    onClick={() => removeContextScript(draftAgent.contextScripts.length - 1)}
                  >
                    Remove phrase
                  </button>
                  <button type="button" disabled={!isEditing} onClick={addContextLanguage}>
                    Add language
                  </button>
                  <button
                    type="button"
                    disabled={!isEditing}
                    onClick={() => updateAgent({ contextScripts: defaultAgentContextScripts })}
                  >
                    Restore defaults
                  </button>
                  <label className="secondary file-action">
                    Import .md files
                    <input
                      type="file"
                      multiple
                      accept=".md,.markdown,text/markdown"
                      disabled={!isEditing}
                      onChange={(event) => void importContextFiles(event)}
                    />
                  </label>
                  <label>
                    Phrase to test
                    <input
                      value={contextTestPhrase}
                      disabled={!isEditing}
                      onChange={(event) => setContextTestPhrase(event.target.value)}
                    />
                  </label>
                  <button type="button" disabled={!isEditing} onClick={testContextPhrase}>
                    Test phrase
                  </button>
                  <button
                    type="button"
                    disabled={!isEditing || isSaving}
                    onClick={() => void saveAgent()}
                    aria-busy={isSaving}
                  >
                    {isSaving ? "Saving…" : "Save changes"}
                  </button>
                </div>
              </article>
              {draftAgent.contextScripts.map((script, index) => (
                <label key={`${index}-${script.slice(0, 12)}`}>
                  context-{index + 1}.md
                  <textarea
                    id={`agent-context-script-${index}`}
                    value={script}
                    disabled={!isEditing}
                    onChange={(event) => updateContextScript(index, event.target.value)}
                    rows={7}
                  />
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => removeContextScript(index)}
                    disabled={!isEditing}
                  >
                    Delete file
                  </button>
                </label>
              ))}
              <button type="button" onClick={addContextScript} disabled={!isEditing}>
                Write new .md file
              </button>
            </div>
          )}
          <div className="context-script-examples">
            <span>Markdown shape</span>
            <code># Product catalogue commands</code>
            <code>- script: product_catalogue_commands</code>
            <code>- priority: required</code>
            <code>- allow: read, add, edit, remove</code>
            <code>- sw: ongeza bidhaa =&gt; add product</code>
          </div>
        </div>
      </section>
    </main>
  );
}

export interface ModelActivationDiagnostic {
  activationRequestId: string;
  userId: string;
  shopId: string;
  agentId: string;
  modelId: string;
  modelSource: string;
  runtimeType: string;
  runtimeSessionId: string | null;
  online: boolean;
  phaseDurations: Partial<Record<ModelActivationState, number>>;
  failureCode: string | null;
}

export function recordModelActivationDiagnostic(diagnostic: ModelActivationDiagnostic): void {
  console.info("model_activation", diagnostic);
}

export function passkeyDeviceLabel(): string {
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ||
    navigator.platform ||
    "This device";
  return `${platform} passkey`;
}

export async function copyTextToClipboard(value: string): Promise<void> {
  if (navigator.clipboard !== undefined) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = value;
  textArea.setAttribute("readonly", "true");
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  document.body.appendChild(textArea);
  textArea.select();
  document.execCommand("copy");
  document.body.removeChild(textArea);
}

export function splitMultilineInput(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function isDownloadableCatalogModel(model: AiModelSummary): boolean {
  return model.source === "huggingface" || model.source === "github";
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

export function unavailableBrowserInferenceCapability(): BrowserInferenceCapability {
  return {
    supported: false,
    backend: "none",
    deviceTier: "low",
    maxRecommendedContextTokens: 1_024,
    reasons: ["Browser inference is not enabled for this shop."],
    browser: { name: "Unknown", version: null, mobile: false },
    crossOriginIsolated: false,
    logicalProcessors: navigator.hardwareConcurrency || 1,
    indexedDbAvailable: false,
    persistentStorage: false,
    installedPwa: false,
    workerAvailable: false
  };
}

export function installedModelRequest(model: LocalAiModel): Record<string, unknown> {
  return {
    id: model.id,
    deviceId: model.deviceId,
    modelId: model.modelId,
    displayName: model.displayName,
    provider: model.provider,
    repositoryId: model.repositoryId,
    filename: model.fileName,
    format: model.format,
    quantization: model.quantization,
    architecture: model.architecture,
    parameterCount: model.parameterCount,
    contextLength: model.contextLength,
    fileSizeBytes: model.fileSizeBytes,
    checksum: model.checksum,
    packageManifestVersion: model.packageManifestVersion ?? null,
    packageSignature: model.packageSignature ?? null,
    packageSigningKeyId: model.packageSigningKeyId ?? null,
    license: model.license,
    commercialUseAllowed: model.commercialUseAllowed,
    storageKey: model.storageKey,
    runtimeBackend: model.runtimeBackend,
    installationStatus: model.installationStatus,
    compatibilityStatus: model.compatibilityStatus,
    installedAt: model.installedAt,
    lastVerifiedAt: model.lastVerifiedAt,
    validationError: model.validationError
  };
}

export function sanitizePin(value: string): string {
  return value.replace(/\D/g, "").slice(0, 4);
}

export function isValidPin(value: string): boolean {
  return /^\d{4}$/.test(value);
}
