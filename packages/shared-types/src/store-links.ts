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
   * `{handle}.soko.market` (the `soko.` prefix on the underlying sokoId is stripped - it would
   * otherwise double up into `soko.{handle}.soko.market`, which is not the intended subdomain).
   * The API service (`services/api/src/app.ts`) already resolves and 302-redirects this Host to
   * the storefront the moment a request actually reaches it, but nothing does today: it requires
   * a wildcard `*.soko.market` custom domain registered against that service, which is a real
   * production DNS/hosting change, not something this repo can apply on its own
   * (docs/architecture/soko-id-slug-system.md). `universal` below is what actually resolves today.
   */
  web: string;
  /** Empty string when no bot username is configured (mirrors the existing
   *  TelegramChannelAdapter.createLinkUrl null-on-unconfigured convention). */
  telegram: string;
  /** The channel-neutral fallback that resolves today, via `GET /s/:sokoId`. */
  universal: string;
}

export function getStoreLinks(sokoId: string, config: StoreLinkConfig): StoreLinks {
  const trimmedSokoId = sokoId.trim();
  const handle = encodeURIComponent(trimmedSokoId);
  const bareHandle = encodeURIComponent(trimmedSokoId.replace(/^soko\./u, ""));
  return {
    web: `https://${bareHandle}.soko.market`,
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
