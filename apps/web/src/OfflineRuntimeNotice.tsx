import { useEffect, useState } from "react";
import { currentOfflineScope, getOfflineState, offlineModeEvent } from "./offline-runtime";
export function OfflineRuntimeNotice({ onReview }: { onReview: () => void }) {
  const [notice, setNotice] = useState<{ online: boolean; pending: number; agent: boolean } | null>(
    null
  );
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      const scope = currentOfflineScope();
      if (!scope) {
        setNotice(null);
        return;
      }
      void getOfflineState(scope).then(
        (state) => {
          if (!cancelled)
            setNotice(
              state.offlineModeActive
                ? {
                    online: navigator.onLine,
                    pending:
                      state.operations.filter((op) => op.syncStatus !== "ACKED").length +
                      (state.runtimeHandoffSession?.pendingMessages.length ?? 0),
                    agent:
                      !!state.runtimeHandoffSession &&
                      state.runtimeHandoffSession.status !== "hosted"
                  }
                : null
            );
        },
        () => {
          if (!cancelled) setNotice({ online: navigator.onLine, pending: 0, agent: false });
        }
      );
    };
    refresh();
    for (const event of ["online", "offline", "storage", offlineModeEvent])
      window.addEventListener(event, refresh);
    return () => {
      cancelled = true;
      for (const event of ["online", "offline", "storage", offlineModeEvent])
        window.removeEventListener(event, refresh);
    };
  }, []);
  if (!notice) return null;
  return (
    <aside className="offline-runtime-notice" aria-label="Offline runtime status">
      <span role="status">
        {notice.agent ? "Offline ● · This device." : "Offline · Business data only."}{" "}
        {notice.pending} change{notice.pending === 1 ? "" : "s"} saved on this device.{" "}
        {notice.online
          ? "Connection available; sync when ready."
          : "Connect when you are ready to sync."}
      </span>
      <button type="button" onClick={onReview}>
        Review offline settings
      </button>
    </aside>
  );
}
