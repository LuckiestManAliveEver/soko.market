import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { chatModuleCommands, parseChatModuleCommand } from "../apps/web/src/chat-module-commands";

describe("seller chat module commands", () => {
  it("exposes the POS terminal in the hashtag picker registry", () => {
    expect(chatModuleCommands).toContainEqual(
      expect.objectContaining({
        hashtag: "#pos",
        module: "pos",
        toolName: "module.pos.open",
        view: "pos"
      })
    );
  });

  it("matches only an exact POS module command", () => {
    expect(parseChatModuleCommand("  #POS ")?.view).toBe("pos");
    expect(parseChatModuleCommand("#pos-terminal")?.view).toBe("pos");
    expect(parseChatModuleCommand("send #pos to a customer")).toBeNull();
    expect(parseChatModuleCommand("#pos {}")).toBeNull();
  });

  it("connects the picker command to seller-side chat navigation", () => {
    const composer = readFileSync("apps/web/src/ChatComposer.tsx", "utf8");
    const runtimeHook = readFileSync("apps/web/src/hooks/useChatRuntimeState.ts", "utf8");

    expect(composer).toContain("...chatModuleCommands");
    expect(runtimeHook).toContain("parseChatModuleCommand(message)");
    expect(runtimeHook).toContain('mode === "seller"');
    expect(runtimeHook).toContain("navigateToView(localModuleCommand.view");
  });
});
