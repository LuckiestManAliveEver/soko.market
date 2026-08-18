/**
 * Eighth domain slice of in-process modularization for services/api/src/cp2/routes.ts (see
 * docs/architecture/routes-modularization-roadmap.md). Needs `oauthAllowedRedirectOrigins` (a
 * `Set<string>` computed once in `registerCp2Routes` from `Cp2RouteOptions`) passed in, since
 * `oauthRedirectUriForRequest` validates against it. `defaultOAuthRedirectUri` is exported since
 * the not-yet-extracted messaging cluster's connected-mailbox OAuth flow calls it too - a genuine
 * cross-domain reference (it reuses the exact same "what's my API origin" logic), not duplicated.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { Cp2Error } from "../../cp2-error.js";
import { type Cp2Store, readSessionCookie } from "../../store.js";
import {
  createOAuthStartPayload,
  exchangeOAuthCode,
  fetchOAuthProfile,
  getOAuthProviderConfig,
  isOAuthProviderConfigured,
  listOAuthProviders,
  parseOAuthProvider
} from "../../oauth.js";
import {
  parseOptionalString,
  parseString,
  sendCp2Error,
  setAuthSessionCookies,
  type BusinessParams
} from "../../route-helpers.js";

interface OAuthStartBody {
  provider?: string;
  redirectUri?: string;
}

interface OAuthStartParams {
  provider: string;
}

interface AuthIdentityParams {
  identityId: string;
}

interface OAuthCallbackBody {
  code?: string;
  csrfToken?: string;
  provider?: string;
  state?: string;
}

interface OAuthCallbackParams {
  provider: string;
}

interface OAuthCallbackQuery {
  code?: string;
  csrfToken?: string;
  error?: string;
  state?: string;
}

interface SocialIdentityParams extends BusinessParams {
  identityId: string;
}

/** Exported - domains/messaging/routes.ts's (not yet extracted) connected-mailbox OAuth flow calls this too. */
export function defaultOAuthRedirectUri(request: FastifyRequest): string {
  const origin = request.headers.origin ?? process.env.APP_URL?.trim() ?? "http://127.0.0.1:5173";
  let url: URL;

  try {
    url = new URL("/auth/oauth/callback", origin);
  } catch {
    throw new Cp2Error(400, "redirect_uri_invalid", "OAuth redirect URI is invalid.");
  }

  return url.toString();
}

