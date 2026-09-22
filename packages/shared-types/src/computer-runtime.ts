export type ComputerControlMode = "AGENT_CONTROLLED" | "HUMAN_CONTROLLED" | "SUSPENDED";

export type ComputerActionKind =
  | "session.create"
  | "session.resume"
  | "navigate"
  | "observe"
  | "click"
  | "type"
  | "scroll"
  | "upload"
  | "control.take"
  | "control.release"
  | "checkpoint"
  | "suspend"
  | "close";

export type ComputerActionRisk = "READ" | "MUTATE" | "CONSEQUENTIAL";

export type ExternalSurfaceType = "web" | "pwa" | "desktop" | "mobile-web";

/** Serializable identity for an authorized UI operated by ComputerRuntime. It is deliberately
 * not a native agent definition and must never be added to the native agent registry implicitly. */
export interface ExternalSurfaceDescriptor {
  id: string;
  type: ExternalSurfaceType;
  provider?: string;
}

export interface SurfaceLaunchContext {
  accountId: string;
  businessId: string | null;
  conversationId: string | null;
  profileId?: string | null;
}

export interface SurfaceSession {
  id: string;
  surface: ExternalSurfaceDescriptor;
  computerSessionId: string;
}

export type SurfaceObservation = ComputerObservation;

/** Provider-neutral adapter contract. Implementations delegate UI operation to ComputerRuntime;
 * an ExternalSurface is a computational surface, never a second agent runtime. */
export interface ExternalSurface {
  id: string;
  type: ExternalSurfaceType;
  provider?: string;
  launch(context: SurfaceLaunchContext): Promise<SurfaceSession>;
  attach(sessionId: string): Promise<SurfaceSession>;
  inspect(sessionId: string): Promise<SurfaceObservation>;
  close(sessionId: string): Promise<void>;
}

export type CapabilityExecutionMode =
  | "internal"
  | "native_agent"
  | "mcp"
  | "api"
  | "installed_integration"
  | "computer_use"
  | "unsupported";

export interface CapabilityAvailability {
  internal?: boolean;
  nativeAgent?: boolean;
  mcp?: boolean;
  api?: boolean;
  installedIntegration?: boolean;
  authorizedSurface?: boolean;
}

export interface CapabilityResolution {
  executionMode: CapabilityExecutionMode;
  reason: string;
  considered: CapabilityExecutionMode[];
}

export interface ComputerExecutionMetadata {
  executionMode: "computer_use";
  orchestratingAgentId: string;
  orchestratingModelId?: string;
  externalSurface: ExternalSurfaceDescriptor;
  capabilityResolution: CapabilityResolution;
}

/** Portable computer-use state. Secure browser material remains in protected profile/session
 * storage and is referenced here only by opaque identifiers. */
export interface ComputerRuntimeCheckpoint extends ComputerExecutionMetadata {
  computerSessionId: string;
  currentUrl?: string;
  observationRef?: string;
  browserStateRef?: string;
  pendingApproval?: string;
}

export type ComputerRuntimeStatus =
  | "RUNNING"
  | "SUSPENDED"
  | "AWAITING_USER"
  | "AWAITING_APPROVAL"
  | "HUMAN_CONTROLLED"
  | "RESUMING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export interface ComputerProfile {
  id: string;
  accountId: string;
  businessId: string | null;
  label: string;
  status: "connected" | "reauthorization_required" | "disconnected" | "error";
  credentialReference: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ComputerProfileRecord extends ComputerProfile {
  encryptedStorageState: string | null;
}

export interface ComputerSession {
  id: string;
  profileId: string | null;
  accountId: string;
  businessId: string | null;
  conversationId: string | null;
  runtimeInstanceId: string | null;
  executionHostId: string;
  liveViewUrl: string | null;
  controlMode: ComputerControlMode;
  status: ComputerRuntimeStatus;
  currentUrl: string | null;
  execution: ComputerExecutionMetadata;
  createdAt: string;
  updatedAt: string;
}

export interface ComputerTarget {
  url?: string;
  selector?: string;
  text?: string;
  coordinates?: { x: number; y: number };
  description?: string;
}

export interface ComputerObservation {
  sessionId: string;
  url: string | null;
  title: string | null;
  text: string;
  screenshotRef: string | null;
  observedAt: string;
  untrustedContent: boolean;
}

export interface ComputerAction {
  id: string;
  sessionId: string;
  kind: ComputerActionKind;
  target: ComputerTarget;
  value?: string;
  semanticIntent?: string;
  risk: ComputerActionRisk;
}

export interface ComputerApproval {
  id: string;
  accountId: string;
  actionId: string;
  actionHash: string;
  proposedAction: ComputerAction;
  status: "pending" | "approved" | "rejected" | "used" | "expired";
  requestedBy: string;
  decidedBy: string | null;
  requestedAt: string;
  decidedAt: string | null;
  usedAt: string | null;
  expiresAt: string;
}

export interface ComputerAuditEvent {
  id: string;
  taskId: string | null;
  accountId: string;
  businessId: string | null;
  conversationId: string | null;
  agentId: string | null;
  modelId: string | null;
  executionMode: "computer_use";
  externalSurface: ExternalSurfaceDescriptor;
  resolutionReason: string;
  runtimeInstanceId: string | null;
  computerSessionId: string;
  executionHostId: string;
  actionType: ComputerActionKind;
  target: Omit<ComputerTarget, "coordinates">;
  domain: string | null;
  risk: ComputerActionRisk;
  approvalRequired: boolean;
  approvalId: string | null;
  startedAt: string;
  completedAt: string | null;
  result: ComputerActionResult["status"] | "started";
  errorCategory: string | null;
}

export interface ComputerActionResult {
  sessionId: string;
  actionId: string;
  status: "completed" | "requires_approval" | "rejected" | "failed" | "outcome_unknown";
  observation?: ComputerObservation;
  approval?: ComputerApproval;
  errorCategory?: string;
}

export interface CreateComputerSessionInput {
  accountId: string;
  businessId: string | null;
  conversationId: string | null;
  profileId?: string | null;
  executionHostId: string;
  taskId?: string | null;
  agentId?: string | null;
  modelId?: string | null;
  externalSurface?: ExternalSurfaceDescriptor;
  capabilityAvailability?: CapabilityAvailability;
  runtimeInstanceId?: string | null;
}

export interface ComputerNavigationPolicy {
  allowedDomains: string[];
  blockedDomains: string[];
  allowHttp: boolean;
  allowPrivateNetworks: boolean;
  allowDownloads: boolean;
  allowUploads: boolean;
}

export interface ComputerRuntime {
  createSession(input: CreateComputerSessionInput): Promise<ComputerSession>;
  resumeSession(sessionId: string): Promise<ComputerSession>;
  navigate(input: ComputerAction): Promise<ComputerObservation>;
  observe(input: { sessionId: string }): Promise<ComputerObservation>;
  click(input: ComputerAction): Promise<ComputerActionResult>;
  type(input: ComputerAction): Promise<ComputerActionResult>;
  scroll(input: ComputerAction): Promise<ComputerActionResult>;
  upload(input: ComputerAction): Promise<ComputerActionResult>;
  takeControl(sessionId: string): Promise<ComputerSession>;
  releaseControl(sessionId: string): Promise<ComputerSession>;
  checkpoint(sessionId: string): Promise<unknown>;
  suspend(sessionId: string): Promise<void>;
  resume(sessionId: string): Promise<void>;
  close(sessionId: string): Promise<void>;
}
