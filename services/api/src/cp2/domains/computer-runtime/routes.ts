/**
 * REST-direct surface for the computer-runtime domain (docs/architecture/computer-runtime.md).
 * These routes are conventional UI actions - control take/release, approval decisions, and
 * persistent-profile management - that call the exact same canonical domain operations the
 * computer.* chat capabilities use (see capability-first-runtime.md, "Conventional UI routes call
 * those same canonical domain operations"). Session creation/navigate/observe/click/type/scroll/
 * upload are deliberately NOT exposed here: those are agent-proposed actions and only ever reach
 * the domain through createRuntimeTurn's capability dispatch, so authorization, policy
 * classification, and confirmation stay on one path.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { readSessionCookie, type Cp2Store } from "../../store.js";
import { sendCp2Error } from "../../route-helpers.js";

interface BusinessParams {
  businessId: string;
}

interface SessionParams extends BusinessParams {
  sessionId: string;
}

interface ApprovalParams extends BusinessParams {
  approvalId: string;
}

interface SaveProfileBody {
  label?: string;
  site?: string;
}

interface DisconnectProfileParams {
  profileId: string;
}

export function registerComputerRuntimeRoutes(app: FastifyInstance, store: Cp2Store): void {
  app.get(
    "/businesses/:businessId/computer/sessions/:sessionId",
    async (request: FastifyRequest<{ Params: SessionParams }>, reply) => {
      try {
        return store.getComputerSessionView(
          readSessionCookie(request.headers.cookie),
          request.params.businessId,
          request.params.sessionId
        );
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/computer/sessions/:sessionId/control/take",
    async (request: FastifyRequest<{ Params: SessionParams }>, reply) => {
      try {
        return store.takeComputerControl(
          readSessionCookie(request.headers.cookie),
          request.params.businessId,
          request.params.sessionId
        );
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/computer/sessions/:sessionId/control/release",
    async (request: FastifyRequest<{ Params: SessionParams }>, reply) => {
      try {
        return await store.releaseComputerControl(
          readSessionCookie(request.headers.cookie),
          request.params.businessId,
          request.params.sessionId
        );
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/computer/approvals/:approvalId/approve",
    async (request: FastifyRequest<{ Params: ApprovalParams }>, reply) => {
      try {
        return await store.decideComputerApproval(
          readSessionCookie(request.headers.cookie),
          request.params.businessId,
          request.params.approvalId,
          "approve"
        );
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/computer/approvals/:approvalId/reject",
    async (request: FastifyRequest<{ Params: ApprovalParams }>, reply) => {
      try {
        return await store.decideComputerApproval(
          readSessionCookie(request.headers.cookie),
          request.params.businessId,
          request.params.approvalId,
          "reject"
        );
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/computer/sessions/:sessionId/close",
    async (request: FastifyRequest<{ Params: SessionParams }>, reply) => {
      try {
        await store.closeComputerSession(
          readSessionCookie(request.headers.cookie),
          request.params.businessId,
          request.params.sessionId
        );
        return { closed: true };
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/computer/sessions/:sessionId/save-as-profile",
    async (request: FastifyRequest<{ Params: SessionParams; Body: SaveProfileBody }>, reply) => {
      try {
        const label = typeof request.body?.label === "string" ? request.body.label.trim() : "";
        const site = typeof request.body?.site === "string" ? request.body.site.trim() : "";
        if (label.length === 0 || site.length === 0) {
          return reply.code(400).send({
            error: {
              code: "COMPUTER_PROFILE_INPUT_INVALID",
              message: "label and site are required."
            }
          });
        }
        return await store.saveComputerSessionAsProfile(
          readSessionCookie(request.headers.cookie),
          request.params.businessId,
          request.params.sessionId,
          { label, site }
        );
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get("/computer/profiles", async (request, reply) => {
    try {
      return { profiles: store.listComputerProfiles(readSessionCookie(request.headers.cookie)) };
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.delete(
    "/computer/profiles/:profileId",
    async (request: FastifyRequest<{ Params: DisconnectProfileParams }>, reply) => {
      try {
        store.disconnectComputerProfile(
          readSessionCookie(request.headers.cookie),
          request.params.profileId
        );
        return { disconnected: true };
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );
}
