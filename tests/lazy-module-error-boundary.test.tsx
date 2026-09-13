// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LazyModuleErrorBoundary } from "../apps/web/src/LazyModuleErrorBoundary";

function BrokenProfile(): never {
  throw new Error("Invalid agent profile");
}

function StaleChunkProfile(): never {
  throw new TypeError("Failed to fetch dynamically imported module: /assets/profile.js");
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

  // Regression test for G: before this fix, every caught error - including a genuine bug in the
  // settings surface - showed "The app may have been updated while this page was open." and a
  // reload button, incorrectly blaming a deployment for what is actually a programming error.
  it("does not blame a genuine render exception on a stale deployment, and never offers reload", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const root = createRoot(host);

    await act(async () =>
      root.render(
        <LazyModuleErrorBoundary moduleKey="agent-profile" label="Account and agent settings">
          <BrokenProfile />
        </LazyModuleErrorBoundary>
      )
    );

    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Account and agent settings hit an unexpected problem.");
    expect(alert?.textContent).not.toContain("could not open");
    expect(alert?.textContent).not.toContain("app may have been updated");
    expect(host.querySelector("button")?.textContent).toBe("Try again");
    await act(async () => root.unmount());
  });

  it("shows the stale-deployment message and a reload action for a recognized chunk-load error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const root = createRoot(host);

    await act(async () =>
      root.render(
        <LazyModuleErrorBoundary moduleKey="agent-profile" label="Account and agent settings">
          <StaleChunkProfile />
        </LazyModuleErrorBoundary>
      )
    );

    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Account and agent settings could not open."
    );
    expect(host.querySelector("button")?.textContent).toBe("Reload and try again");
    await act(async () => root.unmount());
  });

  it("clicking Try again re-renders without reloading the page", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    let shouldThrow = true;
    function SometimesBroken() {
      if (shouldThrow) throw new Error("Invalid agent profile");
      return <div>Recovered</div>;
    }
    const root = createRoot(host);

    await act(async () =>
      root.render(
        <LazyModuleErrorBoundary moduleKey="agent-profile" label="Account and agent settings">
          <SometimesBroken />
        </LazyModuleErrorBoundary>
      )
    );
    expect(host.querySelector("button")?.textContent).toBe("Try again");

    shouldThrow = false;
    await act(async () =>
      host.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    );

    expect(host.textContent).toBe("Recovered");
    await act(async () => root.unmount());
  });

  it("logs a structured frontend.chunk_load_failed event classifying the failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const root = createRoot(host);

    await act(async () =>
      root.render(
        <LazyModuleErrorBoundary moduleKey="agent-profile" label="Account and agent settings">
          <BrokenProfile />
        </LazyModuleErrorBoundary>
      )
    );

    const logged = infoSpy.mock.calls.map(([line]) => JSON.parse(String(line)));
    const event = logged.find((entry) => entry.event === "frontend.chunk_load_failed");
    expect(event).toMatchObject({
      component: "agent-profile",
      category: "component_exception"
    });
    expect(event).not.toHaveProperty("message");
    expect(event).not.toHaveProperty("stack");
    await act(async () => root.unmount());
  });
});