export function registerOAuthRoutes(
  app: FastifyInstance,
  store: Cp2Store,
  oauthAllowedRedirectOrigins: ReadonlySet<string>
): void {
  function oauthRedirectUriForRequest(
    request: FastifyRequest,
    providerConfig: ReturnType<typeof getOAuthProviderConfig>,
    requestedRedirectUri?: string
  ): string {
    const redirectUri = requestedRedirectUri ?? defaultOAuthRedirectUri(request);

    let url: URL;

    try {
      url = new URL(redirectUri);
    } catch {
      throw new Cp2Error(400, "redirect_uri_invalid", "OAuth redirect URI is invalid.");
    }

    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.pathname !== providerConfig.callbackPath ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.search.length > 0 ||
      url.hash.length > 0 ||
      !oauthAllowedRedirectOrigins.has(url.origin)
    ) {
      throw new Cp2Error(400, "redirect_uri_invalid", "OAuth redirect URI is not allowed.");
    }

    return url.toString();
  }

  function enabledAuthProviders() {
    return {
      providers: listOAuthProviders().filter(
        (provider) =>
          provider.enabled !== false && provider.implemented !== false && provider.configured
      )
    };
  }

  function startOAuthSession(
    request: FastifyRequest,
    input: { provider?: unknown; redirectUri?: string | undefined }
  ) {
    const provider = parseOAuthProvider(input.provider);
    const providerConfig = getOAuthProviderConfig(provider);

    if (!providerConfig.enabled) {
      throw new Cp2Error(403, "oauth_provider_disabled", "Social login is disabled.");
    }

    if (!providerConfig.implemented) {
      throw new Cp2Error(
        503,
        "oauth_provider_unavailable",
        `${providerConfig.displayName} sign-in is unavailable.`
      );
    }

    if (!isOAuthProviderConfigured(providerConfig)) {
      throw new Cp2Error(
        503,
        "oauth_provider_unconfigured",
        `${providerConfig.displayName} sign-in is not configured.`
      );
    }

    const redirectUri = oauthRedirectUriForRequest(
      request,
      providerConfig,
      parseOptionalString(input.redirectUri)
    );
    const startPayload = createOAuthStartPayload({
      provider: providerConfig,
      redirectUri
    });
    return store.beginOAuthSession({
      accountSessionId: readSessionCookie(request.headers.cookie),
      authorizationUrl: startPayload.authorizationUrl,
      codeChallenge: startPayload.codeChallenge,
      codeVerifier: startPayload.codeVerifier,
      csrfToken: startPayload.csrfToken,
      provider,
      redirectUri: startPayload.redirectUri,
      state: startPayload.state
    });
  }

  async function completeOAuthSession(input: {
    provider: unknown;
    state: unknown;
    csrfToken: unknown;
    code?: unknown;
  }) {
    const provider = parseOAuthProvider(input.provider);
    const state = parseString(input.state, "state");
    const csrfToken = parseString(input.csrfToken, "csrfToken");
    const providerConfig = getOAuthProviderConfig(provider);

    if (!providerConfig.enabled) {
      throw new Cp2Error(403, "oauth_provider_disabled", "Social login is disabled.");
    }

    if (!providerConfig.implemented) {
      throw new Cp2Error(
        503,
        "oauth_provider_unavailable",
        `${providerConfig.displayName} sign-in is unavailable.`
      );
    }

    const exchangeData = store.getOAuthExchangeData({
      provider,
      state,
      csrfToken
    });
    const tokens = await exchangeOAuthCode({
      provider: providerConfig,
      code: parseString(input.code, "code"),
      codeVerifier: exchangeData.codeVerifier,
      redirectUri: exchangeData.redirectUri
    });
    const profile = await fetchOAuthProfile({ provider: providerConfig, tokens });
    return store.completeOAuthCallback({
      provider,
      state,
      csrfToken,
      profile,
      tokens
    });
  }

  app.get("/auth/oauth/providers", async () => ({
    providers: listOAuthProviders()
  }));

  app.get("/api/auth/oauth/providers", async () => ({
    providers: listOAuthProviders()
  }));

  app.get("/auth/providers", async () => enabledAuthProviders());
  app.get("/api/auth/providers", async () => enabledAuthProviders());

  app.post(
    "/auth/oauth/start",
    async (request: FastifyRequest<{ Body: OAuthStartBody }>, reply) => {
      try {
        return startOAuthSession(request, request.body);
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/api/auth/oauth/start",
    async (request: FastifyRequest<{ Body: OAuthStartBody }>, reply) => {
      try {
        return startOAuthSession(request, request.body);
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/auth/oauth/:provider/start",
    async (
      request: FastifyRequest<{ Params: OAuthStartParams; Querystring: { redirectUri?: string } }>,
      reply
    ) => {
      try {
        return startOAuthSession(request, {
          provider: request.params.provider,
          redirectUri: request.query.redirectUri
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/api/auth/oauth/:provider/start",
    async (
      request: FastifyRequest<{ Params: OAuthStartParams; Querystring: { redirectUri?: string } }>,
      reply
    ) => {
      try {
        return startOAuthSession(request, {
          provider: request.params.provider,
          redirectUri: request.query.redirectUri
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/auth/oauth/callback",
    async (request: FastifyRequest<{ Body: OAuthCallbackBody }>, reply) => {
      try {
        const result = await completeOAuthSession({
          provider: request.body.provider,
          state: request.body.state,
          csrfToken: request.body.csrfToken,
          code: request.body.code
        });
        setAuthSessionCookies(reply, request, store, result.session.id);
        return result;
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/api/auth/oauth/callback",
    async (request: FastifyRequest<{ Body: OAuthCallbackBody }>, reply) => {
      try {
        const result = await completeOAuthSession({
          provider: request.body.provider,
          state: request.body.state,
          csrfToken: request.body.csrfToken,
          code: request.body.code
        });
        setAuthSessionCookies(reply, request, store, result.session.id);
        return result;
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/auth/oauth/:provider/callback",
    async (
      request: FastifyRequest<{ Params: OAuthCallbackParams; Querystring: OAuthCallbackQuery }>,
      reply
    ) => {
      try {
        if (request.query.error !== undefined) {
          throw new Cp2Error(401, "oauth_provider_error", request.query.error);
        }

        if (request.query.csrfToken === undefined) {
          const relayUrl = new URL(
            oauthRedirectUriForRequest(
              request,
              getOAuthProviderConfig(parseOAuthProvider(request.params.provider))
            )
          );
          relayUrl.searchParams.set("provider", request.params.provider);
          relayUrl.searchParams.set("state", parseString(request.query.state, "state"));
          relayUrl.searchParams.set("code", parseString(request.query.code, "code"));
          return reply.redirect(relayUrl.toString());
        }

        const result = await completeOAuthSession({
          provider: request.params.provider,
          state: request.query.state,
          csrfToken: request.query.csrfToken,
          code: request.query.code
        });
        setAuthSessionCookies(reply, request, store, result.session.id);
        return result;
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/api/auth/oauth/:provider/callback",
    async (
      request: FastifyRequest<{ Params: OAuthCallbackParams; Querystring: OAuthCallbackQuery }>,
      reply
    ) => {
      try {
        if (request.query.error !== undefined) {
          throw new Cp2Error(401, "oauth_provider_error", request.query.error);
        }

        if (request.query.csrfToken === undefined) {
          const relayUrl = new URL(
            oauthRedirectUriForRequest(
              request,
              getOAuthProviderConfig(parseOAuthProvider(request.params.provider))
            )
          );
          relayUrl.searchParams.set("provider", request.params.provider);
          relayUrl.searchParams.set("state", parseString(request.query.state, "state"));
          relayUrl.searchParams.set("code", parseString(request.query.code, "code"));
          return reply.redirect(relayUrl.toString());
        }

        const result = await completeOAuthSession({
          provider: request.params.provider,
          state: request.query.state,
          csrfToken: request.query.csrfToken,
          code: request.query.code
        });
        setAuthSessionCookies(reply, request, store, result.session.id);
        return result;
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get("/auth/accounts", async (request, reply) => {
    try {
      return {
        accounts: store.listLoginAccounts({
          sessionId: readSessionCookie(request.headers.cookie)
        })
      };
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.get("/api/auth/accounts", async (request, reply) => {
    try {
      return {
        accounts: store.listLoginAccounts({
          sessionId: readSessionCookie(request.headers.cookie)
        })
      };
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.post(
    "/auth/accounts/:provider/link/start",
    async (
      request: FastifyRequest<{ Params: OAuthStartParams; Body: { redirectUri?: string } }>,
      reply
    ) => {
      try {
        return startOAuthSession(request, {
          provider: request.params.provider,
          redirectUri: request.body?.redirectUri
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/api/auth/accounts/:provider/link/start",
    async (
      request: FastifyRequest<{ Params: OAuthStartParams; Body: { redirectUri?: string } }>,
      reply
    ) => {
      try {
        return startOAuthSession(request, {
          provider: request.params.provider,
          redirectUri: request.body?.redirectUri
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.delete(
    "/auth/accounts/:identityId/disconnect",
    async (request: FastifyRequest<{ Params: AuthIdentityParams }>, reply) => {
      try {
        return store.disconnectLoginAccount({
          sessionId: readSessionCookie(request.headers.cookie),
          identityId: request.params.identityId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.delete(
    "/api/auth/accounts/:identityId/disconnect",
    async (request: FastifyRequest<{ Params: AuthIdentityParams }>, reply) => {
      try {
        return store.disconnectLoginAccount({
          sessionId: readSessionCookie(request.headers.cookie),
          identityId: request.params.identityId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post("/auth/social/login", async (_request, reply) =>
    sendCp2Error(reply, new Cp2Error(403, "social_login_disabled", "Social login is disabled."))
  );

  app.get(
    "/businesses/:businessId/social-accounts",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return {
          accounts: store.listConnectedSocialAccounts({
            sessionId: readSessionCookie(request.headers.cookie),
            businessId: request.params.businessId
          })
        };
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.delete(
    "/businesses/:businessId/social-accounts/:identityId",
    async (request: FastifyRequest<{ Params: SocialIdentityParams }>, reply) => {
      try {
        return store.disconnectSocialAccount({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          identityId: request.params.identityId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );
}
