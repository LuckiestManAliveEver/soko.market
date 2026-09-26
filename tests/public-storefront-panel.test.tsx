// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentSettings } from "../apps/web/src/soko-application-shared";
import { PublicStorefrontPanel } from "../apps/web/src/PublicStorefrontPanel";

const draftAgent = { language: "en" } as AgentSettings;

describe("PublicStorefrontPanel", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    host = document.createElement("div");
    document.body.append(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("shows the public commerce address, not the raw sokoId, under Public shop ID", () => {
    act(() => {
      root = createRoot(host);
      root.render(
        <PublicStorefrontPanel
          business={{ sokoId: "soko.mama-mboga" }}
          storefrontUrl="https://soko.market/public/storefronts/soko.mama-mboga"
          ownerLabel="Jane"
          draftAgent={draftAgent}
          isEditing={false}
          updateAgent={() => {}}
          copyStorefrontValue={() => Promise.resolve()}
        />
      );
    });

    expect(host.querySelector(".soko-id-card strong")?.textContent).toBe("mama-mboga@soko.market");
    expect(host.textContent).toContain("Public shop ID");
    expect(host.textContent).not.toContain("Permanent shop identity");
    // The technical "Storefront ID" input below still shows the raw sokoId - that's the value
    // embedded in the actual storefront URL, a distinct field from the merchant-facing public ID.
    expect(host.querySelector('input[value="soko.mama-mboga"]')).not.toBeNull();
  });

  it("copies the public commerce address, not the raw sokoId", async () => {
    const copyStorefrontValue = vi.fn().mockResolvedValue(undefined);

    act(() => {
      root = createRoot(host);
      root.render(
        <PublicStorefrontPanel
          business={{ sokoId: "soko.mama-mboga" }}
          storefrontUrl="https://soko.market/public/storefronts/soko.mama-mboga"
          ownerLabel="Jane"
          draftAgent={draftAgent}
          isEditing={false}
          updateAgent={() => {}}
          copyStorefrontValue={copyStorefrontValue}
        />
      );
    });

    const copyIdButton = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "Copy ID"
    );
    await act(async () => {
      copyIdButton!.click();
      await Promise.resolve();
    });

    expect(copyStorefrontValue).toHaveBeenCalledWith("mama-mboga@soko.market", "Public ID");
  });

  it("opens the native share sheet with the canonical storefront link", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { configurable: true, value: share });

    act(() => {
      root = createRoot(host);
      root.render(
        <PublicStorefrontPanel
          business={{ sokoId: "soko.mama-mboga" }}
          storefrontUrl="https://soko.market/public/storefronts/soko.mama-mboga"
          ownerLabel="Mama Mboga"
          draftAgent={draftAgent}
          isEditing={false}
          updateAgent={() => {}}
          copyStorefrontValue={() => Promise.resolve()}
        />
      );
    });

    const shareButton = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "Share shop"
    );
    await act(async () => {
      shareButton!.click();
      await Promise.resolve();
    });

    expect(share).toHaveBeenCalledWith({
      title: "Mama Mboga's shop on Soko.market",
      text: "Browse and message Mama Mboga's shop on Soko.market.",
      url: "https://soko.market/public/storefronts/soko.mama-mboga"
    });
  });

  it("copies the storefront link when native sharing is unavailable", async () => {
    const copyStorefrontValue = vi.fn().mockResolvedValue(undefined);

    act(() => {
      root = createRoot(host);
      root.render(
        <PublicStorefrontPanel
          business={{ sokoId: "soko.mama-mboga" }}
          storefrontUrl="https://soko.market/public/storefronts/soko.mama-mboga"
          ownerLabel="Mama Mboga"
          draftAgent={draftAgent}
          isEditing={false}
          updateAgent={() => {}}
          copyStorefrontValue={copyStorefrontValue}
        />
      );
    });

    const shareButton = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "Share shop"
    );
    await act(async () => {
      shareButton!.click();
      await Promise.resolve();
    });

    expect(copyStorefrontValue).toHaveBeenCalledWith(
      "https://soko.market/public/storefronts/soko.mama-mboga",
      "Storefront URL"
    );
  });
});
