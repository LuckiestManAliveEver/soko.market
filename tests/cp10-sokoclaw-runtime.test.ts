import { describe, expect, it } from "vitest";
import {
  createRuntimeToolProposal,
  parseMerchantCommand,
  runtimeToolRegistry
} from "../packages/tool-core/src";
import { buildApi } from "../services/api/src/app";
import { createCp2Store } from "../services/api/src/cp2/store";
import { cp10RuntimeEvalCommands } from "./ai-eval/cp10-runtime-commands";

interface OtpRequestResponse {
  challengeId: string;
  devOtp: string;
}

interface VerifyOtpResponse {
  session: {
    id: string;
  };
}

interface CreateBusinessResponse {
  business: {
    id: string;
  };
}

interface ProductResponse {
  id: string;
  name: string;
  quantity: number;
}

interface RuntimeTurnResponse {
  session: {
    id: string;
    turnCount: number;
  };
  turn: {
    status: "completed" | "needs_confirmation" | "clarifying" | "blocked" | "rate_limited";
    parserIntent: string;
    context: {
      businessId: string;
      productCount: number;
    };
    plan: {
      toolName: string;
      risk: string;
      requiresConfirmation: boolean;
      confirmationToken: string | null;
      executedAt: string | null;
    };
    verification: {
      ok: boolean;
      requiresConfirmation: boolean;
      confirmationSatisfied: boolean;
      roleAllowed: boolean;
    };
    response: string;
    toolResult: unknown;
    telemetry: Array<{
      state: string;
      metadata: Record<string, unknown>;
    }>;
  };
}

describe("CP10 Sokoclaw runtime", () => {
  it("keeps a runtime evaluation set mapped to tool proposals and confirmation rules", () => {
    expect(cp10RuntimeEvalCommands.length).toBeGreaterThanOrEqual(12);

    for (const command of cp10RuntimeEvalCommands) {
      const proposal = createRuntimeToolProposal(parseMerchantCommand(command.text));
      const definition = runtimeToolRegistry[proposal.toolName];

      expect(proposal.toolName).toBe(command.expectedTool);
      expect(definition.requiresConfirmation).toBe(command.expectedRequiresConfirmation);
    }
  });

  it("executes safe read tools through a business-scoped runtime turn", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });
    const { businessId, sessionCookie } = await createOwnerBusiness(app);
    await postJson<ProductResponse>(
      app,
      `/businesses/${businessId}/products`,
      {
        name: "Sugar",
        unit: "kg",
        quantity: 4
      },
      sessionCookie
    );

    const turn = await postJson<RuntimeTurnResponse>(
      app,
      `/businesses/${businessId}/runtime/turns`,
      {
        message: "show products"
      },
      sessionCookie
    );

    expect(turn.turn).toMatchObject({
      status: "completed",
      parserIntent: "show_products",
      plan: {
        toolName: "products.list",
        risk: "low",
        requiresConfirmation: false,
        confirmationToken: null
      },
      verification: {
        ok: true,
        requiresConfirmation: false,
        confirmationSatisfied: false,
        roleAllowed: true
      }
    });
    expect(turn.turn.context).toMatchObject({
      businessId,
      productCount: 1
    });
    expect(turn.turn.toolResult).toEqual([
      expect.objectContaining({
        name: "Sugar"
      })
    ]);
    expect(turn.turn.telemetry.map((event) => event.state)).toEqual(
      expect.arrayContaining([
        "turn.received",
        "context.built",
        "intent.routed",
        "plan.created",
        "verification.completed",
        "tool.executed",
        "response.generated"
      ])
    );
    const runtimeEvent = store
      .snapshot()
      .auditEvents.find((event) => event.type === "runtime.turn_recorded");
    expect(JSON.stringify(runtimeEvent?.payload)).not.toContain("show products");

    await app.close();
  });

  it("requires confirmation before high-risk runtime tools can mutate records", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });
    const { businessId, sessionCookie } = await createOwnerBusiness(app);

    const proposed = await postJson<RuntimeTurnResponse>(
      app,
      `/businesses/${businessId}/runtime/turns`,
      {
        message: "add product sugar"
      },
      sessionCookie
    );

    expect(proposed.turn).toMatchObject({
      status: "needs_confirmation",
      parserIntent: "add_product",
      plan: {
        toolName: "product.create",
        risk: "high",
        requiresConfirmation: true,
        executedAt: null
      },
      verification: {
        ok: false,
        requiresConfirmation: true,
        confirmationSatisfied: false
      }
    });
    expect(proposed.turn.plan.confirmationToken).toBeTruthy();
    expect(store.snapshot().products).toHaveLength(0);

    const confirmed = await postJson<RuntimeTurnResponse>(
      app,
      `/businesses/${businessId}/runtime/turns`,
      {
        runtimeSessionId: proposed.session.id,
        message: "confirm",
        confirmationToken: proposed.turn.plan.confirmationToken
      },
      sessionCookie
    );

    expect(confirmed.turn).toMatchObject({
      status: "completed",
      plan: {
        toolName: "product.create",
        risk: "high",
        requiresConfirmation: true
      },
      verification: {
        ok: true,
        confirmationSatisfied: true
      }
    });
    expect(confirmed.turn.plan.executedAt).toBeTruthy();
    expect(confirmed.turn.toolResult).toMatchObject({
      name: "Sugar",
      quantity: 0
    });
    expect(store.snapshot().products.map((product) => product.name)).toEqual(["Sugar"]);

    await app.close();
  });

  it("keeps incomplete runtime mutations as clarifications without writing payments", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });
    const { businessId, sessionCookie } = await createOwnerBusiness(app);

    const turn = await postJson<RuntimeTurnResponse>(
      app,
      `/businesses/${businessId}/runtime/turns`,
      {
        message: "record payment KES 500 from Mary"
      },
      sessionCookie
    );

    expect(turn.turn).toMatchObject({
      status: "clarifying",
      parserIntent: "record_payment",
      plan: {
        toolName: "payment.record",
        requiresConfirmation: true,
        confirmationToken: null
      }
    });
    expect(turn.turn.plan.executedAt).toBeNull();
    expect(store.snapshot().payments).toHaveLength(0);

    await app.close();
  });

  it("does not leak runtime context or read results across businesses", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });
    const { businessId: firstBusinessId, sessionCookie } = await createOwnerBusiness(app);
    const secondBusiness = await postJson<CreateBusinessResponse>(
      app,
      "/businesses",
      {
        name: "Second Shop",
        language: "en"
      },
      sessionCookie
    );
    await postJson<ProductResponse>(
      app,
      `/businesses/${firstBusinessId}/products`,
      {
        name: "Hidden Stock",
        unit: "unit",
        quantity: 2
      },
      sessionCookie
    );

    const turn = await postJson<RuntimeTurnResponse>(
      app,
      `/businesses/${secondBusiness.business.id}/runtime/turns`,
      {
        message: "show products"
      },
      sessionCookie
    );

    expect(turn.turn.context).toMatchObject({
      businessId: secondBusiness.business.id,
      productCount: 0
    });
    expect(turn.turn.toolResult).toEqual([]);

    await app.close();
  });

  it("lists runtime sessions and turns and rate-limits long-running sessions", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });
    const { businessId, sessionCookie } = await createOwnerBusiness(app);
    let runtimeSessionId: string | null = null;
    let finalTurn: RuntimeTurnResponse | null = null;

    for (let index = 0; index < 21; index += 1) {
      finalTurn = await postJson<RuntimeTurnResponse>(
        app,
        `/businesses/${businessId}/runtime/turns`,
        {
          ...(runtimeSessionId === null ? {} : { runtimeSessionId }),
          message: "show products"
        },
        sessionCookie
      );
      runtimeSessionId = finalTurn.session.id;
    }

    expect(finalTurn?.turn.status).toBe("rate_limited");
    expect(finalTurn?.turn.verification.rateLimited).toBe(true);

    const sessions = await getJson<Array<{ id: string; turnCount: number }>>(
      app,
      `/businesses/${businessId}/runtime/sessions`,
      sessionCookie
    );
    const turns = await getJson<Array<{ id: string; status: string }>>(
      app,
      `/businesses/${businessId}/runtime/sessions/${runtimeSessionId}/turns`,
      sessionCookie
    );

    expect(sessions).toEqual([
      expect.objectContaining({
        id: runtimeSessionId,
        turnCount: 21
      })
    ]);
    expect(turns).toHaveLength(21);
    expect(turns.at(-1)).toMatchObject({
      status: "rate_limited"
    });

    await app.close();
  });
});

