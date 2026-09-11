// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getJson = vi.fn();
const postJson = vi.fn();

vi.mock("../apps/web/src/api-helpers", () => ({
  getJson: (...args: unknown[]) => getJson(...args),
  postJson: (...args: unknown[]) => postJson(...args)
}));

const { ModelTemplateGovernancePanel } = await import(
  "../apps/web/src/ModelTemplateGovernancePanel"
);

/**
 * React tracks a controlled input's previous value via a hidden property setter, so assigning
 * `input.value` directly and dispatching a plain "input" event is a no-op for onChange - the usual
 * workaround (what @testing-library/user-event and fireEvent do internally) is to invoke the
 * native HTMLInputElement/HTMLTextAreaElement value setter first, bypassing React's tracked setter.
 * Mirrors tests/connected-sources-panel.test.tsx's own setInputValue helper.
 */
function setInputValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const nativeSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  nativeSetter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function setSelectValue(element: HTMLSelectElement, value: string): void {
  element.value = value;
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function buttonWithText(root: ParentNode, text: string): HTMLButtonElement {
  const button = Array.from(root.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === text
  );
  if (button === undefined) throw new Error(`No button with text "${text}" was found.`);
  return button;
}

function sectionByHeading(root: ParentNode, headingText: string): HTMLElement {
  const heading = Array.from(root.querySelectorAll("h3")).find(
    (candidate) => candidate.textContent === headingText
  );
  if (heading === undefined) throw new Error(`No heading "${headingText}" was found.`);
  const section = heading.closest(".nested-card");
  if (!(section instanceof HTMLElement)) {
    throw new Error(`No enclosing .nested-card for heading "${headingText}".`);
  }
  return section;
}

function templatesResponse() {
  return {
    templates: [
      {
        id: "tmpl-1",
        name: "Support agent",
        productionVersionId: "ver-1",
        previousProductionVersionId: "ver-0"
      }
    ]
  };
}

function versionsResponse() {
  return {
    versions: [
      { id: "ver-1", version: "1.1.0", state: "PROMOTED", baseModelId: "base-1" },
      { id: "ver-0", version: "1.0.0", state: "PASSED", baseModelId: "base-1" }
    ]
  };
}

describe("ModelTemplateGovernancePanel", () => {
  let host: HTMLDivElement;
  let root: Root;
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    getJson.mockReset();
    postJson.mockReset();
    confirmSpy = vi.spyOn(window, "confirm");
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    confirmSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  async function mountLoaded(): Promise<void> {
    getJson.mockImplementation(async (path: string) => {
      if (path === "/businesses/shop-1/model-templates") return templatesResponse();
      if (path === "/businesses/shop-1/model-templates/tmpl-1/versions") return versionsResponse();
      throw new Error(`Unexpected getJson call: ${path}`);
    });
    await act(async () => {
      root = createRoot(host);
      root.render(<ModelTemplateGovernancePanel businessId="shop-1" />);
      await flush();
    });
  }

  it("loads the business's model templates and versions into the governance sections", async () => {
    await mountLoaded();

    expect(getJson).toHaveBeenCalledWith("/businesses/shop-1/model-templates");
    expect(getJson).toHaveBeenCalledWith("/businesses/shop-1/model-templates/tmpl-1/versions");
    expect(host.textContent).toContain("Model Template governance");
    expect(host.textContent).toContain("Support agent");
    expect(host.querySelector("h3")?.parentElement).not.toBeNull();
    for (const heading of [
      "Production observations",
      "Expert corrections",
      "Training dataset",
      "Improvement run",
      "Promote a version live",
      "Export a version"
    ]) {
      expect(sectionByHeading(host, heading)).toBeDefined();
    }
  });

  it("runs the observation -> correction -> dataset -> improvement-run -> promotion lifecycle, gating promotion behind an explicit confirm", async () => {
    await mountLoaded();

    // 1. Capture a production observation.
    const observationsSection = sectionByHeading(host, "Production observations");
    setSelectValue(observationsSection.querySelectorAll("select")[0] as HTMLSelectElement, "ver-1");
    setInputValue(
      observationsSection.querySelectorAll("textarea")[0] as HTMLTextAreaElement,
      '{"message":"hello"}'
    );
    setInputValue(
      observationsSection.querySelectorAll("textarea")[1] as HTMLTextAreaElement,
      '{"reply":"wrong answer"}'
    );

    postJson.mockImplementationOnce(async (path: string, body: Record<string, unknown>) => {
      expect(path).toBe("/businesses/shop-1/model-templates/tmpl-1/observations");
      expect(body).toMatchObject({
        templateVersionId: "ver-1",
        input: { message: "hello" },
        output: { reply: "wrong answer" },
        suspectedFailure: true
      });
      return {
        id: "obs-1",
        templateId: "tmpl-1",
        templateVersionId: "ver-1",
        state: "CANDIDATE_FAILURE",
        failureReason: null,
        riskFlags: [],
        createdAt: "2026-09-01T00:00:00.000Z"
      };
    });

    await act(async () => {
      buttonWithText(observationsSection, "Capture observation").click();
      await flush();
    });

    expect(host.textContent).toContain("Observation obs-1");
    expect(host.textContent).toContain("CANDIDATE_FAILURE");

    // 2. Review it as a real failure.
    postJson.mockImplementationOnce(async (path: string, body: Record<string, unknown>) => {
      expect(path).toBe("/businesses/shop-1/observations/obs-1/review");
      expect(body).toMatchObject({ isFailure: true });
      return {
        id: "obs-1",
        templateId: "tmpl-1",
        templateVersionId: "ver-1",
        state: "REVIEWED",
        failureReason: "Marked incorrect by an expert.",
        riskFlags: [],
        createdAt: "2026-09-01T00:00:00.000Z"
      };
    });
    await act(async () => {
      buttonWithText(host, "Mark failure").click();
      await flush();
    });
    expect(host.textContent).toContain("REVIEWED");

    // 3. Submit an expert correction against the reviewed observation.
    const correctionsSection = sectionByHeading(host, "Expert corrections");
    setSelectValue(correctionsSection.querySelectorAll("select")[0] as HTMLSelectElement, "obs-1");
    setInputValue(
      correctionsSection.querySelectorAll("textarea")[0] as HTMLTextAreaElement,
      '{"reply":"right answer"}'
    );
    setInputValue(
      correctionsSection.querySelectorAll("textarea")[1] as HTMLTextAreaElement,
      "The model answered the wrong item."
    );
    postJson.mockImplementationOnce(async (path: string, body: Record<string, unknown>) => {
      expect(path).toBe("/businesses/shop-1/model-templates/tmpl-1/corrections");
      expect(body).toMatchObject({
        observationId: "obs-1",
        correctedOutput: { reply: "right answer" },
        explanation: "The model answered the wrong item."
      });
      return {
        id: "corr-1",
        observationId: "obs-1",
        templateId: "tmpl-1",
        status: "SUBMITTED",
        explanation: "The model answered the wrong item.",
        submittedAt: "2026-09-01T00:00:00.000Z"
      };
    });
    await act(async () => {
      buttonWithText(correctionsSection, "Submit correction").click();
      await flush();
    });
    expect(host.textContent).toContain("Correction corr-1");

    // 4. Approve the correction.
    postJson.mockImplementationOnce(async (path: string, body: Record<string, unknown>) => {
      expect(path).toBe("/businesses/shop-1/corrections/corr-1/approval");
      expect(body).toMatchObject({ approve: true });
      return {
        id: "corr-1",
        observationId: "obs-1",
        templateId: "tmpl-1",
        status: "APPROVED",
        explanation: "The model answered the wrong item.",
        submittedAt: "2026-09-01T00:00:00.000Z"
      };
    });
    await act(async () => {
      buttonWithText(host, "Approve").click();
      await flush();
    });
    expect(host.textContent).toContain("APPROVED");

    // 5. Build a dataset from the approved correction.
    const datasetSection = sectionByHeading(host, "Training dataset");
    const datasetCheckbox = datasetSection.querySelector(
      'input[type="checkbox"]'
    ) as HTMLInputElement;
    await act(async () => {
      datasetCheckbox.click();
      await flush();
    });
    const datasetNameInput = datasetSection.querySelector(
      'input:not([type="checkbox"])'
    ) as HTMLInputElement;
    setInputValue(datasetNameInput, "First correction batch");
    postJson.mockImplementationOnce(async (path: string, body: Record<string, unknown>) => {
      expect(path).toBe("/businesses/shop-1/model-templates/tmpl-1/datasets");
      expect(body).toMatchObject({
        name: "First correction batch",
        examples: [{ correctionId: "corr-1", evaluationCaseId: null, split: "TRAINING" }]
      });
      return {
        dataset: {
          id: "ds-1",
          templateId: "tmpl-1",
          version: 1,
          name: "First correction batch",
          exampleCount: 1
        }
      };
    });
    await act(async () => {
      buttonWithText(datasetSection, "Build dataset from approved corrections").click();
      await flush();
    });
    expect(host.textContent).toContain("First correction batch");

    // 6. Start an improvement run against the new dataset.
    const improvementSection = sectionByHeading(host, "Improvement run");
    const improvementSelects = improvementSection.querySelectorAll("select");
    setSelectValue(improvementSelects[0] as HTMLSelectElement, "ver-1"); // parent version
    setSelectValue(improvementSelects[1] as HTMLSelectElement, "ds-1"); // dataset version
    const improvementInputs = improvementSection.querySelectorAll("input");
    setInputValue(improvementInputs[0] as HTMLInputElement, "suite-1");
    setInputValue(improvementInputs[1] as HTMLInputElement, "base-1");
    postJson.mockImplementationOnce(async (path: string, body: Record<string, unknown>) => {
      expect(path).toBe("/businesses/shop-1/model-templates/tmpl-1/improvement-runs");
      expect(body).toMatchObject({
        parentVersionId: "ver-1",
        datasetVersionId: "ds-1",
        evaluationSuiteId: "suite-1",
        targetBaseModelId: "base-1",
        strategy: "PROMPT_OPTIMIZATION"
      });
      return {
        id: "run-1",
        templateId: "tmpl-1",
        status: "COMPLETED",
        strategy: "PROMPT_OPTIMIZATION",
        candidateVersionId: "ver-2",
        errorCode: null,
        startedAt: "2026-09-01T00:00:00.000Z",
        completedAt: "2026-09-01T00:00:05.000Z"
      };
    });
    await act(async () => {
      buttonWithText(improvementSection, "Start improvement run").click();
      await flush();
    });
    expect(host.textContent).toContain("Run run-1");
    expect(host.textContent).toContain("COMPLETED");

    // 7. Promote the resulting candidate - declining the confirm must not call the mutation.
    const promoteSection = sectionByHeading(host, "Promote a version live");
    setSelectValue(promoteSection.querySelectorAll("select")[0] as HTMLSelectElement, "ver-2");
    setInputValue(promoteSection.querySelectorAll("input")[0] as HTMLInputElement, "eval-run-1");

    confirmSpy.mockReturnValueOnce(false);
    await act(async () => {
      buttonWithText(promoteSection, "Promote to production").click();
      await flush();
    });
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(postJson).not.toHaveBeenCalledWith(
      "/businesses/shop-1/model-templates/tmpl-1/promotions",
      expect.anything()
    );

    // Confirming proceeds and calls the real mutation.
    confirmSpy.mockReturnValueOnce(true);
    postJson.mockImplementationOnce(async (path: string, body: Record<string, unknown>) => {
      expect(path).toBe("/businesses/shop-1/model-templates/tmpl-1/promotions");
      expect(body).toMatchObject({
        candidateVersionId: "ver-2",
        evaluationRunId: "eval-run-1"
      });
      return {
        id: "promo-1",
        templateId: "tmpl-1",
        candidateVersionId: "ver-2",
        decision: "PROMOTED",
        regressionCount: 0,
        reason: "Candidate met the configured correctness and regression gates.",
        createdAt: "2026-09-01T00:00:10.000Z"
      };
    });
    await act(async () => {
      buttonWithText(promoteSection, "Promote to production").click();
      await flush();
    });
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(postJson).toHaveBeenCalledWith(
      "/businesses/shop-1/model-templates/tmpl-1/promotions",
      expect.objectContaining({ candidateVersionId: "ver-2", evaluationRunId: "eval-run-1" })
    );
    expect(host.textContent).toContain("Candidate promoted to production.");
  });

  it("requires an explicit confirm before rolling back, and only calls the mutation once confirmed", async () => {
    await mountLoaded();

    const promoteSection = sectionByHeading(host, "Promote a version live");
    const rollbackButton = buttonWithText(promoteSection, "Roll back to previous version");
    expect(rollbackButton.hasAttribute("disabled")).toBe(false);

    confirmSpy.mockReturnValueOnce(false);
    await act(async () => {
      rollbackButton.click();
      await flush();
    });
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(postJson).not.toHaveBeenCalled();

    confirmSpy.mockReturnValueOnce(true);
    postJson.mockImplementationOnce(async (path: string, body: Record<string, unknown>) => {
      expect(path).toBe("/businesses/shop-1/model-templates/tmpl-1/rollback");
      expect(body).toEqual({});
      return {
        id: "promo-2",
        templateId: "tmpl-1",
        candidateVersionId: "ver-0",
        decision: "ROLLED_BACK",
        regressionCount: 0,
        reason: "Rolled back from 1.1.0 to 1.0.0.",
        createdAt: "2026-09-01T00:00:00.000Z"
      };
    });
    await act(async () => {
      rollbackButton.click();
      await flush();
    });
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(postJson).toHaveBeenCalledWith("/businesses/shop-1/model-templates/tmpl-1/rollback", {});
    expect(host.textContent).toContain("Rolled back to the previous production version.");
  });
});
