/**
 * Corridor fulfillment over MCP (services/api/src/mcp/fulfillment-tools.ts), gate lane: no
 * database. Proves the MCP surface is complete (every public fulfillment operation the HTTP API
 * exposes has a tool, derived from the source, so a new route without a tool fails here), and
 * that the gateway enforces scopes, shop binding, idempotency keys, strict arguments and the A22
 * gram wire format before anything reaches the fulfillment service.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildApi } from "../services/api/src/app";
import type { FulfillmentService } from "../services/api/src/cp2/domains/fulfillment/service";
import {
  describeFulfillmentMcpTool,
  fulfillmentMcpTools
} from "../services/api/src/mcp/fulfillment-tools";
import { validateCorridorGeometry, validateVehicleInput } from "../packages/business-core/src";
import { connectMcp, createOwner, type TestApp } from "./fixtures/fulfillment-test-helpers";

const routesSource = readFileSync("services/api/src/cp2/domains/fulfillment/routes.ts", "utf8");
const toolsSource = readFileSync("services/api/src/mcp/fulfillment-tools.ts", "utf8");

const calledMethods = (source: string, receiver: string) =>
  new Set([...source.matchAll(new RegExp(`\\b${receiver}\\.(\\w+)\\(`, "gu"))].map((m) => m[1]));

/** A fulfillment service double that records every call and echoes a marker result. */
function recordingService() {
  const calls: Array<{ method: string; input: Record<string, unknown> }> = [];
  const service = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "available") return true;
        if (typeof property !== "string" || property === "then") return undefined;
        return async (input: Record<string, unknown>) => {
          calls.push({ method: property, input });
          return { method: property };
        };
      }
    }
  ) as unknown as FulfillmentService;
  return { service, calls };
}

async function setup() {
  const { service, calls } = recordingService();
  const app: TestApp = buildApi({ cp2: { fulfillmentService: service } });
  const owner = await createOwner(app, "MCP Setup Wholesale");
  return { app, owner, calls };
}

