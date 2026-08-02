import type { ChatMessage } from "./app-shell";

type MessageReaction = NonNullable<ChatMessage["reactions"]>[number];

export function replaceActorReaction(
  messages: ChatMessage[],
  messageId: string,
  actorId: string,
  emoji: string | null
): ChatMessage[] {
  const nextEmoji = emoji?.trim() ?? "";
  return messages.map((message) => {
    if (message.id !== messageId) return message;
    const reactions = (message.reactions ?? []).filter((reaction) => reaction.actorId !== actorId);
    if (nextEmoji.length > 0) reactions.push({ actorId, emoji: nextEmoji });
    return { ...message, reactions };
  });
}

export function replaceMessageReactions(
  messages: ChatMessage[],
  messageId: string,
  reactions: MessageReaction[]
): ChatMessage[] {
  return messages.map((message) =>
    message.id === messageId ? { ...message, reactions: [...reactions] } : message
  );
}
