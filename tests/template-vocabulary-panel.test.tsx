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

const { TemplateVocabularyPanel } = await import("../apps/web/src/TemplateVocabularyPanel");

function setInputValue(element: HTMLInputElement, value: string): void {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  )?.set;
  nativeSetter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function button(root: ParentNode, label: string): HTMLButtonElement {
  const match = Array.from(root.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === label
  );
  if (match === undefined) throw new Error(`Missing button ${label}`);
  return match;
}

describe("TemplateVocabularyPanel", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    getJson.mockReset();
    postJson.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
  });

  it("submits unknown terms and approves candidates using the refreshed snapshot", async () => {
    const firstSnapshot = `sha256:${"1".repeat(64)}`;
    const approvedSnapshot = `sha256:${"2".repeat(64)}`;
    const candidate = {
      id: "vocab-1",
      surfaceForm: "unga",
      canonicalTerm: "flour",
      status: "CANDIDATE",
      occurrences: [{ id: "occ-1", context: "ongeza unga", createdAt: "2026-09-18" }]
    };
    getJson
      .mockResolvedValueOnce({ entries: [candidate], currentVocabularySnapshot: firstSnapshot })
      .mockResolvedValueOnce({ entries: [candidate], currentVocabularySnapshot: firstSnapshot })
      .mockResolvedValueOnce({
        entries: [{ ...candidate, status: "APPROVED" }],
        currentVocabularySnapshot: approvedSnapshot
      });
    postJson.mockResolvedValue({});
    const onSnapshotChange = vi.fn();

    await act(async () => {
      root = createRoot(host);
      root.render(
        <TemplateVocabularyPanel businessId="shop-1" onSnapshotChange={onSnapshotChange} />
      );
      await flush();
    });

    const inputs = host.querySelectorAll("input");
    await act(async () => {
      setInputValue(inputs[0] as HTMLInputElement, "maize flour");
      setInputValue(inputs[1] as HTMLInputElement, "corn flour");
      setInputValue(inputs[2] as HTMLInputElement, "customer order");
    });
    await act(async () => {
      button(host, "Add for review").click();
      await flush();
    });
    expect(postJson).toHaveBeenCalledWith("/businesses/shop-1/vocabulary/unknown-terms", {
      surfaceForm: "maize flour",
      observedCanonicalTerm: "corn flour",
      context: "customer order"
    });

    await act(async () => {
      button(host, "Approve").click();
      await flush();
    });
    expect(postJson).toHaveBeenCalledWith(
      "/businesses/shop-1/vocabulary/candidates/vocab-1/review",
      { action: "APPROVE", canonicalTerm: "flour" }
    );
    expect(onSnapshotChange).toHaveBeenLastCalledWith(approvedSnapshot);
    expect(host.textContent).toContain("Reviewed mappings (1)");
  });
});
