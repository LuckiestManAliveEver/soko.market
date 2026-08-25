// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatComposer } from "../apps/web/src/ChatComposer";
import { useChatComposerState } from "../apps/web/src/hooks/useChatComposerState";

describe("mobile chat composer actions", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    host.id = "root";
    document.body.append(host);
    window.requestAnimationFrame = (callback) => window.setTimeout(callback, 0);
    window.cancelAnimationFrame = (handle) => window.clearTimeout(handle);
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("keeps only More, message, and Send inline and opens the accessible action sheet", async () => {
    function Harness() {
      const composer = useChatComposerState({
        activeConversationId: "conversation-1",
        channelEndpoints: [],
        chatDraft: "",
        initialEmailSubject: "",
        smsDefaultCountry: "KE",
        onDraftChange: vi.fn(),
        onPlatformHandoff: vi.fn(),
        onSend: vi.fn()
      });
      return (
        <ChatComposer
          activeAgentName="Shopkeeper"
          channelEndpoints={[]}
          composer={composer}
          invoices={[]}
          isAuthenticated
          isBrowserGenerating={false}
          isSending={false}
          mode="seller"
          pendingAttachments={[]}
          replyToMessageId={null}
          selectedConversationTitle=""
          selectedEmailCustomerId={null}
          onAttachmentChange={vi.fn()}
          onCancelGeneration={vi.fn()}
          onCancelReply={vi.fn()}
          onRemoveAttachment={vi.fn()}
          onRequireSignIn={vi.fn()}
          onSellerPhotoCapture={vi.fn()}
        />
      );
    }

    const root = createRoot(host);
    await act(async () => root.render(<Harness />));

    const composer = host.querySelector(".composer")!;
    expect(composer.querySelectorAll(":scope > .composer-icon-button")).toHaveLength(1);
    expect(composer.querySelector('textarea[aria-label="Message"]')).not.toBeNull();
    expect(composer.querySelectorAll(":scope > .composer-send-actions .send-button")).toHaveLength(
      1
    );
    expect(composer.textContent).toContain("Shopkeeper will answer");
    expect(host.querySelector('[aria-label="Voice input"]')).toBeNull();
    expect(host.querySelector('[aria-label="Attach file"]')).toBeNull();

    const more = host.querySelector<HTMLButtonElement>('[aria-label="Open message actions"]')!;
    await act(async () => more.click());

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute("aria-labelledby")).toBe("composer-message-actions-title");
    for (const label of [
      "Take photo",
      "Photos or files",
      "Record voice",
      "Open command",
      "Send as SMS",
      "Share to apps"
    ]) {
      expect(dialog?.querySelector(`[aria-label="${label}"]`)).not.toBeNull();
    }

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => root.unmount());
  });
});
