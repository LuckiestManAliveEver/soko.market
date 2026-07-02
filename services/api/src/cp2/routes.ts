import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthChannel } from "@soko/shared-types";
import {
  clearSessionCookie,
  Cp2Error,
  createCp2Store,
  isSupportedLanguage,
  readSessionCookie,
  serializeSessionCookie,
  type Cp2Store
} from "./store.js";

export interface Cp2RouteOptions {
  store?: Cp2Store;
}

interface OtpRequestBody {
  channel?: string;
  destination?: string;
}

interface OtpVerifyBody {
  challengeId?: string;
  code?: string;
}

interface CreateBusinessBody {
  name?: string;
  language?: string;
}

interface RoleCheckBody {
  businessId?: string;
  role?: string;
}

export function registerCp2Routes(app: FastifyInstance, options: Cp2RouteOptions = {}): Cp2Store {
  const store = options.store ?? createCp2Store();

  app.post(
    "/auth/otp/request",
    async (request: FastifyRequest<{ Body: OtpRequestBody }>, reply) => {
      try {
        const channel = parseAuthChannel(request.body.channel);
        const destination = parseString(request.body.destination, "destination");
        return store.requestOtp({ channel, destination });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post("/auth/otp/verify", async (request: FastifyRequest<{ Body: OtpVerifyBody }>, reply) => {
    try {
      const challengeId = parseString(request.body.challengeId, "challengeId");
      const code = parseString(request.body.code, "code");
      const result = store.verifyOtp({ challengeId, code });
      reply.header("set-cookie", serializeSessionCookie(result.session.id));
      return result;
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.get("/session", async (request, reply) => {
    const session = store.getSession(readSessionCookie(request.headers.cookie));

    if (session === null) {
      return reply.code(401).send({
        code: "auth_required",
        message: "Authentication is required."
      });
    }

    return session;
  });

  app.post("/auth/logout", async (request, reply) => {
    const revoked = store.logout(readSessionCookie(request.headers.cookie));
    reply.header("set-cookie", clearSessionCookie());
    return {
      revoked
    };
  });

  app.post("/businesses", async (request: FastifyRequest<{ Body: CreateBusinessBody }>, reply) => {
    try {
      const name = parseString(request.body.name, "name");
      const language = parseLanguage(request.body.language);
      return store.createBusiness({
        sessionId: readSessionCookie(request.headers.cookie),
        name,
        language
      });
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.post("/roles/check", async (request: FastifyRequest<{ Body: RoleCheckBody }>, reply) => {
    try {
      const businessId = parseString(request.body.businessId, "businessId");
      const role = parseString(request.body.role, "role");
      return store.checkRole({
        sessionId: readSessionCookie(request.headers.cookie),
        businessId,
        role
      });
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  return store;
}

function parseString(value: string | undefined, name: string): string {
  if (value === undefined || value.trim().length === 0) {
    throw new Cp2Error(400, `${name}_required`, `${name} is required.`);
  }

  return value;
}

function parseAuthChannel(value: string | undefined): AuthChannel {
  if (value === "email" || value === "phone") {
    return value;
  }

  throw new Cp2Error(400, "channel_invalid", "Auth channel must be email or phone.");
}

function parseLanguage(value: string | undefined) {
  if (value === undefined || !isSupportedLanguage(value)) {
    throw new Cp2Error(400, "language_invalid", "Language must be en or sw.");
  }

  return value;
}

function sendCp2Error(reply: FastifyReply, error: unknown) {
  if (error instanceof Cp2Error) {
    return reply.code(error.statusCode).send({
      code: error.code,
      message: error.message
    });
  }

  throw error;
}
