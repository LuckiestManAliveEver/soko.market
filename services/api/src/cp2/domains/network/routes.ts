/**
 * Fourth domain slice of in-process modularization for services/api/src/cp2/routes.ts (see
 * docs/architecture/routes-modularization-roadmap.md). All routes are user-scoped (gate on
 * `requirePinVerifiedSession`, never take a `businessId`), matching the store-side NetworkDomain
 * extraction's own finding that this domain is user-scoped, not business-scoped.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { SocialNetworkProvider } from "@soko/shared-types";
import { Cp2Error } from "../../cp2-error.js";
import { fetchGoogleContacts, googleContactsScope } from "../../google-contacts.js";
import {
  type Cp2Store,
  type PhoneContactNetworkInput,
  type SocialProfileNetworkInput,
  readSessionCookie
} from "../../store.js";
import {
  parseNullableString,
  parseOptionalString,
  parseRequestBody,
  parseString,
  sendCp2Error
} from "../../route-helpers.js";

interface NetworkConnectionBody {
  name?: string;
  phone?: string | null;
  email?: string | null;
  providerSubject?: string | null;
  handle?: string | null;
}

interface PhoneContactNetworkBody extends NetworkConnectionBody {
  connections?: NetworkConnectionBody[];
}

interface SocialProfileNetworkBody extends NetworkConnectionBody {
  relationship?: "followed" | "follower" | "interaction" | "message";
  connections?: NetworkConnectionBody[];
}

interface NetworkContactsSyncBody {
  contacts?: PhoneContactNetworkBody[];
  sourceName?: string;
}

interface NetworkSocialSyncBody {
  profiles?: SocialProfileNetworkBody[];
  sourceName?: string;
}

interface NetworkRouteBody {
  requestText?: string;
  targetNodeId?: string | null;
}

interface NetworkRouteParams {
  routeId: string;
}

interface NetworkSourceParams {
  sourceId: string;
}

interface NetworkSocialParams {
  provider: string;
}

interface NetworkProviderSyncParams {
  provider: string;
}

export function registerNetworkRoutes(app: FastifyInstance, store: Cp2Store): void {
  app.post(
    "/network/sync/contacts",
    async (request: FastifyRequest<{ Body: NetworkContactsSyncBody }>, reply) => {
      try {
        const sourceName = parseOptionalString(request.body.sourceName);
        return store.syncPhoneContacts({
          sessionId: readSessionCookie(request.headers.cookie),
          contacts: parsePhoneContactNetworkBodies(request.body.contacts),
          ...(sourceName === undefined ? {} : { sourceName })
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/network/sync/social/:provider",
    async (
      request: FastifyRequest<{ Params: NetworkSocialParams; Body: NetworkSocialSyncBody }>,
      reply
    ) => {
      try {
        const sourceName = parseOptionalString(request.body.sourceName);
        return store.syncSocialNetwork({
          sessionId: readSessionCookie(request.headers.cookie),
          provider: parseNetworkSocialProvider(request.params.provider),
          profiles: parseSocialProfileNetworkBodies(request.body.profiles),
          ...(sourceName === undefined ? {} : { sourceName })
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/network/providers/:provider/sync",
    async (request: FastifyRequest<{ Params: NetworkProviderSyncParams }>, reply) => {
      try {
        const sessionId = readSessionCookie(request.headers.cookie);
        const provider = parseNetworkSocialProvider(request.params.provider);
        if (provider === "google") {
          const credential = store.getConnectedProviderAccess({
            sessionId,
            provider: "google",
            requiredScope: googleContactsScope
          });
          const profiles = await fetchGoogleContacts({ accessToken: credential.accessToken });
          return store.syncSocialNetwork({
            sessionId,
            provider,
            profiles,
            sourceName: "Google Contacts"
          });
        }
        return store.syncConnectedSocialProvider({ sessionId, provider });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get("/network", async (request, reply) => {
    try {
      return store.getNetworkGraph({
        sessionId: readSessionCookie(request.headers.cookie)
      });
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.get("/network/direct", async (request, reply) => {
    try {
      return {
        nodes: store.getDirectNetwork({
          sessionId: readSessionCookie(request.headers.cookie)
        })
      };
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.get("/network/extended", async (request, reply) => {
    try {
      return {
        nodes: store.getExtendedNetwork({
          sessionId: readSessionCookie(request.headers.cookie)
        })
      };
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.post(
    "/network/routes",
    async (request: FastifyRequest<{ Body: NetworkRouteBody }>, reply) => {
      try {
        return store.createAgentRoute({
          sessionId: readSessionCookie(request.headers.cookie),
          requestText: parseString(request.body.requestText, "requestText"),
          targetNodeId: parseNullableString(request.body.targetNodeId)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/network/routes/:routeId",
    async (request: FastifyRequest<{ Params: NetworkRouteParams }>, reply) => {
      try {
        return store.getAgentRoute({
          sessionId: readSessionCookie(request.headers.cookie),
          routeId: parseString(request.params.routeId, "routeId")
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/network/routes/:routeId/approve",
    async (request: FastifyRequest<{ Params: NetworkRouteParams }>, reply) => {
      try {
        return store.approveAgentRoute({
          sessionId: readSessionCookie(request.headers.cookie),
          routeId: parseString(request.params.routeId, "routeId")
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/network/routes/:routeId/reject",
    async (request: FastifyRequest<{ Params: NetworkRouteParams }>, reply) => {
      try {
        return store.rejectAgentRoute({
          sessionId: readSessionCookie(request.headers.cookie),
          routeId: parseString(request.params.routeId, "routeId")
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.delete(
    "/network/sources/:sourceId",
    async (request: FastifyRequest<{ Params: NetworkSourceParams }>, reply) => {
      try {
        return store.deleteNetworkSource({
          sessionId: readSessionCookie(request.headers.cookie),
          sourceId: parseString(request.params.sourceId, "sourceId")
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );
}

function parsePhoneContactNetworkBodies(
  value: PhoneContactNetworkBody[] | undefined
): PhoneContactNetworkInput[] {
  if (!Array.isArray(value)) {
    throw new Cp2Error(400, "contacts_required", "contacts is required.");
  }

  return value.map((contact, index) => parseNetworkConnectionBody(contact, `contacts.${index}`));
}

function parseSocialProfileNetworkBodies(
  value: SocialProfileNetworkBody[] | undefined
): SocialProfileNetworkInput[] {
  if (!Array.isArray(value)) {
    throw new Cp2Error(400, "profiles_required", "profiles is required.");
  }

  return value.map((profile, index) => {
    const parsed = parseNetworkConnectionBody(profile, `profiles.${index}`);
    const relationship = profile.relationship;

    if (
      relationship !== undefined &&
      relationship !== "followed" &&
      relationship !== "follower" &&
      relationship !== "interaction" &&
      relationship !== "message"
    ) {
      throw new Cp2Error(
        400,
        "network_relationship_invalid",
        "Social network relationship is not supported."
      );
    }

    return relationship === undefined
      ? parsed
      : {
          ...parsed,
          relationship
        };
  });
}

function parseNetworkConnectionBody(
  value: NetworkConnectionBody,
  name: string
): PhoneContactNetworkInput {
  const record = parseRequestBody(value);
  const parsed: PhoneContactNetworkInput = {
    name: parseString(record.name, `${name}.name`),
    phone: parseNullableString(record.phone),
    email: parseNullableString(record.email),
    providerSubject: parseNullableString(record.providerSubject),
    handle: parseNullableString(record.handle)
  };

  if (record.connections !== undefined) {
    parsed.connections = parseNestedNetworkConnectionBodies(
      record.connections,
      `${name}.connections`
    );
  }

  return parsed;
}

function parseNestedNetworkConnectionBodies(
  value: unknown,
  name: string
): PhoneContactNetworkInput[] {
  if (!Array.isArray(value)) {
    throw new Cp2Error(400, "network_connections_invalid", `${name} must be an array.`);
  }

  return value.map((connection, index) =>
    parseNetworkConnectionBody(connection as NetworkConnectionBody, `${name}.${index}`)
  );
}

function parseNetworkSocialProvider(value: string): SocialNetworkProvider {
  if (
    value === "facebook" ||
    value === "instagram" ||
    value === "whatsapp" ||
    value === "tiktok" ||
    value === "x" ||
    value === "linkedin" ||
    value === "google" ||
    value === "microsoft" ||
    value === "github" ||
    value === "apple"
  ) {
    return value;
  }

  throw new Cp2Error(400, "network_provider_invalid", "Social network provider is not supported.");
}
