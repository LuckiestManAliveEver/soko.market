import type { ShellView } from "./app-shell";

export interface ChatModuleCommand {
  hashtag: string;
  aliases: readonly string[];
  description: string;
  inputFields: readonly string[];
  module: string;
  requiresConfirmation: false;
  toolName: string;
  view: ShellView;
}

export const chatModuleCommands: readonly ChatModuleCommand[] = [
  {
    hashtag: "#pos",
    aliases: ["#pos", "#pos-terminal"],
    description: "Open the point-of-sale terminal and ring up a sale",
    inputFields: [],
    module: "pos",
    requiresConfirmation: false,
    toolName: "module.pos.open",
    view: "pos"
  }
];

export function parseChatModuleCommand(message: string): ChatModuleCommand | null {
  const normalized = message.trim().toLowerCase();
  return (
    chatModuleCommands.find((command) =>
      command.aliases.some((alias) => alias.toLowerCase() === normalized)
    ) ?? null
  );
}
