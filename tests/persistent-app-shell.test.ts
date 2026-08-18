import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const application = readFileSync("apps/web/src/SokoApplication.tsx", "utf8");
const syncStateHook = readFileSync("apps/web/src/hooks/useSyncState.ts", "utf8");

describe("persistent authenticated app shell", () => {
  it("restores cached session and shop state before background authentication refresh", () => {
    expect(application).toContain("const initialCachedSession = readCachedAuthSession()");
    expect(application).toContain("useState<SessionResponse | null>(initialCachedSession)");
    expect(application).toContain(
      'initialCachedSession === null ? "initializing" : "offline-authenticated"'
    );
    expect(application).toContain(
      'current === "offline-authenticated" ? current : "restoring-session"'
    );
  });

  it("uses history state for ordinary routes and keeps one stable shell instance", () => {
    const navigationStart = application.indexOf("function navigateToView");
    const navigationEnd = application.indexOf("function returnToChat", navigationStart);
    const navigation = application.slice(navigationStart, navigationEnd);

    expect(navigation).toContain("navigateToOwnerRoute");
    expect(navigation).not.toContain("window.history.pushState");
    expect(navigation).not.toContain("window.location.assign");
    expect(navigation).not.toContain("window.location.reload");
    expect(application).toContain("data-shell-instance={shellInstanceIdRef.current}");
  });

  it("does not recreate IndexedDB or realtime when online state changes", () => {
    const repositoryEffectStart = syncStateHook.indexOf("void openIndexedDbSyncRepository()");
    const repositoryEffectEnd = syncStateHook.indexOf(
      "async function loadSyncQueue",
      repositoryEffectStart
    );
    const repositoryEffect = syncStateHook.slice(repositoryEffectStart, repositoryEffectEnd);

    expect(repositoryEffect).toContain("subscribeToAccountRealtime");
    expect(repositoryEffect).toContain("}, [deps.session?.account.id]);");
    expect(repositoryEffect).not.toContain("}, [deps.session?.account.id, isOnline]);");
  });
});
