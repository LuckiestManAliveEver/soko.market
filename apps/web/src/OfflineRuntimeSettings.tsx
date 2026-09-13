import { useEffect, useState } from "react";
import { installOfflineRuntime, type InstallStep, type LocalState } from "@soko/offline-runtime";
import { SettingsGroup } from "./SettingsGroup";
import { OfflineInstallWizard } from "./OfflineInstallWizard";
import { prepareOfflineShell } from "./offline-shell";
import { readStableDeviceId } from "./lib/api";
import { clearApiRequestCache } from "./api-request-cache";
import { ensureOcrEngineCached, isOcrEngineCached } from "./offline-ocr";
import type { OfflineAssistantReply } from "./webllm-runtime";
import { runtimeHandoffController, withRuntimeTransition } from "./runtime-handoff";
import {
  offlineDatabase,
  getOfflineState,
  createOfflineSyncClient,
  fetchOfflineSnapshot,
  installedOfflineRuntime,
  offlineRuntimeEnabled,
  setOfflineMode,
  offlineModeEvent,
  currentOfflineScope,
  currentStorageTarget,
  useStorageTarget,
  reconnectRemovableDevice,
  ensureInstalledOfflineRuntime,
  askOfflineAssistant,
  type StorageTarget
} from "./offline-runtime";

