import { describe, expect, it } from "vitest";
import {
  connectivityCanUseLocalData,
  connectivityRequiresServer,
  type ConnectivityState
} from "../apps/web/src/connectivity";

describe("typed connectivity model", () => {
  it("distinguishes local usability from server reachability", () => {
    const locallyUsable: ConnectivityState[] = [
      "unknown",
      "browser_offline",
      "api_reachable",
      "api_unreachable",
      "authenticated",
      "degraded"
    ];
    for (const state of locallyUsable) {
      expect(connectivityCanUseLocalData(state)).toBe(true);
    }
    expect(connectivityCanUseLocalData("session_expired")).toBe(false);
  });

  it("identifies states where server-dependent operations need an explanation", () => {
    expect(connectivityRequiresServer("browser_offline")).toBe(true);
    expect(connectivityRequiresServer("api_unreachable")).toBe(true);
    expect(connectivityRequiresServer("degraded")).toBe(true);
    expect(connectivityRequiresServer("authenticated")).toBe(false);
  });
});
