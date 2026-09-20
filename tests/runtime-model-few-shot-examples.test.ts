import { describe, expect, it } from "vitest";
import type { RuntimeToolName } from "../packages/shared-types/src";
import { renderRuntimeModelFewShotExamples } from "../packages/tool-core/src";
import { buildInferencePrompt } from "../services/api/src/inference/model-runtime";

describe("renderRuntimeModelFewShotExamples", () => {
  it("always includes the non-tool-gated clarification and response examples", () => {
    const rendered = renderRuntimeModelFewShotExamples([]);
    expect(rendered).toContain('"type":"clarification"');
    expect(rendered).toContain('"type":"response"');
    expect(rendered).not.toContain('"toolName":"products.list"');
    expect(rendered).not.toContain('"toolName":"product.create"');
    expect(rendered).not.toContain('"toolName":"customer.update"');
  });

  it("includes a tool-gated example only when that tool is in the allowed list", () => {
    const rendered = renderRuntimeModelFewShotExamples(["products.list"] as RuntimeToolName[]);
    expect(rendered).toContain('"toolName":"products.list"');
    expect(rendered).not.toContain('"toolName":"product.create"');
    expect(rendered).not.toContain('"toolName":"customer.update"');
  });

  it("includes every tool-gated example when every example tool is allowed", () => {
    const rendered = renderRuntimeModelFewShotExamples([
      "products.list",
      "product.create",
      "customer.update"
    ] as RuntimeToolName[]);
    expect(rendered).toContain('"toolName":"products.list"');
    expect(rendered).toContain('"toolName":"product.create"');
    expect(rendered).toContain('"toolName":"customer.update"');
  });

  it("every rendered example is itself valid JSON matching the real output contract", () => {
    const rendered = renderRuntimeModelFewShotExamples([
      "products.list",
      "product.create",
      "customer.update"
    ] as RuntimeToolName[]);
    const jsonLines = rendered
      .split("\n")
      .filter((line) => line.startsWith("You: "))
      .map((line) => line.slice("You: ".length));
    expect(jsonLines.length).toBeGreaterThanOrEqual(5);
    for (const line of jsonLines) {
      const parsed: unknown = JSON.parse(line);
      expect(parsed).toHaveProperty("type");
      expect(["tool", "clarification", "response"]).toContain((parsed as { type: string }).type);
    }
  });
});

describe("buildInferencePrompt few-shot wiring", () => {
  it("embeds the few-shot section in the assembled prompt string, after the output contract", () => {
    const prompt = buildInferencePrompt({
      message: "add sugar",
      allowedTools: ["products.list", "product.create"] as RuntimeToolName[],
      schemaVersion: "cp11-runtime-model-v1"
    });
    const contractIndex = prompt.indexOf("Allowed shapes:");
    const examplesIndex = prompt.indexOf("Worked examples of the exact output format");
    expect(contractIndex).toBeGreaterThan(-1);
    expect(examplesIndex).toBeGreaterThan(contractIndex);
    expect(prompt).toContain('"toolName":"product.create"');
  });

  it("renders a bounded model-template recipe into the inference prompt", () => {
    const prompt = buildInferencePrompt({
      message: "find rice",
      allowedTools: ["commerce.search"],
      schemaVersion: "cp11-runtime-model-v1",
      modelTemplate: {
        templateId: "product-search",
        templateVersionId: "version-7",
        version: "1.2.0",
        task: "commerce.search",
        allowedTools: ["commerce.search"],
        contextRequirements: ["catalogue"],
        outputSchema: { type: "object" },
        constraints: { maxResults: 5 },
        templateVocabularySnapshot: "sha256:template",
        currentVocabularySnapshot: "sha256:current"
      }
    });

    expect(prompt).toContain("Template: product-search@1.2.0 (version-7)");
    expect(prompt).toContain("Allowed template tools: commerce.search");
    expect(prompt).toContain('Required output schema: {"type":"object"}');
    expect(prompt).toContain('Execution constraints: {"maxResults":5}');
    expect(prompt).toContain("template=sha256:template, current=sha256:current");
  });
});
