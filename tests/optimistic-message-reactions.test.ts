import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../apps/web/src/app-shell";
import {
  replaceActorReaction,
  replaceMessageReactions
} from "../apps/web/src/optimistic-message-reactions";

const messages: ChatMessage[] = [
  {
    id: "message-1",
    author: "contact",
    body: "Hello",
    reactions: [
      { actorId: "other", emoji: "❤️" },
      { actorId: "owner", emoji: "👍" }
    ]
  }
];

describe("optimistic message reactions", () => {
  it("replaces only the current actor reaction immediately", () => {
    expect(replaceActorReaction(messages, "message-1", "owner", "😂")[0]?.reactions).toEqual([
      { actorId: "other", emoji: "❤️" },
      { actorId: "owner", emoji: "😂" }
    ]);
  });

  it("can restore or reconcile the complete confirmed reaction list", () => {
    expect(
      replaceMessageReactions(messages, "message-1", [{ actorId: "server", emoji: "🙏" }])[0]
        ?.reactions
    ).toEqual([{ actorId: "server", emoji: "🙏" }]);
  });
});
