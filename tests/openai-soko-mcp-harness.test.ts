import { describe, expect, it } from "vitest";
// @ts-expect-error The live harness is intentionally a directly executable MJS module.
import {
  assertNoSecretLeak,
  catalogueProducts,
  discoveredToolNames,
  invalidMcpUrl,
  loadHarnessConfig,
  makeMcpTool,
  makeRedactor,
  parseModelJson,
  replaceShopId,
  responseText,
  runtimeState
} from "../scripts/openai-soko-mcp-harness.mjs";

const baseEnv = {
  OPENAI_API_KEY: "openai-test-secret",
  SOKO_MCP_SERVER_URL: "https://api.soko.market/mcp?shopId=shop-one",
  SOKO_MCP_TOKEN: "soko-test-secret",
  SOKO_SHOP_ID: "shop-one"
};

describe("OpenAI Soko MCP live harness helpers", () => {
  it("refuses missing credentials and mismatched shop bindings without echoing secrets", () => {
    expect(() => loadHarnessConfig({})).toThrow(/OPENAI_API_KEY.*SOKO_MCP_SERVER_URL/u);
    expect(() => loadHarnessConfig({ ...baseEnv, SOKO_SHOP_ID: "shop-two" })).toThrow(
      /matching SOKO_SHOP_ID/u
    );
  });

  it("uses the repository OpenAI fast-model default and always requires approval", () => {
    const config = loadHarnessConfig(baseEnv);
    expect(config.model).toBe("gpt-5-mini");
    expect(makeMcpTool(config)).toMatchObject({
      type: "mcp",
      server_label: "soko_shop",
      authorization: "soko-test-secret",
      require_approval: "always"
    });
  });

  it("extracts discovered tools, output text, catalogue envelopes, and runtime state", () => {
    const response = {
      output: [
        {
          type: "mcp_list_tools",
          tools: [{ name: "soko.query_catalogue" }, { name: "soko.list_shops" }]
        },
        { type: "message", content: [{ type: "output_text", text: "done" }] }
      ]
    };
    expect(discoveredToolNames(response)).toEqual(["soko.list_shops", "soko.query_catalogue"]);
    expect(responseText(response)).toBe("done");

    const catalogue = catalogueProducts({
      type: "mcp_call",
      name: "soko.query_catalogue",
      status: "completed",
      output: JSON.stringify({
        content: [{ type: "text", text: '{"products":[]}' }],
        structuredContent: { products: [] },
        isError: false
      })
    });
    expect(catalogue).toMatchObject({
      parsed: { hasContent: true, hasStructuredContent: true, isError: false },
      products: []
    });

    expect(
      runtimeState({
        type: "mcp_call",
        name: "soko.runtime_turn",
        status: "completed",
        output: JSON.stringify({
          structuredContent: {
            session: { id: "runtime-session" },
            turn: {
              status: "needs_confirmation",
              plan: { toolName: "product.update", confirmationToken: "confirmation" }
            }
          },
          isError: false
        })
      })
    ).toMatchObject({
      status: "needs_confirmation",
      runtimeSessionId: "runtime-session",
      confirmationToken: "confirmation",
      toolName: "product.update"
    });
  });

  it("parses fenced model JSON and derives isolated invalid URLs", () => {
    expect(parseModelJson('```json\n{"products":[]}\n```')).toEqual({ products: [] });
    expect(replaceShopId(baseEnv.SOKO_MCP_SERVER_URL, "foreign-shop")).toContain(
      "shopId=foreign-shop"
    );
    expect(invalidMcpUrl(baseEnv.SOKO_MCP_SERVER_URL)).toContain(
      "/mcp/__openai_mcp_verification_missing__"
    );
  });

  it("redacts exact secrets, Soko token shapes, and Authorization headers", () => {
    const redact = makeRedactor(["openai-test-secret", "soko_mcp_live_abc123"]);
    const output = redact(
      "openai-test-secret soko_mcp_live_abc123 Authorization: Bearer visible-token"
    );
    expect(output).not.toContain("openai-test-secret");
    expect(output).not.toContain("live_abc123");
    expect(output).not.toContain("visible-token");
    expect(() => assertNoSecretLeak(output, ["openai-test-secret"])).not.toThrow();
    expect(() => assertNoSecretLeak("leaked openai-test-secret", ["openai-test-secret"])).toThrow(
      /configured secret/u
    );
  });
});
