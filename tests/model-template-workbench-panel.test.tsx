import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ModelTemplateWorkbenchPanel } from "../apps/web/src/ModelTemplateWorkbenchPanel";

describe("Model Template workbench UI", () => {
  it("uses the API-backed create/evaluate surface in agent model settings", () => {
    const html = renderToStaticMarkup(<ModelTemplateWorkbenchPanel businessId="shop-1" />);
    expect(html).toContain("Model Template workbench");
    expect(html).toContain("Executable expertise");
    expect(html).toContain("Loading templates");
  });
});
