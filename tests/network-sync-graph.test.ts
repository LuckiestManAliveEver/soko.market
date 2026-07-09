import { describe, expect, it } from "vitest";
import { buildApi } from "../services/api/src/app";
import { createContactHash, createCp2Store } from "../services/api/src/cp2/store";
import type { AgentRouteSummary, NetworkGraphSummary } from "../packages/shared-types/src";

interface OtpRequestResponse {
  challengeId: string;
  devOtp: string;
}

interface CreateBusinessResponse {
  business: {
    id: string;
  };
}

describe("Network Sync Graph", () => {
  it("hashes contact identifiers deterministically without returning raw values", () => {
    expect(createContactHash("phone", "+254 700-000-301")).toBe(
      createContactHash("phone", "254700000301")
    );
    expect(createContactHash("email", "OWNER@EXAMPLE.COM")).toBe(
      createContactHash("email", "owner@example.com")
    );
    expect(createContactHash("phone", "+254700000301")).not.toContain("+254700000301");
  });

  it("creates direct phone and social networks, extended agent-mediated nodes, and routes", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });
    const { sessionCookie } = await createOwnerBusiness(app, "254700000302");

    const phoneGraph = await postJson<NetworkGraphSummary>(
      app,
      "/network/sync/contacts",
      {
        contacts: [
          {
            name: "Jane Supplier",
            phone: "+254700000303",
            connections: [
              {
                name: "Dairy Supplier",
                phone: "+254700000304"
              }
            ]
          }
        ]
      },
      sessionCookie
    );

    expect(phoneGraph.sources[0]).toMatchObject({
      sourceType: "phone_contact",
      directCount: 1,
      extendedCount: 1
    });
    expect(phoneGraph.nodes.find((node) => node.displayName === "Jane Supplier")).toMatchObject({
      degree: 1,
      visibilityStatus: "direct"
    });
    expect(phoneGraph.nodes.find((node) => node.displayName === "Dairy Supplier")).toMatchObject({
      degree: 2,
      visibilityStatus: "agent_mediated",
      consentStatus: "agent_required",
      contactHashIds: []
    });

    const socialGraph = await postJson<NetworkGraphSummary>(
      app,
      "/network/sync/social/instagram",
      {
        profiles: [
          {
            name: "Market Connector",
            handle: "@market",
            relationship: "interaction",
            connections: [
              {
                name: "Egg Shop",
                handle: "@eggs"
              }
            ]
          }
        ]
      },
      sessionCookie
    );

    expect(socialGraph.sources.map((source) => source.sourcePlatform)).toEqual([
      "phone",
      "instagram"
    ]);
    expect(socialGraph.edges.map((edge) => edge.sourceType)).toEqual(
      expect.arrayContaining(["phone_contact", "social_interaction", "agent_route"])
    );

    const direct = await getJson<{ nodes: NetworkGraphSummary["nodes"] }>(
      app,
      "/network/direct",
      sessionCookie
    );
    const extended = await getJson<{ nodes: NetworkGraphSummary["nodes"] }>(
      app,
      "/network/extended",
      sessionCookie
    );
    expect(direct.nodes.map((node) => node.degree)).toEqual([1, 1]);
    expect(extended.nodes.map((node) => node.displayName)).toEqual(["Dairy Supplier", "Egg Shop"]);
    expect(JSON.stringify(extended)).not.toContain("+254700000304");

    const target = extended.nodes.find((node) => node.displayName === "Dairy Supplier");
    const route = await postJson<AgentRouteSummary>(
      app,
      "/network/routes",
      {
        requestText: "Find suppliers through my network",
        targetNodeId: target?.id
      },
      sessionCookie
    );
    expect(route).toMatchObject({
      status: "pending_permission",
      path: ["You", "Jane Supplier", "Jane Supplier's Agent", "Dairy Supplier"]
    });

    const approved = await postJson<AgentRouteSummary>(
      app,
      `/network/routes/${route.id}/approve`,
      {},
      sessionCookie
    );
    expect(approved.status).toBe("approved");

    const rejected = await postJson<AgentRouteSummary>(
      app,
      `/network/routes/${route.id}/reject`,
      {},
      sessionCookie
    );
    expect(rejected.status).toBe("rejected");

    await app.close();
  });

  it("deletes imported nodes and routes when a sync source is disconnected", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });
    const { sessionCookie } = await createOwnerBusiness(app, "254700000305");
    const graph = await postJson<NetworkGraphSummary>(
      app,
      "/network/sync/contacts",
      {
        contacts: [
          {
            name: "Jane",
            phone: "+254700000306",
            connections: [{ name: "Supplier" }]
          }
        ]
      },
      sessionCookie
    );
    const sourceId = graph.sources[0]?.id;
    expect(sourceId).toBeTruthy();
    await postJson<AgentRouteSummary>(
      app,
      "/network/routes",
      {
        requestText: "Ask Jane's network for Supplier"
      },
      sessionCookie
    );

    const deleted = await app.inject({
      method: "DELETE",
      url: `/network/sources/${sourceId}`,
      headers: {
        cookie: sessionCookie
      }
    });

    expect(deleted.statusCode).toBe(200);
    const deletedGraph = deleted.json<NetworkGraphSummary>();
    expect(deletedGraph.nodes.filter((node) => node.degree > 0)).toHaveLength(0);
    expect(deletedGraph.edges).toHaveLength(0);
    expect(deletedGraph.routes).toHaveLength(0);
    expect(deletedGraph.sources[0]).toMatchObject({
      status: "disconnected",
      disconnectedAt: expect.any(String)
    });

    await app.close();
  });

  it("keeps provider graph synchronization explicit until OAuth import is implemented", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });
    const { sessionCookie } = await createOwnerBusiness(app, "254700000307");

    const response = await app.inject({
      method: "POST",
      url: "/network/providers/google/sync",
      headers: {
        ...jsonHeaders(),
        cookie: sessionCookie
      },
      payload: JSON.stringify({})
    });

    expect(response.statusCode).toBe(501);
    expect(response.json()).toMatchObject({
      code: "network_provider_sync_not_implemented"
    });

    await app.close();
  });
});