export function OfflineRuntimeSettings({
  accountId,
  businessId
}: {
  accountId: string;
  businessId: string;
}) {
  const scope = { accountId, storeId: businessId, deviceId: readStableDeviceId() };
  const [state, setState] = useState<LocalState | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [online, setOnline] = useState(navigator.onLine);
  const [progress, setProgress] = useState<{
    step: InstallStep;
    done: number;
    total: number;
  } | null>(null);
  const [dataOnly, setDataOnly] = useState(true);
  const [ocrCached, setOcrCached] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<{ done: number; total: number } | null>(null);
  const [assistantPrompt, setAssistantPrompt] = useState("");
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantReply, setAssistantReply] = useState<OfflineAssistantReply | null>(null);
  const [assistantError, setAssistantError] = useState("");
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      setOnline(navigator.onLine);
      void getOfflineState({ accountId, storeId: businessId, deviceId: readStableDeviceId() }).then(
        (next) => {
          if (!cancelled) setState(next);
        },
        (error: unknown) => {
          if (!cancelled)
            setMessage(error instanceof Error ? error.message : "Offline storage is unavailable.");
        }
      );
      void isOcrEngineCached().then((cached) => {
        if (!cancelled) setOcrCached(cached);
      });
    };
    refresh();
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
    window.addEventListener(offlineModeEvent, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", refresh);
      window.removeEventListener(offlineModeEvent, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [accountId, businessId]);
  if (!offlineRuntimeEnabled && !state?.installed) return null;
  const activeScope = currentOfflineScope();
  const modeActive =
    state?.offlineModeActive &&
    activeScope?.accountId === accountId &&
    activeScope?.storeId === businessId;
  const pending =
    state?.operations.filter((operation) => operation.syncStatus !== "ACKED").length ?? 0;
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      clearApiRequestCache();
      setState(await getOfflineState(scope));
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The offline action failed. Your changes are still saved."
      );
    } finally {
      setBusy(false);
    }
  }
  async function install(target: StorageTarget, handle: FileSystemDirectoryHandle | null) {
    const current = await getOfflineState(scope);
    if (current.runtimeHandoffSession && current.runtimeHandoffSession.status !== "hosted")
      throw new Error("Return the active runtime online before replacing its offline storage.");
    await useStorageTarget(target, handle ?? undefined);
    if (!dataOnly) await ensureInstalledOfflineRuntime();
    const runtime = installedOfflineRuntime();
    await installOfflineRuntime({
      db: await offlineDatabase(),
      scope,
      estimate: () => navigator.storage.estimate(),
      snapshot: () => fetchOfflineSnapshot(scope),
      binding: runtime.binding,
      ...(runtime.adapter ? { adapter: runtime.adapter } : {}),
      businessDataOnly: dataOnly,
      activate: false,
      prepareShell: prepareOfflineShell,
      progress: (step, done, total) => setProgress({ step, done, total })
    });
    setMessage(
      dataOnly
        ? "Offline business data is prepared. Use Go offline in the header when a compatible agent runtime is available."
        : "The local model is installed. Use Go offline in the header when it can resume your active agent."
    );
  }
  async function sync(goOnline: boolean) {
    if (
      goOnline &&
      state?.runtimeHandoffSession &&
      state.runtimeHandoffSession.status !== "hosted"
    ) {
      await withRuntimeTransition(scope, "online", async () => {
        await (await runtimeHandoffController()).goOnline(scope);
      });
      setMessage("Changes synced. The same conversation is back online.");
      return;
    }
    const client = await createOfflineSyncClient(scope);
    await client.sync();
    window.dispatchEvent(new Event(offlineModeEvent));
    const next = await getOfflineState(scope);
    if (next.operations.some((operation) => operation.syncStatus !== "ACKED")) {
      setMessage("Some changes need review or another sync attempt. Offline mode is still active.");
      return;
    }
    if (goOnline) await setOfflineMode(scope, false);
    setMessage(
      goOnline
        ? "Changes synced. You are back online."
        : "Changes synced. Offline mode and your pinned runtime are unchanged."
    );
  }
  return (
    <SettingsGroup
      title="Offline storage and sync"
      description="Install business data, receipt scanning and an on-device assistant so you can keep working without a connection"
    >
      <section aria-labelledby="go-offline-requirements-title">
        <h4 id="go-offline-requirements-title">What you need to go fully offline</h4>
        <p>
          Everything below installs inside this browser - no separate app, OS package or admin
          rights needed.
        </p>
        <ul>
          <li>
            <strong>Business data</strong> (always available): any device. Downloads a snapshot of
            your products, customers, invoices and orders - at least 16 MiB, plus 256 MiB or 20% of
            your browser's storage quota reserved as headroom. Creating, editing and confirming
            invoices works offline too, decrementing stock once you sync.
          </li>
          <li>
            <strong>Offline receipt scanning</strong> (optional): any modern browser. One-time ~14
            MB download (tesseract.js, runs entirely on-device).
          </li>
          <li>
            <strong>On-device AI assistant</strong> (optional): needs a WebGPU-capable browser and
            device (recent Chrome or Edge on desktop or Android; not available on unsupported
            browsers, including older Safari) and about 1 GB of free device storage/memory for the
            pinned model. Unsupported devices automatically fall back to business data only.
          </li>
        </ul>
      </section>
      <section aria-labelledby="go-offline-disclaimers-title">
        <h4 id="go-offline-disclaimers-title">What still needs a connection</h4>
        <ul>
          <li>
            Checkout and payment settlement - taking a customer's payment always needs an online
            connection, even when everything else here is installed.
          </li>
          <li>Account or authentication changes, such as passwords, PINs and security settings.</li>
          <li>
            Confirming a scanned receipt into a supplier and purchase record - text extraction
            itself runs offline, but confirming needs supplier and sales-agent data this device
            hasn't downloaded yet.
          </li>
          <li>
            Confirming an invoice checks stock against this device's last sync, not live stock on
            other devices - a confirmation that looked fine offline can still be rejected on sync if
            stock ran out elsewhere first, the same as any two people editing the same invoice at
            once.
          </li>
          <li>
            Nearby device-to-device messaging - a research prototype, not available in this PWA.
          </li>
          <li>
            The on-device assistant answers only from what you type - it has no catalogue, order,
            customer or account data, and is told to say so rather than guess.
          </li>
          <li>
            Whatever business snapshot and AI runtime you install are pinned at that moment and
            won't silently change until you explicitly sync, reinstall or swap them.
          </li>
        </ul>
      </section>
      <p>
        {modeActive ? "Offline mode is active." : "Online mode."} {pending} change
        {pending === 1 ? "" : "s"} waiting to sync.
      </p>
      {state?.installedAt && (
        <p>Business snapshot installed {new Date(state.installedAt).toLocaleString()}.</p>
      )}
      {state?.pin && (
        <p>
          Pinned: {state.pin.agentId} {state.pin.agentVersion}; {state.pin.modelId}{" "}
          {state.pin.modelVersion}.
        </p>
      )}
      {modeActive && online && (
        <p role="status">
          Connection available. Review your {pending} pending changes, then choose Sync when ready.
        </p>
      )}
      {!modeActive && state?.installed && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void run(() => setOfflineMode(scope, true));
          }}
        >
          Resume saved offline session
        </button>
      )}
      {!modeActive &&
        offlineRuntimeEnabled &&
        pending === 0 &&
        (!state?.runtimeHandoffSession || state.runtimeHandoffSession.status === "hosted") && (
          <button type="button" disabled={busy || !online} onClick={() => setConfirming(true)}>
            Prepare offline storage
          </button>
        )}
      <OfflineInstallWizard
        open={confirming}
        busy={busy}
        dataOnly={dataOnly}
        onDataOnlyChange={setDataOnly}
        progress={progress}
        result={message}
        onInstall={(target, handle) => {
          void run(() => install(target, handle));
        }}
        onClose={() => setConfirming(false)}
      />
      {state?.installed && currentStorageTarget() === "removable" && (
        <button
          type="button"
          disabled={busy || !online}
          onClick={() => {
            void run(reconnectRemovableDevice);
          }}
        >
          Reconnect removable device
        </button>
      )}
      {state?.installed && (
        <div>
          <p>
            {ocrCached
              ? "Offline receipt scanning is ready. Photos are read on this device; confirming a scan still needs a connection."
              : "Offline receipt scanning is off. Enable it to read receipt photos on this device while offline (about 14 MB)."}
          </p>
          {!ocrCached && (
            <button
              type="button"
              disabled={ocrBusy || !online}
              onClick={() => {
                setOcrBusy(true);
                setMessage("");
                void ensureOcrEngineCached((done, total) => setOcrProgress({ done, total }))
                  .then(() => isOcrEngineCached())
                  .then(setOcrCached)
                  .catch((error: unknown) => {
                    setMessage(
                      error instanceof Error
                        ? error.message
                        : "Could not download the offline receipt scanner."
                    );
                  })
                  .finally(() => {
                    setOcrBusy(false);
                    setOcrProgress(null);
                  });
              }}
            >
              Enable offline receipt scanning
            </button>
          )}
          {ocrBusy && ocrProgress && (
            <div role="status">
              <span>Downloading the offline receipt scanner</span>
              <progress
                aria-label="Offline receipt scanner download progress"
                value={ocrProgress.done}
                max={Math.max(1, ocrProgress.total)}
              />
            </div>
          )}
        </div>
      )}
      {modeActive && state?.pin?.active && (
        <div>
          <p>Ask the offline assistant something. It answers on-device from your message alone.</p>
          <textarea
            aria-label="Message the offline assistant"
            value={assistantPrompt}
            disabled={assistantBusy}
            onChange={(event) => setAssistantPrompt(event.target.value)}
          />
          <button
            type="button"
            disabled={assistantBusy || !assistantPrompt.trim()}
            onClick={() => {
              setAssistantBusy(true);
              setAssistantError("");
              setAssistantReply(null);
              void askOfflineAssistant(scope, { prompt: assistantPrompt })
                .then((result) => setAssistantReply(result as OfflineAssistantReply))
                .catch((error: unknown) => {
                  setAssistantError(
                    error instanceof Error ? error.message : "The offline assistant is unavailable."
                  );
                })
                .finally(() => setAssistantBusy(false));
            }}
          >
            Ask offline
          </button>
          {assistantBusy && <p role="status">Thinking on-device&hellip;</p>}
          {assistantReply && (
            <p role="status">
              Answered offline by {assistantReply.modelId}: {assistantReply.reply}
            </p>
          )}
          {assistantError && <p role="alert">{assistantError}</p>}
        </div>
      )}
      {state?.installed && (
        <div>
          <button
            type="button"
            disabled={busy || !online}
            onClick={() => {
              void run(() => sync(false));
            }}
          >
            Sync {pending} changes
          </button>
          {state.offlineModeActive && (
            <button
              type="button"
              disabled={busy || !online}
              onClick={() => {
                void run(() => sync(true));
              }}
            >
              Sync and go back online
            </button>
          )}
        </div>
      )}
      {state?.conflicts.map((conflict) => (
        <section key={conflict.id} aria-label="Sync conflict">
          <p>{conflict.message}</p>
          <details>
            <summary>Compare versions</summary>
            <pre>{JSON.stringify({ local: conflict.local, server: conflict.server }, null, 2)}</pre>
          </details>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void run(async () => {
                await (
                  await createOfflineSyncClient(scope)
                ).resolveManual(conflict.operationId, "server");
              });
            }}
          >
            Keep server version and discard local edits to this item
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void run(async () => {
                await (
                  await createOfflineSyncClient(scope)
                ).resolveManual(conflict.operationId, "retry");
              });
            }}
          >
            Retry my change against this version
          </button>
        </section>
      ))}
      {message && <p role="status">{message}</p>}
    </SettingsGroup>
  );
}
