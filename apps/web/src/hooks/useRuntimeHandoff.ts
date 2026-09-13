import { useEffect, useState } from "react";
import type { LocalState } from "@soko/offline-runtime";
import {
  currentOfflineScope,
  getOfflineState,
  offlineModeEvent,
  offlineRuntimeEnabled
} from "../offline-runtime";
import { readStableDeviceId } from "../lib/api";
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
  const [error, setError] = useState("");
  const [transition, setTransition] = useState<"offline" | "online" | null>(null);
  const [connected, setConnected] = useState(navigator.onLine);
  useEffect(() => {
    setAvailability({ available: false, reason: "Checking local runtime availability…" });
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
        const result = !offlineRuntimeEnabled
          ? {
              available: false,
              reason: "Local runtime handoff is not enabled in this installation."
            }
          : !navigator.locks
            ? {
                available: false,
                reason: "This browser cannot safely coordinate runtime handoffs."
              }
            : !navigator.onLine
              ? {
                  available: false,
                  reason: "Reconnect to prepare this conversation for local execution."
                }
              : await (await runtimeHandoffController()).availability(scope, conversationId);
        if (!disposed && current === revision) setAvailability(result);
      } catch (cause) {
        if (!disposed && current === revision)
          setAvailability({
            available: false,
            reason: cause instanceof Error ? cause.message : "Local runtime is unavailable."
          });
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
      ? "Preparing offline…"
      : transition === "online"
        ? "Returning online…"
        : needsReturn || offline
          ? "Go online"
          : "Go offline";
  const status =
    transition === "offline"
      ? "Preparing offline…"
      : transition === "online"
        ? "Returning online…"
        : offline
          ? legacyOffline
            ? "Offline · Business data only"
            : "Offline · This device"
          : needsReturn
            ? "Handoff needs recovery"
            : "Hosted";

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
    toggle
  };
}
