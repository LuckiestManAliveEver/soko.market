import {
  isLocalRuntimeHost,
  type EffectiveRuntimeSummary,
  type RuntimeCapabilities
} from "@soko/shared-types";
import { useEffect, useState } from "react";
import type { LocalState } from "@soko/offline-runtime";
import { currentOfflineScope, getOfflineState, offlineModeEvent } from "../offline-runtime";
import { apiCloudFetch, readStableDeviceId } from "../lib/api";
import {
  localRuntimeMessages,
  runtimeHandoffController,
  runtimeTransition,
  withRuntimeTransition
} from "../runtime-handoff";
import type { ChatMessage } from "../app-shell";

export function useRuntimeHandoff(
  accountId: string,
  businessId: string,
  conversationId: string | null,
  runtimeRevision: string
) {
  const [state, setState] = useState<LocalState | null>(null);
  const [availability, setAvailability] = useState({
    available: false,
    reason: "Checking local runtime availability…"
  });
  const [canonicalStatus, setCanonicalStatus] = useState("Checking runtime…");
  const [error, setError] = useState("");
  const [transition, setTransition] = useState<"offline" | "online" | null>(null);
  const [connected, setConnected] = useState(navigator.onLine);
  useEffect(() => {
    setAvailability({ available: false, reason: "Checking local runtime availability…" });
    setCanonicalStatus(conversationId ? "Checking runtime…" : "Runtime unavailable");
    let revision = 0;
    let disposed = false;
    const scope = { accountId, storeId: businessId, deviceId: readStableDeviceId() };
    const refresh = async () => {
      const current = ++revision;
      setConnected(navigator.onLine);
      setTransition(runtimeTransition(scope));
      try {
        const next = await getOfflineState(scope);
        if (disposed || current !== revision) return;
        setState(next);
        if (next.runtimeHandoffSession && next.runtimeHandoffSession.status !== "hosted") return;
        let caps: RuntimeCapabilities | undefined;
        if (navigator.onLine && conversationId) {
          const fetched = await (await runtimeHandoffController()).capabilities(
            scope,
            conversationId
          );
          if (disposed || current !== revision) return;
          caps = fetched;
          setCanonicalStatus(
            fetched.activeTransfer
              ? fetched.local.some(
                  (host) => host.executionHostId === fetched.activeTransfer?.targetHostId
                )
                ? "Switching to local…"
                : "Switching to hosted…"
              : fetched.local.some((host) => host.active)
                ? "Local"
                : fetched.hosted.some((host) => host.active)
                  ? "Hosted"
                  : "Runtime unavailable"
          );
        }
        if (navigator.onLine && !conversationId) {
          const runtime = await apiCloudFetch<EffectiveRuntimeSummary>(
            `/businesses/${encodeURIComponent(businessId)}/runtime/effective`
          );
          if (disposed || current !== revision) return;
          setCanonicalStatus(
            runtime.ready
              ? isLocalRuntimeHost(runtime.execution.type)
                ? "Local"
                : "Hosted"
              : "Runtime unavailable"
          );
        }
        const result = !navigator.locks
          ? {
              available: false,
              reason: "This browser cannot safely coordinate runtime handoffs."
            }
          : !navigator.onLine
            ? {
                available: false,
                reason: "Reconnect to prepare this conversation for local execution."
              }
            : await (await runtimeHandoffController()).availability(scope, conversationId, caps);
        if (!disposed && current === revision) setAvailability(result);
      } catch (cause) {
        if (!disposed && current === revision) {
          setCanonicalStatus("Runtime unavailable");
          setAvailability({
            available: false,
            reason: cause instanceof Error ? cause.message : "Local runtime is unavailable."
          });
        }
      }
    };
    const listener = () => {
      void refresh();
    };
    listener();
    for (const name of [offlineModeEvent, "online", "offline", "storage"])
      window.addEventListener(name, listener);
    return () => {
      disposed = true;
      for (const name of [offlineModeEvent, "online", "offline", "storage"])
        window.removeEventListener(name, listener);
    };
  }, [accountId, businessId, conversationId, runtimeRevision]);

  const activeScope = currentOfflineScope();
  const offline = activeScope?.accountId === accountId && activeScope.storeId === businessId;
  const scopeLoaded = state?.accountId === accountId && state.storeId === businessId;
  const session = scopeLoaded ? state.runtimeHandoffSession : undefined;
  const needsReturn = !!session && session.status !== "hosted";
  const legacyOffline = offline && !needsReturn;
  const label =
    transition === "offline"
      ? "Switching to local…"
      : transition === "online"
        ? "Switching to hosted…"
        : needsReturn || offline
          ? "Go hosted"
          : "Go offline";
  const status =
    transition === "offline"
      ? "Switching to local…"
      : transition === "online"
        ? "Switching to hosted…"
        : offline
          ? legacyOffline
            ? "Offline · Business data only"
            : "Local"
          : needsReturn
            ? "Handoff needs recovery"
            : canonicalStatus;

  async function toggle(messages: ChatMessage[]) {
    const scope = { accountId, storeId: businessId, deviceId: readStableDeviceId() };
    setError("");
    try {
      await withRuntimeTransition(
        scope,
        needsReturn || offline ? "online" : "offline",
        async () => {
          const controller = await runtimeHandoffController();
          if (needsReturn || offline) await controller.goOnline(scope);
          else if (conversationId)
            await controller.goOffline(scope, conversationId, localRuntimeMessages(messages));
        }
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The handoff failed. Your conversation is saved."
      );
    }
  }
  return {
    label,
    status,
    error,
    offline,
    busy: transition !== null,
    disabled:
      !scopeLoaded ||
      transition !== null ||
      (needsReturn ? !connected : legacyOffline || !availability.available),
    reason: legacyOffline
      ? "Sync this business-data session in offline settings before moving the agent runtime."
      : needsReturn
        ? "Sync changes and resume the same conversation online."
        : availability.reason,
    refresh: () => window.dispatchEvent(new Event(offlineModeEvent)),
    recover: async () => {
      const scope = { accountId, storeId: businessId, deviceId: readStableDeviceId() };
      try {
        await withRuntimeTransition(scope, "offline", async () =>
          (await runtimeHandoffController()).recover(scope)
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Handoff recovery failed.");
      }
    },
    needsRecovery: session?.status === "prepared" && !!session.transferKey,
    toggle
  };
}
