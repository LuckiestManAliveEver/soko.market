import { describe, expect, it } from "vitest";
import {
  PeerProvider,
  PEER_OUTBOX_RESEND_CAP,
  type PeerTransport,
  type PeerQueuedMessage
} from "../packages/offline-runtime/index";
import type { ConversationMessageSummary } from "@soko/shared-types";

describe("Prototype nearby transport", () => {
  it("queues while disconnected, reassembles UTF-8 frames and waits for delivery acknowledgement", async () => {
    const frameListeners = new Set<(frame: Uint8Array) => void>();
    let available = false;
    const sent: Uint8Array[] = [];
    const transport: PeerTransport = {
      mtu: 128,
      available: async () => available,
      discover: async () => ["peer"],
      connect: async () => {
        available = true;
      },
      broadcast: async (frame) => {
        sent.push(frame);
      },
      subscribe: (handler) => {
        frameListeners.add(handler);
        return () => {
          frameListeners.delete(handler);
        };
      }
    };
    let queue: PeerQueuedMessage[] = [];
    const outbox = {
      load: async () => queue,
      save: async (value: PeerQueuedMessage[]) => {
        queue = value;
      }
    };
    const provider = new PeerProvider(transport, outbox);
    const envelope = {
      id: "message",
      conversationId: "conversation",
      clientMessageId: "client",
      idempotencyKey: "dedupe",
      author: "user",
      authorId: "account",
      content: { type: "text", text: "Habari 👋 ".repeat(80) }
    } as ConversationMessageSummary;
    try {
      await provider.send(envelope);
      expect(sent).toHaveLength(0);
      expect(queue).toHaveLength(1);
      await provider.connect("peer");
      expect(sent.length).toBeGreaterThan(1);
      expect(sent.every((frame) => frame.length <= 128)).toBe(true);
      const received: ConversationMessageSummary[] = [];
      provider.onReceive((message) => received.push(message));
      const original = sent.map((frame) => {
        const copy = frame.slice();
        copy[1] = 1;
        return copy;
      });
      for (const frame of [...original].reverse())
        for (const handler of frameListeners) handler(frame);
      for (const frame of original) for (const handler of frameListeners) handler(frame);
      expect(received).toEqual([envelope]);
      expect(queue).toHaveLength(1);
      await provider.acknowledge(envelope.id);
      expect(queue).toHaveLength(0);
      expect(provider.supports("catalogue.create")).toBe(false);
    } finally {
      provider.close();
    }
  });

  it("drops an unacknowledged message with a visible failure after the resend cap", async () => {
    let queue: PeerQueuedMessage[] = [];
    const transport: PeerTransport = {
      mtu: 128,
      available: async () => true,
      discover: async () => ["peer"],
      connect: async () => undefined,
      broadcast: async () => undefined,
      subscribe: () => () => undefined
    };
    const outbox = {
      load: async () => queue,
      save: async (value: PeerQueuedMessage[]) => {
        queue = value;
      }
    };
    const provider = new PeerProvider(transport, outbox);
    const envelope = {
      id: "never-acked",
      conversationId: "conversation",
      clientMessageId: "client",
      idempotencyKey: "dedupe",
      author: "user",
      authorId: "account",
      content: { type: "text", text: "hello" }
    } as ConversationMessageSummary;
    const failed: ConversationMessageSummary[] = [];
    provider.onDeliveryFailed((message) => failed.push(message));
    try {
      await provider.send(envelope);
      expect(queue).toHaveLength(1);
      expect(queue[0]!.attempts).toBe(1);
      // send() already counted as one attempt; flush() the remaining attempts up to the cap.
      for (let attempt = 1; attempt < PEER_OUTBOX_RESEND_CAP - 1; attempt++) await provider.flush();
      expect(queue).toHaveLength(1);
      expect(queue[0]!.attempts).toBe(PEER_OUTBOX_RESEND_CAP - 1);
      expect(failed).toHaveLength(0);
      await provider.flush();
      expect(queue).toHaveLength(0);
      expect(failed).toEqual([envelope]);
    } finally {
      provider.close();
    }
  });
});
