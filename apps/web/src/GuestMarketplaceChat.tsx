import { useEffect, useRef, useState, type FormEvent } from "react";

import { Surface } from "@soko/ui";
import type { BuyFeedSummary } from "@soko/shared-types";

import { getJson } from "./api-helpers";
import { getErrorMessage } from "./chat-message-plumbing";
import { useAsyncActions } from "./hooks/useAsyncActions";
import { StatusResultCard } from "./StatusResultCard";

interface GuestMessage {
  id: string;
  author: "agent" | "guest";
  body: string;
}

/**
 * A small, dedicated conversation surface for someone browsing the marketplace without an
 * account - not the full owner ChatSurface shell with guest-mode guards, but its own scoped
 * screen: no session list, no mic/attach/camera (nothing to attach as a guest), one query at a
 * time against the same /buy/search endpoint the authenticated marketplace card already uses.
 * Every result leads to signup, never to an unscoped write - matching the view_only principal
 * guests already run under server-side.
 */
export function GuestMarketplaceChat(props: { onSignUp: () => void }) {
  const { isPending, runAction } = useAsyncActions();
  const [messages, setMessages] = useState<GuestMessage[]>([
    {
      id: "welcome",
      author: "agent",
      body: 'Browsing as a guest — ask me to find something. Try "fresh tomatoes" or "maize flour".'
    }
  ]);
  const [draft, setDraft] = useState("");
  const [feed, setFeed] = useState<BuyFeedSummary | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      const messageList = messageListRef.current;
      if (messageList === null) return;
      messageList.scrollTo({ top: messageList.scrollHeight, behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [messages.length, feed]);

  function appendMessage(author: GuestMessage["author"], body: string) {
    setMessages((current) => [
      ...current,
      { id: `${author}-${Date.now()}-${current.length}`, author, body }
    ]);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = draft.trim();
    if (query.length === 0) return;
    setDraft("");
    appendMessage("guest", query);

    await runAction("guest-buy-search", async () => {
      try {
        const result = await getJson<BuyFeedSummary>(
          `/buy/search?query=${encodeURIComponent(query)}`
        );
        setFeed(result);
      } catch (error) {
        appendMessage("agent", getErrorMessage(error));
      }
    });
  }

  return (
    <Surface title="Browse the marketplace">
      <main className="guest-marketplace-shell">
        <header className="guest-marketplace-header">
          <button
            className="auth-back-button"
            type="button"
            onClick={props.onSignUp}
            aria-label="Back"
          >
            <span aria-hidden="true">←</span>
          </button>
          <div>
            <strong>Browse the marketplace</strong>
            <span>Guest — not signed in</span>
          </div>
          <span className="auth-header-spacer" aria-hidden="true" />
        </header>

        <div className="guest-chat-banner" role="status">
          <span>Guest view — sign up to message sellers directly.</span>
          <button type="button" onClick={props.onSignUp}>
            Sign up
          </button>
        </div>

        <div className="guest-message-list" ref={messageListRef}>
          {messages.map((message) => (
            <div
              key={message.id}
              className={`message ${message.author === "agent" ? "sokoclaw" : "merchant"}`}
            >
              <span>{message.author === "agent" ? "Agent" : "You"}</span>
              <p>{message.body}</p>
            </div>
          ))}

          {feed !== null ? (
            <section className="buy-feed" aria-label="Search results">
              {feed.results.length === 0 ? (
                <p className="marketplace-directory-status">
                  No results for &quot;{feed.query}&quot;.
                </p>
              ) : (
                feed.results.map((result) => (
                  <StatusResultCard
                    key={result.id}
                    result={result}
                    isAuthenticated={false}
                    onAddToCart={() => {}}
                    onSignUp={props.onSignUp}
                  />
                ))
              )}
            </section>
          ) : null}
        </div>

        <form className="guest-composer" onSubmit={(event) => void handleSubmit(event)}>
          <input
            aria-label="Search the marketplace"
            placeholder="Search the marketplace — try 'tomatoes'"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit" disabled={isPending("guest-buy-search")}>
            <span className="send-icon" aria-hidden="true" />
            <span className="visually-hidden">Send</span>
          </button>
        </form>
      </main>
    </Surface>
  );
}
