import type { ConversationMessageSummary } from "@soko/shared-types";
import { OfflineError } from "../types.js";
import type { SokoProvider } from "./types.js";
import type { LocalDatabase } from "../db/client.js";
import type { Scope } from "../types.js";
export interface PeerTransport {
  /** Must authenticate peers and encrypt the link before exposing it to this adapter. */
  available(): Promise<boolean>;
  discover(): Promise<string[]>;
  connect(deviceId: string): Promise<void>;
  broadcast(frame: Uint8Array): Promise<void>;
  subscribe(handler: (frame: Uint8Array) => void): () => void;
  mtu: number;
}
export interface PeerQueuedMessage {
  envelope: ConversationMessageSummary;
  expiresAt: number;
}
export interface PeerOutbox {
  load(): Promise<PeerQueuedMessage[]>;
  save(messages: PeerQueuedMessage[]): Promise<void>;
}
export function createPeerOutbox(db: LocalDatabase, scope: Scope): PeerOutbox {
  return {
    load: async () => (await db.read(scope)).peerOutbox ?? [],
    save: async (messages) => {
      await db.transaction(scope, (state) => {
        state.peerOutbox = structuredClone(messages);
      });
    }
  };
}
/** Experimental transport only. Never invokes a business operation or trusts a BLE name as identity. */
export class PeerProvider implements SokoProvider {
  readonly name = "peer";
  private handlers = new Set<(envelope: ConversationMessageSummary) => void>();
  private fragments = new Map<
    string,
    { parts: Map<number, Uint8Array>; count: number; expires: number }
  >();
  private seen = new Map<string, number>();
  private seenFrames = new Map<string, number>();
  private unsubscribe: () => void;
  constructor(
    private transport: PeerTransport,
    private outbox: PeerOutbox
  ) {
    if (transport.mtu < 32) throw new Error("BLE MTU is too small.");
    this.unsubscribe = transport.subscribe((frame) => {
      this.receive(frame);
    });
  }
  supports(op: string): boolean {
    return op === "conversations.message.send";
  }
  isAvailable(): Promise<boolean> {
    return this.transport.available();
  }
  discover(): Promise<string[]> {
    return this.transport.discover();
  }
  async connect(deviceId: string): Promise<void> {
    await this.transport.connect(deviceId);
    await this.flush();
  }
  async call<T>(op: string, args: unknown): Promise<T> {
    if (!this.supports(op))
      throw new OfflineError(
        "OPERATION_UNAVAILABLE",
        "Peers can transport conversation messages only."
      );
    await this.send(args as ConversationMessageSummary);
    return { queued: true } as T;
  }
  async send(envelope: ConversationMessageSummary): Promise<void> {
    validateEnvelope(envelope);
    if (new TextEncoder().encode(JSON.stringify(envelope)).length > 64 * 1024)
      throw new Error(
        "Peer messages must fit within 64 KiB. Attachments need a separate transport."
      );
    const queue = (await this.outbox.load()).filter((entry) => entry.expiresAt > Date.now());
    if (!queue.some((entry) => entry.envelope.id === envelope.id)) {
      if (queue.length >= 100) throw new Error("Nearby message queue is full.");
      queue.push({ envelope, expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
      await this.outbox.save(queue);
    }
    if (await this.isAvailable()) await this.transmit(envelope);
    // Sending frames is not a delivery acknowledgement. Retain until the authenticated
    // application acknowledges the message, including across process restarts.
  }
  async acknowledge(id: string): Promise<void> {
    await this.outbox.save((await this.outbox.load()).filter((entry) => entry.envelope.id !== id));
  }
  onReceive(handler: (envelope: ConversationMessageSummary) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }
  async flush(): Promise<void> {
    const queue = (await this.outbox.load()).filter((entry) => entry.expiresAt > Date.now());
    await this.outbox.save(queue);
    for (const entry of queue) await this.transmit(entry.envelope);
  }
  close(): void {
    this.unsubscribe();
    this.handlers.clear();
    this.fragments.clear();
  }
  private async transmit(envelope: ConversationMessageSummary): Promise<void> {
    const bytes = new TextEncoder().encode(JSON.stringify(envelope));
    const chunkSize = this.transport.mtu - 22;
    const count = Math.ceil(bytes.length / chunkSize);
    const id = crypto.randomUUID().replaceAll("-", "");
    for (let index = 0; index < count; index++) {
      const payload = bytes.slice(index * chunkSize, (index + 1) * chunkSize);
      const frame = new Uint8Array(22 + payload.length);
      const view = new DataView(frame.buffer);
      frame[0] = 1;
      frame[1] = 7;
      for (let byte = 0; byte < 16; byte++)
        frame[byte + 2] = parseInt(id.slice(byte * 2, byte * 2 + 2), 16);
      view.setUint16(18, index);
      view.setUint16(20, count);
      frame.set(payload, 22);
      await this.transport.broadcast(frame);
    }
  }
  private receive(frame: Uint8Array): void {
    if (
      frame.length < 23 ||
      frame.length > this.transport.mtu ||
      frame[0] !== 1 ||
      !frame[1] ||
      frame[1] > 7
    )
      return;
    const now = Date.now();
    for (const [key, value] of this.fragments) if (value.expires <= now) this.fragments.delete(key);
    for (const [key, value] of this.seen) if (value <= now) this.seen.delete(key);
    for (const [key, value] of this.seenFrames) if (value <= now) this.seenFrames.delete(key);
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    const id = [...frame.slice(2, 18)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const index = view.getUint16(18);
    const count = view.getUint16(20);
    if (
      !count ||
      index >= count ||
      count * (this.transport.mtu - 22) > 64 * 1024 + this.transport.mtu
    )
      return;
    const frameKey = `${id}:${index}`;
    if (this.seenFrames.has(frameKey)) return;
    if (this.seenFrames.size >= 8_192) return;
    this.seenFrames.set(frameKey, now + 60_000);
    if (!this.fragments.has(id) && this.fragments.size >= 32) return;
    const entry = this.fragments.get(id) ?? {
      parts: new Map<number, Uint8Array>(),
      count,
      expires: now + 60_000
    };
    if (entry.count !== count) return;
    const duplicate = entry.parts.has(index);
    entry.parts.set(index, frame.slice(22));
    this.fragments.set(id, entry);
    if (!duplicate && frame[1] > 1) {
      const relay = frame.slice();
      relay[1]!--;
      void this.transport.broadcast(relay).catch(() => undefined);
    }
    if (entry.parts.size !== count) return;
    this.fragments.delete(id);
    const size = [...entry.parts.values()].reduce((sum, bytes) => sum + bytes.length, 0);
    if (size > 64 * 1024) return;
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (let part = 0; part < count; part++) {
      const data = entry.parts.get(part)!;
      bytes.set(data, offset);
      offset += data.length;
    }
    try {
      const envelope = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes)
      ) as ConversationMessageSummary;
      validateEnvelope(envelope);
      if (this.seen.has(envelope.id)) return;
      if (this.seen.size >= 1_024) this.seen.delete(this.seen.keys().next().value!);
      this.seen.set(envelope.id, now + 24 * 60 * 60 * 1000);
      for (const handler of this.handlers) handler(envelope);
    } catch {
      /* Reject malformed frames without invoking business logic. */
    }
  }
}
function validateEnvelope(value: ConversationMessageSummary): void {
  if (
    !value ||
    typeof value !== "object" ||
    [
      value.id,
      value.conversationId,
      value.clientMessageId,
      value.idempotencyKey,
      value.authorId
    ].some((id) => typeof id !== "string" || !id || id.length > 200) ||
    !["user", "agent", "system"].includes(value.author) ||
    !value.content ||
    typeof value.content !== "object"
  )
    throw new Error("Invalid canonical conversation envelope.");
}
