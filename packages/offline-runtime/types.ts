export type Entity = Record<string, unknown> & { id: string; businessId?: string };
export type Collection =
  "products" | "customers" | "invoices" | "orders" | "productFields" | "receiptOcrJobs";
export type Mutation =
  | "catalogue.create"
  | "catalogue.update"
  | "inventory.adjust"
  | "customers.create"
  | "receipts.ocr.create"
  | "orders.createInvoice"
  | "orders.updateInvoice"
  | "orders.confirmInvoice";
export type SyncStatus = "PENDING" | "PUSHED" | "ACKED" | "REJECTED" | "CONFLICT";
export interface Scope {
  accountId: string;
  storeId: string;
  deviceId: string;
}
export interface Operation extends Scope {
  id: string;
  localSeq: number;
  opType: Mutation;
  collection: Collection;
  entityLocalId: string;
  entityCloudId: string | null;
  base: Entity | null;
  payload: Record<string, unknown>;
  createdAtLocal: string;
  syncStatus: SyncStatus;
  attempts: number;
  nextAttemptAt: number;
  serverOpId: string | null;
  conflictInfo: string | null;
}
export interface MirrorRow {
  local_id: string;
  cloud_id: string | null;
  store_id: string;
  updated_at_local: string;
  synced_at: string | null;
  dirty: boolean;
  collection: Collection;
  payload: Entity;
}
export interface Artifact {
  url: string;
  sha256: string;
  bytes: number;
}
/** What the on-device OCR engine produces for one captured receipt image. */
export interface ReceiptOcrExtraction {
  engine: OcrEngine;
  engineVersion: string;
  modelVersion: string;
  profile: OcrProfile;
  fallbackUsed: boolean;
  blocks: OcrBlockSummary[];
  fullText: string;
  averageConfidence: number;
  warnings: string[];
}
export interface RuntimeBinding {
  agentId: string;
  agentVersion: string;
  harnessVersion: string;
  modelId: string;
  modelVersion: string;
  artifacts: Artifact[];
}
export interface RuntimePin extends RuntimeBinding, Scope {
  pinnedAt: string;
  explicitSwap: boolean;
  active: boolean;
}
export interface PendingConflict {
  id: string;
  operationId: string;
  collection: Collection;
  entityLocalId: string;
  message: string;
  local: Entity | null;
  server: Entity | null;
}
export interface LocalState extends Scope {
  schemaVersion: 1;
  installed: boolean;
  offlineModeActive: boolean;
  installedAt: string | null;
  rows: MirrorRow[];
  operations: Operation[];
  conflicts: PendingConflict[];
  pin: RuntimePin | null;
  nextLocalSeq: number;
  lastPushedLocalSeq: number;
  pullCursor: string | null;
  /** RuntimeHandoff is the execution checkpoint; conversation content stays separate. */
  runtimeHandoffSession?: LocalRuntimeHandoffSession;
  peerOutbox?: Array<{ envelope: ConversationMessageSummary; expiresAt: number }>;
}
export interface LocalRuntimeMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}
export interface LocalRuntimeHandoffSession {
  adapterId: string;
  hostedExecutionHostId: string;
  cloudHandoffId: string;
  handoff: RuntimeHandoff;
  checkpoints: RuntimeHandoff[];
  messages: LocalRuntimeMessage[];
  pendingMessages: LocalRuntimeMessage[];
  status: "prepared" | "offline" | "returning" | "hosted";
}
export interface Ack {
  id: string;
  localSeq: number;
  status: "ACKED" | "REJECTED" | "CONFLICT";
  serverOpId: string;
  entity: Entity | null;
  message: string | null;
}
export interface BusinessChange {
  id: string;
  businessId: string;
  sequence: number;
  collection: Collection;
  entityId: string;
  entity: Entity | null;
}
export interface PullPage {
  accountId: string;
  storeId: string;
  fromCursor: string | null;
  newCursor: string;
  changes: BusinessChange[];
  hasMore: boolean;
}
export function scopeKey(scope: Scope): string {
  return JSON.stringify([scope.accountId, scope.storeId, scope.deviceId]);
}
export function emptyState(scope: Scope): LocalState {
  return {
    ...scope,
    schemaVersion: 1,
    installed: false,
    offlineModeActive: false,
    installedAt: null,
    rows: [],
    operations: [],
    conflicts: [],
    pin: null,
    nextLocalSeq: 1,
    lastPushedLocalSeq: 0,
    pullCursor: null
  };
}
export class OfflineError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "OfflineError";
  }
}
import type {
  RuntimeHandoff,
  ConversationMessageSummary,
  OcrEngine,
  OcrProfile,
  OcrBlockSummary
} from "@soko/shared-types";
