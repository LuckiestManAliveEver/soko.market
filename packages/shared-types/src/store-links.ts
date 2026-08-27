/**
 * Docs/architecture/soko-id-slug-system.md. The one place every channel-facing link for a store
 * is generated - callers supply the environment-specific bits (web origin, bot username) rather
 * than this function reading `process.env`/`window.location` itself, so the identical logic runs
 * unmodified on both the API (Node) and the web app (Vite/browser).
 */
export interface StoreLinkConfig {
  /** e.g. "https://soko.market" - no trailing slash. */
  webOrigin: string;
  /** Telegram bot username without the leading "@"; empty string if not configured. */
  telegramBotUsername: string;
}

export interface StoreLinks {
  /**
   * Aspirational: `{handle}.soko.market` requires a wildcard custom domain registered against a
   * server capable of Host-header routing, which does not exist in this deployment today (the web
   * app is a static site with a single fixed domain, `render.yaml`). This field is still generated
   * because it's pure string formatting, and becomes live the moment that infra step is done -
   * `universal` below is what actually resolves today.
   */
  web: string;
  /** Empty string when no bot username is configured (mirrors the existing
   *  TelegramChannelAdapter.createLinkUrl null-on-unconfigured convention). */
  telegram: string;
  /** The channel-neutral fallback that resolves today, via `GET /s/:sokoId`. */
  universal: string;
}

export function getStoreLinks(sokoId: string, config: StoreLinkConfig): StoreLinks {
  const handle = encodeURIComponent(sokoId.trim());
  return {
    web: `https://${handle}.soko.market`,
    telegram:
      config.telegramBotUsername.trim() === ""
        ? ""
        : `https://t.me/${encodeURIComponent(config.telegramBotUsername.trim())}?start=${handle}`,
    universal: `${config.webOrigin.replace(/\/+$/u, "")}/s/${handle}`
    // WhatsApp: deliberately not implemented. The WhatsApp Business API's constraints on
    // prefilled/deep-link start parameters for an unauthenticated first contact haven't been
    // confirmed yet (docs/architecture/soko-id-slug-system.md) - add a `whatsapp` field here once
    // that's verified, following the same pattern as `telegram` above.
  };
}
