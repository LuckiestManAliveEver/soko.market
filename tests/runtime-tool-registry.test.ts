import { describe, expect, it } from "vitest";
import {
  mcpSchemaForRuntimeTool,
  runtimeToolRegistry,
  type RuntimeToolName
} from "../packages/tool-core/src";

const allToolNames = Object.keys(runtimeToolRegistry) as RuntimeToolName[];

describe("runtime tool registry", () => {
  it("gives every tool a non-empty description usable for documentation and MCP exposure", () => {
    expect(allToolNames.length).toBeGreaterThan(0);
    for (const name of allToolNames) {
      const definition = runtimeToolRegistry[name];
      expect(definition.name).toBe(name);
      expect(definition.description.trim().length).toBeGreaterThan(0);
    }
  });

  it("gives every tool a well-formed object input schema", () => {
    for (const name of allToolNames) {
      const schema = runtimeToolRegistry[name].inputSchema;
      expect(schema.type).toBe("object");
      expect(typeof schema.properties).toBe("object");
      for (const [field, fieldSchema] of Object.entries(schema.properties)) {
        expect(["string", "number", "boolean", "array", "object"]).toContain(fieldSchema.type);
        expect(fieldSchema.description.trim().length, `${name}.${field} description`).toBeGreaterThan(
          0
        );
      }
    }
  });

  it("declares no tool MCP-exposable yet, matching the current MCP surface exactly", () => {
    // services/api/src/mcp/routes.ts does not call any of these RuntimeToolName tools directly -
    // it only exposes a separately curated read-only set plus the generic
    // soko.runtime_turn/soko.confirm_runtime_action pair, which route natural-language messages
    // through this same registry rather than naming a tool directly. If this test starts failing
    // because an entry flipped to true, that is a deliberate MCP-surface expansion that needs its
    // own review (adjusting mcp/routes.ts to actually call mcpSchemaForRuntimeTool for it), not an
    // accidental default.
    for (const name of allToolNames) {
      expect(runtimeToolRegistry[name].mcpExposable, name).toBe(false);
    }
  });

  it("never marks a read-only tool as requiring confirmation", () => {
    for (const name of allToolNames) {
      const definition = runtimeToolRegistry[name];
      if (definition.readOnly) {
        expect(definition.requiresConfirmation, name).toBe(false);
      }
    }
  });

  it("always requires confirmation for a critical-risk tool", () => {
    for (const name of allToolNames) {
      const definition = runtimeToolRegistry[name];
      if (definition.risk === "critical") {
        expect(definition.requiresConfirmation, name).toBe(true);
      }
    }
  });

  it("gives every tool a non-empty required permission", () => {
    for (const name of allToolNames) {
      expect(runtimeToolRegistry[name].requiredPermission.trim().length).toBeGreaterThan(0);
    }
  });

  it("adapts a canonical tool definition into a valid MCP tools/list entry shape", () => {
    const schema = mcpSchemaForRuntimeTool("product.create");
    expect(schema.name).toBe("soko.product.create");
    expect(schema.description).toBe(runtimeToolRegistry["product.create"].description);
    expect(schema.inputSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: expect.arrayContaining(["name", "unit"]),
      properties: {
        name: { type: "string" },
        unit: { type: "string" },
        quantity: { type: "number" }
      }
    });
    expect(schema.annotations).toEqual({ readOnlyHint: false, destructiveHint: false });
  });

  it("marks the MCP annotation destructiveHint only for critical-risk tools", () => {
    const critical = mcpSchemaForRuntimeTool("product.delete");
    expect(critical.annotations.destructiveHint).toBe(true);
    const readOnly = mcpSchemaForRuntimeTool("products.list");
    expect(readOnly.annotations).toEqual({ readOnlyHint: true, destructiveHint: false });
  });

  it("omits a required array from the MCP schema when no field is required", () => {
    const schema = mcpSchemaForRuntimeTool("invoices.list");
    expect(schema.inputSchema).not.toHaveProperty("required");
  });
});
