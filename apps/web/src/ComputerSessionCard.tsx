import { useCallback, useEffect, useRef, useState } from "react";
import type { ComputerObservation, ComputerSession } from "@soko/computer-runtime";
import { apiFetch } from "./lib/api";
import { getUserFacingErrorMessage } from "./user-facing-error";

const activePollIntervalMs = 2000;
const idlePollIntervalMs = 8000;

interface ComputerSessionView {
  session: ComputerSession;
  observation: ComputerObservation | null;
  pendingApprovalId: string | null;
}

function statusLabel(session: ComputerSession): string {
  switch (session.status) {
    case "CREATING":
      return "Opening…";
    case "READY":
      return session.controlMode === "HUMAN" ? "You are controlling" : "Soko is controlling";
    case "NAVIGATING":
      return "Navigating…";
    case "AWAITING_APPROVAL":
      return "Waiting for your approval";
    case "HUMAN_CONTROLLED":
      return "You are controlling";
    case "SUSPENDED":
      return "Suspended";
    case "RESUMING":
      return "Resuming…";
    case "CLOSED":
      return "Closed";
    case "FAILED":
      return "Something went wrong";
  }
}

function isTerminal(session: ComputerSession): boolean {
  return session.status === "CLOSED" || session.status === "FAILED";
}

export default function ComputerSessionCard(props: {
  businessId: string;
  computerSessionId: string;
}) {
  const [view, setView] = useState<ComputerSessionView | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const cancelledRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const loaded = await apiFetch<ComputerSessionView>(
        `/businesses/${props.businessId}/computer/sessions/${encodeURIComponent(props.computerSessionId)}`
      );
      if (!cancelledRef.current) {
        setView(loaded);
        setMessage("");
      }
    } catch (error) {
      if (!cancelledRef.current) setMessage(getUserFacingErrorMessage(error));
    }
  }, [props.businessId, props.computerSessionId]);

  useEffect(() => {
    cancelledRef.current = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      await load();
      if (cancelledRef.current) return;
      timer = setTimeout(() => void tick(), pollDelayFor(view));
    }

    void tick();
    return () => {
      cancelledRef.current = true;
      if (timer !== null) clearTimeout(timer);
    };
    // Deliberately excludes `view` - re-reading it inside pollDelayFor via closure would restart
    // the interval loop on every poll instead of just choosing the next delay.
  }, [load]);

  function pollDelayFor(current: ComputerSessionView | null): number {
    if (current === null) return activePollIntervalMs;
    if (isTerminal(current.session)) return 0;
    return current.session.controlMode === "AGENT" ? activePollIntervalMs : idlePollIntervalMs;
  }

  async function runAction(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      await load();
    } catch (error) {
      setMessage(getUserFacingErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const takeControl = () =>
    runAction(() =>
      apiFetch(
        `/businesses/${props.businessId}/computer/sessions/${encodeURIComponent(props.computerSessionId)}/control/take`,
        { method: "POST" }
      )
    );

  const releaseControl = () =>
    runAction(() =>
      apiFetch(
        `/businesses/${props.businessId}/computer/sessions/${encodeURIComponent(props.computerSessionId)}/control/release`,
        { method: "POST" }
      )
    );

  const stopSession = () =>
    runAction(() =>
      apiFetch(
        `/businesses/${props.businessId}/computer/sessions/${encodeURIComponent(props.computerSessionId)}/close`,
        { method: "POST" }
      )
    );

  const decideApproval = (decision: "approve" | "reject") => {
    const approvalId = view?.pendingApprovalId;
    if (approvalId === null || approvalId === undefined) return;
    return runAction(() =>
      apiFetch(
        `/businesses/${props.businessId}/computer/approvals/${encodeURIComponent(approvalId)}/${decision}`,
        { method: "POST" }
      )
    );
  };

  if (view === null) {
    return (
      <section className="record-form computer-session-card" aria-label="Computer">
        {message.length > 0 ? (
          <p className="shell-note">{message}</p>
        ) : (
          <p>Opening browser session…</p>
        )}
      </section>
    );
  }

  const { session, observation, pendingApprovalId } = view;

  return (
    <section className="record-form computer-session-card" aria-label="Live browser">
      <div className="section-heading">
        <p className="eyebrow">Computer</p>
        <h3>
          {observation?.title !== undefined && observation.title.length > 0
            ? observation.title
            : "Live browser"}
        </h3>
      </div>

      <div
        className="computer-session-viewport"
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "4 / 3",
          background: "#111",
          borderRadius: 8,
          overflow: "hidden"
        }}
      >
        {observation?.screenshotDataUrl !== null && observation?.screenshotDataUrl !== undefined ? (
          <img
            src={observation.screenshotDataUrl}
            alt={observation.title.length > 0 ? observation.title : "Browser view"}
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#aaa"
            }}
          >
            <span>{statusLabel(session)}</span>
          </div>
        )}
      </div>

      {observation !== null && observation.url.length > 0 ? (
        <p className="shell-note" style={{ wordBreak: "break-all" }}>
          {observation.url}
        </p>
      ) : null}

      <div className="computer-session-status">
        <span
          className={`status-dot status-${session.controlMode.toLowerCase()}`}
          aria-hidden="true"
        />
        <span>{statusLabel(session)}</span>
      </div>

      {message.length > 0 ? <p className="shell-note">{message}</p> : null}

      {pendingApprovalId !== null ? (
        <div className="computer-session-approval">
          <p>Soko wants to complete an action that needs your approval.</p>
          <div className="computer-session-actions">
            <button type="button" onClick={() => void decideApproval("reject")} disabled={busy}>
              Cancel
            </button>
            <button type="button" onClick={() => void decideApproval("approve")} disabled={busy}>
              Approve
            </button>
          </div>
        </div>
      ) : null}

      {!isTerminal(session) ? (
        <div className="computer-session-actions">
          {session.controlMode === "AGENT" ? (
            <button type="button" onClick={() => void takeControl()} disabled={busy}>
              Take control
            </button>
          ) : (
            <button type="button" onClick={() => void releaseControl()} disabled={busy}>
              Return to Soko
            </button>
          )}
          <button type="button" onClick={() => void stopSession()} disabled={busy}>
            Stop
          </button>
        </div>
      ) : null}
    </section>
  );
}
