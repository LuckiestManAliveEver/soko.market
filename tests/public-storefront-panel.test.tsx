// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentSettings } from "../apps/web/src/soko-application-shared";
import type { CommerceIdentityResolution } from "@soko/shared-types";

const getJson = vi.fn();

vi.mock("../apps/web/src/api-helpers", () => ({
  getJson: (...args: unknown[]) => getJson(...args)
}));

const { PublicStorefrontPanel } = await import("../apps/web/src/PublicStorefrontPanel");

const draftAgent = { language: "en" } as AgentSettings;

const resolution: CommerceIdentityResolution = {
  status: "active",
  identity: {
    canonicalBusinessId: "biz-1",
    displayName: "Mama Mboga",
    commerceAddress: "mama-mboga@soko.market",
    sokoId: "soko.mama-mboga",
    storefront: { sokoId: "soko.mama-mboga", publicUrlPath: "/public/storefronts/soko.mama-mboga" },
    catalogue: { productCount: 12, searchable: true },
    supportedInteractionTypes: ["conversation", "catalogue", "order"],
    availability: "online",
    entryPoints: []
  }
};

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("PublicStorefrontPanel", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    getJson.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("shows the raw sokoId immediately, then swaps in the resolved public commerce address", async () => {
    let resolveGetJson!: (value: CommerceIdentityResolution) => void;
    getJson.mockReturnValue(
      new Promise<CommerceIdentityResolution>((resolve) => {
        resolveGetJson = resolve;
      })
    );

    await act(async () => {
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

    expect(getJson).toHaveBeenCalledWith("/public/commerce-identities/soko.mama-mboga");
    expect(host.querySelector(".soko-id-card strong")?.textContent).toBe("soko.mama-mboga");
    expect(host.textContent).toContain("Public shop ID");
    expect(host.textContent).not.toContain("Permanent shop identity");

    await act(async () => {
      resolveGetJson(resolution);
    });
    await flush();

    expect(host.querySelector(".soko-id-card strong")?.textContent).toBe("mama-mboga@soko.market");
  });

  it("copies the resolved public commerce address, not the raw sokoId", async () => {
    getJson.mockResolvedValue(resolution);
    const copyStorefrontValue = vi.fn().mockResolvedValue(undefined);

    await act(async () => {
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
    await flush();

    const copyIdButton = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "Copy ID"
    );
    await act(async () => {
      copyIdButton!.click();
      await Promise.resolve();
    });

    expect(copyStorefrontValue).toHaveBeenCalledWith("mama-mboga@soko.market", "Public ID");
  });

  it("falls back to the sokoId when the resolver call fails", async () => {
    getJson.mockRejectedValue(new Error("network down"));

    await act(async () => {
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
    await flush();

    expect(host.querySelector(".soko-id-card strong")?.textContent).toBe("soko.mama-mboga");
  });
});
