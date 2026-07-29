import type {
  BrowserCheckpointCompatibilityContract,
  BrowserRuntimeContract,
  BrowserTaskCheckpointReason,
  BrowserTaskStateCheckpoint,
  ModelMessage,
  RetrievedContext
} from "./browser-inference-types";
import { taskStateContractsArePortable } from "./browser-inference-contracts";

const checkpointRetentionMs = 24 * 60 * 60 * 1_000;
const maximumPartialOutputCharacters = 16_000;

export interface BrowserTaskCheckpointStore {
  putTaskCheckpoint(checkpoint: BrowserTaskStateCheckpoint): Promise<void>;
  deleteTaskCheckpoint(accountId: string, checkpointId: string): Promise<void>;
}

export class BrowserTaskCheckpointSession {
  private checkpoint: BrowserTaskStateCheckpoint;
  private writeQueue = Promise.resolve();

  constructor(
    private readonly store: BrowserTaskCheckpointStore,
    input: {
      accountId: string;
      businessId: string;
      conversationId: string;
      requestId: string;
      modelId: string;
      runtimeContract: BrowserRuntimeContract;
      compatibilityContract: BrowserCheckpointCompatibilityContract;
      objective: string;
      relevantMessages: ModelMessage[];
      now?: Date;
    }
  ) {
    const now = input.now ?? new Date();
    this.checkpoint = {
      version: 2,
      id: browserTaskCheckpointId(input.businessId, input.requestId),
      accountId: input.accountId,
      businessId: input.businessId,
      conversationId: input.conversationId,
      requestId: input.requestId,
      modelId: input.modelId,
      runtimeContract: { ...input.runtimeContract },
      compatibilityContract: { ...input.compatibilityContract },
      objective: input.objective.slice(0, 4_000),
      relevantMessages: sanitizeMessages(input.relevantMessages),
      partialOutput: "",
      continuationInstruction: "Continue the interrupted bounded task without repeating output.",
      reason: "task-start",
      status: "running",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + checkpointRetentionMs).toISOString()
    };
  }

  start(): Promise<void> {
    return this.persist("task-start", "running");
  }

  appendOutput(token: string): void {
    this.checkpoint.partialOutput = `${this.checkpoint.partialOutput}${token}`.slice(
      -maximumPartialOutputCharacters
    );
  }

  checkpointNow(reason: BrowserTaskCheckpointReason): Promise<void> {
    return this.persist(reason, reason === "task-start" ? "running" : "interrupted");
  }

  interrupt(reason: BrowserTaskCheckpointReason = "generation-failed"): Promise<void> {
    return this.persist(reason, "interrupted");
  }

  async complete(): Promise<void> {
    await this.writeQueue;
    await this.store.deleteTaskCheckpoint(this.checkpoint.accountId, this.checkpoint.id);
  }

  attachPageLifecycle(
    documentTarget: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">,
    windowTarget: Pick<Window, "addEventListener" | "removeEventListener">
  ): () => void {
    const onVisibilityChange = () => {
      if (documentTarget.visibilityState === "hidden") {
        void this.checkpointNow("page-hidden");
      }
    };
    const onPageHide = () => {
      void this.checkpointNow("page-freeze");
    };
    documentTarget.addEventListener("visibilitychange", onVisibilityChange);
    windowTarget.addEventListener("pagehide", onPageHide);
    return () => {
      documentTarget.removeEventListener("visibilitychange", onVisibilityChange);
      windowTarget.removeEventListener("pagehide", onPageHide);
    };
  }

  snapshot(): BrowserTaskStateCheckpoint {
    return {
      ...this.checkpoint,
      runtimeContract: { ...this.checkpoint.runtimeContract },
      compatibilityContract: { ...this.checkpoint.compatibilityContract },
      relevantMessages: this.checkpoint.relevantMessages.map((message) => ({ ...message }))
    };
  }

  private persist(
    reason: BrowserTaskCheckpointReason,
    status: BrowserTaskStateCheckpoint["status"]
  ): Promise<void> {
    this.checkpoint = {
      ...this.checkpoint,
      reason,
      status,
      updatedAt: new Date().toISOString()
    };
    const snapshot = this.snapshot();
    this.writeQueue = this.writeQueue
      .catch(() => undefined)
      .then(() => this.store.putTaskCheckpoint(snapshot));
    return this.writeQueue;
  }
}

export function taskCheckpointRecoveryContext(
  checkpoint: BrowserTaskStateCheckpoint | null,
  input: {
    businessId: string;
    conversationId: string;
    requestId: string;
    compatibilityContract: BrowserCheckpointCompatibilityContract;
    objective: string;
    now?: Date;
  }
): RetrievedContext[] {
  if (
    checkpoint === null ||
    checkpoint.status !== "interrupted" ||
    checkpoint.businessId !== input.businessId ||
    checkpoint.conversationId !== input.conversationId ||
    checkpoint.requestId !== input.requestId ||
    checkpoint.version !== 2 ||
    !taskStateContractsArePortable(checkpoint.compatibilityContract, input.compatibilityContract) ||
    checkpoint.objective !== input.objective.slice(0, 4_000) ||
    Date.parse(checkpoint.expiresAt) <= (input.now ?? new Date()).getTime()
  ) {
    return [];
  }
  const partial =
    checkpoint.partialOutput.trim().length === 0
      ? "No output was committed before interruption."
      : `Partial output before interruption:\n${checkpoint.partialOutput.trim()}`;
  return [
    {
      sourceType: "conversation",
      sourceId: `task-checkpoint:${checkpoint.id}`,
      content: `${partial}\n${checkpoint.continuationInstruction}`,
      relevanceScore: 1,
      timestamp: checkpoint.updatedAt,
      tokenEstimate: Math.max(1, Math.ceil((partial.length + 80) / 4)),
      trustLevel: "derived"
    }
  ];
}

export function browserTaskCheckpointId(businessId: string, requestId: string): string {
  return `${businessId}:${requestId}`;
}

function sanitizeMessages(messages: ModelMessage[]): ModelMessage[] {
  return messages.slice(-24).map((message) => ({
    role: message.role,
    content: message.content.slice(0, 4_000)
  }));
}
