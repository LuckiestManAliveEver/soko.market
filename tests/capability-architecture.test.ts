import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("capability-first architecture", () => {
  it("keeps Chat free of conventional business-form setters", () => {
    const chat = readFileSync("apps/web/src/hooks/useChatRuntimeState.ts", "utf8");
    for (const setter of [
      "setProductForm",
      "setCustomerForm",
      "setInvoiceForm",
      "setInvoicePreview",
      "setPaymentForm",
      "requestNetworkRoute",
      "loadNetworkGraph",
      "isNetworkDiscoveryRequest"
    ]) {
      expect(chat).not.toContain(setter);
    }
    expect(chat).toContain("/runtime/turns");
    expect(chat).not.toContain("createLocalParserReply");
    expect(chat).not.toContain("createAgentRuntimeDecision");
    expect(chat).not.toContain("createSupplierChatReply");
    expect(chat).not.toMatch(/\bproducts:\s*ProductSummary\[\]/u);
    expect(chat).not.toMatch(/\bcustomers:\s*CustomerSummary\[\]/u);
    expect(chat).not.toMatch(/\bsuppliers:\s*SupplierBusinessCardSummary\[\]/u);
  });

  it("has one registry composition root and one runtime-turn implementation", () => {
    const registry = readFileSync("packages/tool-core/src/registry/index.ts", "utf8");
    const toolBarrel = readFileSync("packages/tool-core/src/index.ts", "utf8");
    const runtime = readFileSync("services/api/src/cp2/domains/agent-runtime/store.ts", "utf8");
    expect(registry.match(/export const runtimeToolRegistry/g)).toHaveLength(1);
    expect(toolBarrel.split("\n").filter(Boolean)).toHaveLength(1);
    expect(runtime.match(/async createRuntimeTurn\(/g)).toHaveLength(1);
  });

  it("keeps MCP on the canonical runtime turn and passes all static boundaries", () => {
    const mcp = readFileSync("services/api/src/mcp/routes.ts", "utf8");
    const boundaries = readFileSync("scripts/check-boundaries.mjs", "utf8");
    expect(mcp).toContain("store.createRuntimeTurn({");
    expect(mcp).not.toMatch(/\.(?:createProduct|updateProduct|deleteProduct|createCustomer)\(/u);
    expect(boundaries).toContain("expected one createRuntimeTurn implementation");
    expect(boundaries).toContain("expected one runtimeToolRegistry");
    expect(boundaries).toContain("MCP bypasses the canonical runtime turn");
    expect(boundaries).toContain("new deep import of sibling domain private internals");
    expect(boundaries).not.toContain("allowedPrivateDomainImports");
  });
});
