import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ModelTemplateReportCardPanel } from "../apps/web/src/ModelTemplateReportCardPanel";

describe("Model Template report card UI", () => {
  it("uses the API-backed evidence surface in agent model settings", () => {
    const html = renderToStaticMarkup(<ModelTemplateReportCardPanel businessId="shop-1" />);
    expect(html).toContain("Model Template report cards");
    expect(html).toContain("Executable expertise");
    expect(html).toContain("Loading report cards");
  });
});
