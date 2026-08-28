// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LazyModuleErrorBoundary } from "../apps/web/src/LazyModuleErrorBoundary";

function BrokenProfile(): never {
  throw new Error("Invalid agent profile");
}

describe("lazy module error boundary", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("shows a reload action instead of leaving the owner module blank after a render failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const root = createRoot(host);

    await act(async () =>
      root.render(
        <LazyModuleErrorBoundary moduleKey="agent-profile" label="Account and agent settings">
          <BrokenProfile />
        </LazyModuleErrorBoundary>
      )
    );

    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Account and agent settings could not open."
    );
    expect(host.querySelector("button")?.textContent).toBe("Reload and try again");
    await act(async () => root.unmount());
  });
});