async function createOwnerBusiness(app: ReturnType<typeof buildApi>) {
  const otpResponse = await postJson<OtpRequestResponse>(app, "/auth/otp/request", {
    channel: "phone",
    destination: "254700000009"
  });
  const verifyResponse = await app.inject({
    method: "POST",
    url: "/auth/otp/verify",
    headers: jsonHeaders(),
    payload: JSON.stringify({
      challengeId: otpResponse.challengeId,
      code: otpResponse.devOtp
    })
  });
  const sessionCookie = extractSessionCookie(verifyResponse.headers["set-cookie"]);
  const auth = verifyResponse.json<VerifyOtpResponse>();
  const business = await postJson<CreateBusinessResponse>(
    app,
    "/businesses",
    {
      name: "Jane's Shop",
      language: "en"
    },
    sessionCookie
  );

  expect(auth.session.id).toBeTruthy();

  return {
    businessId: business.business.id,
    sessionCookie
  };
}

async function postJson<TResponse>(
  app: ReturnType<typeof buildApi>,
  url: string,
  payload: Record<string, unknown>,
  cookie?: string
): Promise<TResponse> {
  const response = await app.inject({
    method: "POST",
    url,
    headers: cookie === undefined ? jsonHeaders() : { ...jsonHeaders(), cookie },
    payload: JSON.stringify(payload)
  });

  expect(response.statusCode).toBe(200);
  return response.json<TResponse>();
}

async function getJson<TResponse>(
  app: ReturnType<typeof buildApi>,
  url: string,
  cookie?: string
): Promise<TResponse> {
  const response = await app.inject({
    method: "GET",
    url,
    headers: cookie === undefined ? undefined : { cookie }
  });

  expect(response.statusCode).toBe(200);
  return response.json<TResponse>();
}

function jsonHeaders() {
  return {
    "content-type": "application/json"
  };
}

function extractSessionCookie(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  expect(value).toBeDefined();
  return value?.split(";")[0] ?? "";
}