async function createOwnerBusiness(
  app: ReturnType<typeof buildApi>,
  destination: string
): Promise<CreateBusinessResponse & { sessionCookie: string }> {
  const otpResponse = await postJson<OtpRequestResponse>(app, "/auth/otp/request", {
    channel: "phone",
    destination
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
  const business = await postJson<CreateBusinessResponse>(
    app,
    "/businesses",
    {
      name: "Network Shop",
      language: "en"
    },
    sessionCookie
  );

  return {
    ...business,
    sessionCookie
  };
}

async function getJson<TResponse>(
  app: ReturnType<typeof buildApi>,
  url: string,
  cookie?: string
): Promise<TResponse> {
  const response = await app.inject({
    method: "GET",
    url,
    headers: cookie === undefined ? {} : { cookie }
  });

  expect(response.statusCode).toBeGreaterThanOrEqual(200);
  expect(response.statusCode).toBeLessThan(300);
  return response.json<TResponse>();
}

async function postJson<TResponse>(
  app: ReturnType<typeof buildApi>,
  url: string,
  payload: unknown,
  cookie?: string
): Promise<TResponse> {
  const response = await app.inject({
    method: "POST",
    url,
    headers: {
      ...jsonHeaders(),
      ...(cookie === undefined ? {} : { cookie })
    },
    payload: JSON.stringify(payload)
  });

  expect(response.statusCode).toBeGreaterThanOrEqual(200);
  expect(response.statusCode).toBeLessThan(300);
  return response.json<TResponse>();
}

function jsonHeaders() {
  return {
    "content-type": "application/json"
  };
}

function extractSessionCookie(header: string | string[] | undefined): string {
  const raw = Array.isArray(header) ? header[0] : header;

  if (raw === undefined) {
    throw new Error("Missing session cookie");
  }

  return raw.split(";")[0] ?? raw;
}
