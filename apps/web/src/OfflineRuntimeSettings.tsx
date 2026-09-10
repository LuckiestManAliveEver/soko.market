import { useEffect, useState } from "react";
import { installOfflineRuntime, type InstallStep, type LocalState } from "@soko/offline-runtime";
import { SettingsGroup } from "./SettingsGroup";
import { prepareOfflineShell } from "./offline-shell";
import { readStableDeviceId } from "./lib/api";
import { clearApiRequestCache } from "./api-request-cache";
import { ensureOcrEngineCached, isOcrEngineCached } from "./offline-ocr";
import type { OfflineAssistantReply } from "./webllm-runtime";
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
  ensureInstalledOfflineRuntime,
  askOfflineAssistant
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
  async function install() {
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
      prepareShell: prepareOfflineShell,
      progress: (step, done, total) => setProgress({ step, done, total })
    });
    await setOfflineMode(scope, true);
    setConfirming(false);
    setMessage(
      dataOnly
        ? "Offline business data is ready. AI, checkout and payments require an online connection."
        : "Your pinned offline runtime is ready."
    );
  }
  async function sync(goOnline: boolean) {
    const client = await createOfflineSyncClient(scope);
    await client.sync();
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
      title="Go Offline"
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
      {!modeActive && offlineRuntimeEnabled && pending === 0 && (
        <button type="button" disabled={busy || !online} onClick={() => setConfirming(true)}>
          Go Offline
        </button>
      )}
      {confirming && (
        <section role="dialog" aria-modal="false" aria-labelledby="offline-confirm-title">
          <h3 id="offline-confirm-title">Prepare this device for offline use</h3>
          <p>
            Download a snapshot of products, customers, invoices and orders. Catalogue changes,
            customer creation, stock counts, and creating, editing and confirming invoices will stay
            on this device until you choose to sync. Payments, checkout and account changes require
            an online connection. Receipts can be scanned offline if you enable on-device scanning
            below; confirming a scan into a supplier and purchase record still requires
            reconnecting.
          </p>
          <p>
            Allow at least 16 MiB for business data. Installation reserves at least 256 MiB or 20%
            of the browser storage quota, whichever is larger. Browser estimates cannot guarantee
            free space for other apps.
          </p>
          <label>
            <input
              type="checkbox"
              checked={dataOnly}
              disabled={busy}
              onChange={(event) => setDataOnly(event.target.checked)}
            />
            Install business data only (AI remains unavailable offline)
          </label>
          {!dataOnly && (
            <p>
              Downloads a small on-device assistant model (WebGPU required; about 1 GB of device
              memory). The exact agent, harness and model version are pinned at install time and
              will not change on reconnect. It answers from the prompt alone, with no catalogue,
              order, customer or account data - unsupported devices fall back to business data only.
            </p>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void run(install);
            }}
          >
            Confirm and install
          </button>
          <button type="button" disabled={busy} onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </section>
      )}
      {busy && progress && (
        <div role="status">
          <span>
            {
              {
                storage: "Checking storage",
                database: "Preparing local storage",
                snapshot: "Downloading business data",
                shell: "Downloading the offline application",
                runtime: "Installing pinned runtime",
                complete: "Installation complete"
              }[progress.step]
            }
          </span>
          <progress
            aria-label="Offline installation progress"
            value={progress.done}
            max={Math.max(1, progress.total)}
          />
        </div>
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
