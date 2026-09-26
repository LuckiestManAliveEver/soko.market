import { useEffect, useState } from "react";

import { fetchFreshJson } from "./api-helpers";
import { getErrorMessage } from "./chat-message-plumbing";
import {
  installDeviceModel,
  isDeviceInferenceSupported,
  listInstalledDeviceModels,
  removeDeviceModel
} from "./device-model-engine";

interface RoutedModelView {
  id: string;
  displayName: string;
  providerId: string;
  providerModelId: string;
  executionTarget: string;
  enabled: boolean;
  contextWindow: number | null;
}

/**
 * Settings -> AI providers -> On-device models. Lists the catalog's on-device models (from the
 * backend - never a hardcoded list) and lets this person download or remove each one on *this*
 * device. Which model the shop's agent uses is chosen separately in the model switcher.
 */
export function OnDeviceModelsCard() {
  const [models, setModels] = useState<RoutedModelView[]>([]);
  const [installed, setInstalled] = useState<string[]>(() => listInstalledDeviceModels());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const supported = isDeviceInferenceSupported();

  useEffect(() => {
    let cancelled = false;
    fetchFreshJson<{ models: RoutedModelView[] }>("/v1/ai/models")
      .then((response) => {
        if (!cancelled) {
          setModels(
            response.models.filter(
              (model) =>
                model.enabled &&
                (model.executionTarget === "browser-local" ||
                  model.executionTarget === "installed-app")
            )
          );
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setMessage(getErrorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function install(model: RoutedModelView) {
    const providerModelId = model.providerModelId;
    setBusyId(model.id);
    setMessage("");
    try {
      await installDeviceModel(providerModelId, (fraction) =>
        setMessage(`Downloading ${model.displayName}… ${Math.round(fraction * 100)}%`)
      );
      setInstalled(listInstalledDeviceModels());
      setMessage(`${model.displayName} is ready on this device.`);
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(model: RoutedModelView) {
    setBusyId(model.id);
    try {
      await removeDeviceModel(model.providerModelId);
      setInstalled(listInstalledDeviceModels());
      setMessage(`${model.displayName} was removed from this device.`);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="record-form on-device-models-card">
      <div className="section-heading">
        <p className="eyebrow">On-device models</p>
        <h3>Run AI privately on this device</h3>
        <p>
          {supported
            ? "Download a model once and your agent can answer on this device - nothing is sent to a cloud model. Pick it for your agent in the model switcher."
            : "This browser cannot run on-device models (WebGPU is not available). Try Chrome or Edge on a recent phone or computer."}
        </p>
      </div>
      {message.length > 0 ? (
        <p className="shell-note" role="status" aria-live="polite">
          {message}
        </p>
      ) : null}
      <div className="connected-social-list" role="list" aria-label="On-device models">
        {models.map((model) => {
          const isInstalled = installed.includes(model.providerModelId);
          const busy = busyId === model.id;
          return (
            <article className="connected-social-card" role="listitem" key={model.id}>
              <div>
                <span>{model.displayName}</span>
                <strong>{isInstalled ? "Installed on this device" : "Not installed"}</strong>
              </div>
              <div className="row-actions">
                {isInstalled ? (
                  <button
                    className="secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => void remove(model)}
                  >
                    Remove
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={!supported || busyId !== null}
                    aria-busy={busy}
                    onClick={() => void install(model)}
                  >
                    {busy ? "Downloading…" : "Download"}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
