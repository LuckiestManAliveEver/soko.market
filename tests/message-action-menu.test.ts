import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Only "Reply" and "More" stay visible on every message by default - React/Edit/Delete/Forward
 * already collapsed into the "More" menu; Correct/Incorrect (agent messages only) now join them,
 * so an agent message doesn't show four always-visible buttons.
 */
describe("message action buttons collapse into the More menu", () => {
  it("keeps Correct/Incorrect inside the message-action-menu block, not before it", () => {
    const chatSurface = readFileSync("apps/web/src/ChatSurface.tsx", "utf8");

    const actionsStart = chatSurface.indexOf('<div className="message-actions">');
    const menuStart = chatSurface.indexOf('<div className="message-action-menu" role="menu">');
    const correctIndex = chatSurface.indexOf('aria-label="Mark agent response correct"');
    const incorrectIndex = chatSurface.indexOf('aria-label="Flag agent response as incorrect"');

    expect(actionsStart).toBeGreaterThan(-1);
    expect(menuStart).toBeGreaterThan(actionsStart);
    expect(correctIndex).toBeGreaterThan(menuStart);
    expect(incorrectIndex).toBeGreaterThan(menuStart);

    // Reply and the More toggle button are the only always-visible controls - both must appear
    // before the menu opens, not inside the conditionally-rendered menu block.
    const replyIndex = chatSurface.indexOf("onClick={() => onReply(message.id)}");
    const moreIndex = chatSurface.indexOf('aria-haspopup="menu"');
    expect(replyIndex).toBeGreaterThan(actionsStart);
    expect(replyIndex).toBeLessThan(menuStart);
    expect(moreIndex).toBeGreaterThan(actionsStart);
    expect(moreIndex).toBeLessThan(menuStart);
  });

  it("closes the menu after Correct/Incorrect is clicked, matching every other menu item", () => {
    const chatSurface = readFileSync("apps/web/src/ChatSurface.tsx", "utf8");
    const correctIndex = chatSurface.indexOf('aria-label="Mark agent response correct"');
    const incorrectEnd = chatSurface.indexOf("Incorrect", correctIndex);
    const correctToIncorrectBlock = chatSurface.slice(correctIndex, incorrectEnd);

    const closeMenuCalls = correctToIncorrectBlock.match(/setActiveMessageMenuId\(null\)/gu) ?? [];
    expect(closeMenuCalls.length).toBe(2);
  });
});