describe("fulfillment MCP tools", () => {
  it("covers every public fulfillment operation the HTTP API exposes", () => {
    const httpService = calledMethods(routesSource, "fulfillment");
    const httpStore = calledMethods(routesSource, "store");
    const mcpService = calledMethods(toolsSource, "service");
    const mcpStore = calledMethods(toolsSource, "store");
    expect(httpService.size).toBeGreaterThan(30);
    expect([...httpService].filter((method) => !mcpService.has(method))).toEqual([]);
    expect([...httpStore].filter((method) => !mcpStore.has(method))).toEqual([]);
    // And MCP reaches nothing the HTTP API does not: one public surface, two transports.
    expect([...mcpService].filter((method) => !httpService.has(method))).toEqual([]);
    expect([...mcpStore].filter((method) => !httpStore.has(method))).toEqual([]);
  });

  it("declares unique names, and requires an idempotency key exactly where it is honoured", () => {
    const names = fulfillmentMcpTools.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of fulfillmentMcpTools) {
      expect(tool.name).toMatch(/^fulfillment\.[a-z_]+$/u);
      const descriptor = describeFulfillmentMcpTool(tool, []) as {
        inputSchema: { required: string[]; properties: Record<string, unknown> };
        annotations: { readOnlyHint: boolean };
      };
      expect(descriptor.inputSchema.required).toContain("shopId");
      for (const field of tool.required)
        expect(descriptor.inputSchema.properties).toHaveProperty(field);
      const mutation = tool.scope === "mcp:act";
      expect(tool.retry !== undefined).toBe(mutation);
      expect(descriptor.inputSchema.required.includes("idempotencyKey")).toBe(
        tool.retry === "replay"
      );
      expect(descriptor.annotations.readOnlyHint).toBe(!mutation);
    }
  });

  it("claims replay only for operations the service really runs through an idempotency record", () => {
    // Derived from source, so a tool can never promise a replay its service does not perform,
    // and an operation that gains an idempotency record cannot be left described as unkeyed.
    const domainSource = [
      "services/api/src/cp2/domains/fulfillment/service.ts",
      "services/api/src/cp2/domains/fulfillment/corridors.ts",
      "services/api/src/cp2/domains/fulfillment/dispatch.ts"
    ]
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    const bodyFrom = (start: number) => {
      const next = domainSource.indexOf("\n    async ", start + 1);
      return domainSource.slice(start, next === -1 ? undefined : next);
    };
    const methodBody = (method: string): string => {
      const direct = domainSource.indexOf(`    async ${method}(actor`);
      if (direct > -1) return bodyFrom(direct);
      // `method: (actor) => helper(actor, ...)` delegates: judge the helper it calls.
      const delegate = new RegExp(`\\n    ${method}: \\(actor\\) =>\\s*(\\w+)\\(`, "u").exec(
        domainSource
      );
      expect(delegate, method).not.toBeNull();
      const helper = domainSource.search(new RegExp(`function ${delegate?.[1]}\\(`, "u"));
      expect(helper, delegate?.[1]).toBeGreaterThan(-1);
      return domainSource.slice(helper, domainSource.indexOf("\n  }\n", helper));
    };
    const blocks = toolsSource.split('    name: "fulfillment.').slice(1);
    for (const tool of fulfillmentMcpTools.filter((entry) => entry.scope === "mcp:act")) {
      const block = blocks.find((entry) => entry.startsWith(`${tool.name.slice(12)}"`));
      const method = block?.match(/\bservice\.(\w+)\(/u)?.[1];
      if (method === undefined) {
        // The one store-backed mutation (timezone) cannot share the idempotency transaction.
        expect(tool.retry, tool.name).toBe("absolute");
        continue;
      }
      expect(methodBody(method).includes("idempotent("), tool.name).toBe(tool.retry === "replay");
    }
  });

  it("keeps schema limits in step with the domain validators", () => {
    const schema = (name: string) =>
      (
        describeFulfillmentMcpTool(
          fulfillmentMcpTools.find((tool) => tool.name === name)!,
          []
        ) as { inputSchema: { properties: Record<string, { maxLength?: number }> } }
      ).inputSchema.properties;
    const vehicle = (registration: string, name = "Truck") =>
      validateVehicleInput({ name, registration, capacityGrams: 1n, active: true }).ok;
    const registrationMax = schema("fulfillment.create_vehicle").registration?.maxLength ?? 0;
    expect(vehicle("R".repeat(registrationMax))).toBe(true);
    expect(vehicle("R".repeat(registrationMax + 1))).toBe(false);
    const nameMax = schema("fulfillment.create_vehicle").name?.maxLength ?? 0;
    expect(vehicle("R", "N".repeat(nameMax))).toBe(true);
    expect(vehicle("R", "N".repeat(nameMax + 1))).toBe(false);
    expect(schema("fulfillment.update_vehicle").registration?.maxLength).toBe(registrationMax);
    expect(schema("fulfillment.create_corridor").name?.maxLength).toBe(80);
    expect(schema("fulfillment.create_corridor").originLabel?.maxLength).toBe(120);
    const corridorSchema = schema("fulfillment.create_corridor") as unknown as {
      priority: { maximum: number };
      routeGeometry: { properties: { coordinates: { maxItems: number } } };
    };
    expect(corridorSchema.priority.maximum).toBe(1_000_000);
    const maxPoints = corridorSchema.routeGeometry.properties.coordinates.maxItems;
    const line = (points: number) => ({
      type: "LineString",
      coordinates: Array.from({ length: points }, (_, index) => [36.8, -1.3 + index * 0.0001])
    });
    expect(validateCorridorGeometry(line(maxPoints)).ok).toBe(true);
    expect(validateCorridorGeometry(line(maxPoints + 1)).ok).toBe(false);
  });

  it("lists read tools to read tokens and mutations only to act tokens", async () => {
    const { app, owner } = await setup();
    const reader = await connectMcp(app, owner.cookie, owner.businessId, ["mcp:read"]);
    const readNames = (await reader.list()).map((tool) => tool.name);
    const expectedRead = fulfillmentMcpTools.filter((tool) => tool.scope === "mcp:read");
    expect(readNames).toEqual(expect.arrayContaining(expectedRead.map((tool) => tool.name)));
    expect(readNames.filter((name) => name.startsWith("fulfillment.")).length).toBe(
      expectedRead.length
    );
    const refused = await reader.call("fulfillment.create_vehicle", {
      name: "Truck",
      capacityGrams: "7000000",
      idempotencyKey: "k1"
    });
    expect(refused).toMatchObject({
      isError: true,
      structuredContent: { code: "mcp_scope_forbidden" }
    });

    const actor = await connectMcp(app, owner.cookie, owner.businessId);
    expect((await actor.list()).map((tool) => tool.name)).toEqual(
      expect.arrayContaining(fulfillmentMcpTools.map((tool) => tool.name))
    );
    await app.close();
  });

  it("passes parsed input to the service for the token's own business", async () => {
    const { app, owner, calls } = await setup();
    const mcp = await connectMcp(app, owner.cookie, owner.businessId);
    await mcp.ok("fulfillment.create_vehicle", {
      name: "7-tonne truck",
      capacityGrams: "7000000",
      idempotencyKey: "vehicle-1"
    });
    await mcp.ok("fulfillment.create_policy", {
      name: "Default",
      targetLoadGrams: "6000000",
      minimumDispatchLoadGrams: null,
      maxDiversionMeters: 2000,
      cutoffLocalTime: "18:00",
      maxWaitHours: 72,
      fulfillmentLeadDays: 1,
      makeBusinessDefault: true,
      idempotencyKey: "policy-1"
    });
    await mcp.ok("fulfillment.create_manifest", {
      corridorId: "11111111-1111-4111-8111-111111111111",
      vehicleId: "22222222-2222-4222-8222-222222222222",
      orderIds: ["33333333-3333-4333-8333-333333333333"],
      idempotencyKey: "manifest-1"
    });
    await mcp.ok("fulfillment.list_manifests", { status: "OPEN" });
    await mcp.ok("fulfillment.revise_policy", {
      policyId: "44444444-4444-4444-8444-444444444444",
      name: "Default",
      targetLoadGrams: "6000000",
      maxDiversionMeters: 2000,
      cutoffLocalTime: "18:00",
      maxWaitHours: 72,
      fulfillmentLeadDays: 1,
      expectedVersion: 2,
      expectedDefaultPolicyId: "44444444-4444-4444-8444-44444444ABCD",
      idempotencyKey: "revise-1"
    });
    expect(calls.map((call) => call.method)).toEqual([
      "createVehicle",
      "createDispatchPolicy",
      "createManifest",
      "listManifests",
      "reviseDispatchPolicy"
    ]);
    // Ids compare case-insensitively: the precondition is normalized before it reaches the lock.
    expect(calls[4]?.input).toMatchObject({
      expectedVersion: 2,
      expectedDefaultPolicyId: "44444444-4444-4444-8444-44444444abcd"
    });
    expect(calls[0]?.input).toMatchObject({
      sessionId: null,
      businessId: owner.businessId,
      idempotencyKey: "vehicle-1",
      vehicle: { name: "7-tonne truck", capacityGrams: 7_000_000n, active: true }
    });
    expect(calls[1]?.input).toMatchObject({
      makeBusinessDefault: true,
      policy: { targetLoadGrams: 6_000_000n, minimumDispatchLoadGrams: null }
    });
    expect(calls[2]?.input).toMatchObject({
      orderIds: ["33333333-3333-4333-8333-333333333333"],
      plannedDepartureAt: null
    });
    expect(calls[3]?.input).toMatchObject({ status: "OPEN", idempotencyKey: null });
    await app.close();
  });

  it("rejects bad input before it reaches the service", async () => {
    const { app, owner, calls } = await setup();
    const mcp = await connectMcp(app, owner.cookie, owner.businessId);
    const cases: Array<[string, Record<string, unknown>, string]> = [
      // Mutations without an idempotency key.
      ["fulfillment.create_vehicle", { name: "T", capacityGrams: "1" }, "idempotencyKey_required"],
      ["fulfillment.update_vehicle", { vehicleId: "v", active: false }, "idempotencyKey_required"],
      // A22: grams are whole decimal strings only - never a JSON number or a fraction.
      [
        "fulfillment.create_vehicle",
        { name: "Truck", capacityGrams: 7000000, idempotencyKey: "k" },
        "grams_invalid"
      ],
      [
        "fulfillment.create_vehicle",
        { name: "Truck", capacityGrams: "7000.5", idempotencyKey: "k" },
        "grams_invalid"
      ],
      // A misspelled field fails loudly instead of being ignored.
      ["fulfillment.list_pools", { corridor: "x" }, "mcp_input_invalid"],
      [
        "fulfillment.create_policy",
        {
          name: "P",
          targetLoadGrams: "1",
          maxDiversionMeters: 1,
          cutoffLocalTime: "18:00",
          maxWaitHours: 1,
          fulfillmentLeadDays: 0,
          expectedDefaultPolicyId: "not-a-uuid",
          idempotencyKey: "k"
        },
        "expected_default_policy_invalid"
      ],
      // An absolute write takes no key rather than silently ignoring one.
      [
        "fulfillment.update_settings",
        { timezone: "Africa/Nairobi", idempotencyKey: "k" },
        "mcp_input_invalid"
      ],
      ["fulfillment.list_manifests", { status: "LOST" }, "manifest_status_invalid"],
      [
        "fulfillment.record_delivery",
        { manifestId: "m", stopId: "s", outcome: "STOLEN", idempotencyKey: "k" },
        "delivery_outcome_invalid"
      ],
      [
        "fulfillment.decide_dispatch_approval",
        { approvalId: "a", decision: "MAYBE", reason: "r", idempotencyKey: "k" },
        "approval_decision_invalid"
      ],
      [
        "fulfillment.update_corridor",
        { corridorId: "c", routeGeometry: {}, idempotencyKey: "k" },
        "mcp_input_invalid"
      ]
    ];
    for (const [name, args, code] of cases) {
      const result = await mcp.call(name, args);
      expect(result, name).toMatchObject({ isError: true, structuredContent: { code } });
    }
    expect(calls).toEqual([]);
    await app.close();
  });

  it("validates HTTP input with the same shared parsers", async () => {
    const { app, owner, calls } = await setup();
    const http = (method: "GET" | "PATCH", url: string, payload?: unknown) =>
      app.inject({
        method,
        url: `/businesses/${owner.businessId}/fulfillment/${url}`,
        headers: {
          cookie: owner.cookie,
          ...(payload === undefined ? {} : { "content-type": "application/json" })
        },
        ...(payload === undefined ? {} : { payload: JSON.stringify(payload) })
      });
    // An unknown approval status is a 400, not an empty list that looks like "no approvals".
    const approvals = await http("GET", "dispatch-approvals?status=FOO");
    expect(approvals.statusCode).toBe(400);
    expect(approvals.json()).toMatchObject({ code: "approval_status_invalid" });
    const geometry = await http("PATCH", "corridors/c1", { routeGeometry: {} });
    expect(geometry.statusCode).toBe(400);
    expect(geometry.json()).toMatchObject({ code: "corridor_geometry_separate" });
    expect(geometry.json().message).toContain("PUT .../geometry");
    const grams = await http("PATCH", "vehicles/v1", { capacityGrams: "7000.5" });
    expect(grams.json()).toMatchObject({
      code: "grams_invalid",
      details: { field: "capacityGrams" }
    });
    expect(calls).toEqual([]);
    await app.close();
  });

  it("never lets a token act on a business it is not bound to", async () => {
    const { app, owner, calls } = await setup();
    const other = await createOwner(app, "Someone Else Wholesale");
    const mcp = await connectMcp(app, owner.cookie, owner.businessId);
    const result = await mcp.call("fulfillment.list_pools", { shopId: other.businessId });
    expect(result).toMatchObject({
      isError: true,
      structuredContent: { code: "mcp_shop_forbidden" }
    });
    expect(calls).toEqual([]);
    await app.close();
  });
});
