import { useEffect, useState } from "react";

import { getJson, postJson } from "./api-helpers";
import { useAsyncActions } from "./hooks/useAsyncActions";
import { getUserFacingErrorMessage } from "./user-facing-error";

type VocabularyStatus = "CANDIDATE" | "APPROVED" | "REJECTED";

interface VocabularyOccurrence {
  id: string;
  context: string | null;
  observedCanonicalTerm: string | null;
  createdAt: string;
}

interface VocabularyEntry {
  id: string;
  surfaceForm: string;
  canonicalTerm: string | null;
  status: VocabularyStatus;
  occurrences: VocabularyOccurrence[];
}

interface VocabularyResponse {
  entries: VocabularyEntry[];
  currentVocabularySnapshot: string;
}

export function TemplateVocabularyPanel({
  businessId,
  onSnapshotChange
}: {
  businessId: string;
  onSnapshotChange: (snapshotId: string) => void;
}) {
  const path = `/businesses/${businessId}/vocabulary`;
  const { isPending, runAction } = useAsyncActions();
  const [entries, setEntries] = useState<VocabularyEntry[] | null>(null);
  const [snapshotId, setSnapshotId] = useState("");
  const [canonicalDrafts, setCanonicalDrafts] = useState<Record<string, string>>({});
  const [surfaceForm, setSurfaceForm] = useState("");
  const [observedCanonicalTerm, setObservedCanonicalTerm] = useState("");
  const [context, setContext] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    const response = await getJson<VocabularyResponse>(`${path}/candidates`);
    setEntries(response.entries);
    setSnapshotId(response.currentVocabularySnapshot);
    onSnapshotChange(response.currentVocabularySnapshot);
    setCanonicalDrafts(
      Object.fromEntries(
        response.entries.map((entry) => [entry.id, entry.canonicalTerm ?? entry.surfaceForm])
      )
    );
  }

  useEffect(() => {
    let cancelled = false;
    getJson<VocabularyResponse>(`${path}/candidates`)
      .then((response) => {
        if (cancelled) return;
        setEntries(response.entries);
        setSnapshotId(response.currentVocabularySnapshot);
        onSnapshotChange(response.currentVocabularySnapshot);
        setCanonicalDrafts(
          Object.fromEntries(
            response.entries.map((entry) => [entry.id, entry.canonicalTerm ?? entry.surfaceForm])
          )
        );
      })
      .catch((error: unknown) => {
        if (!cancelled) setMessage(getUserFacingErrorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, [onSnapshotChange, path]);

  async function submitUnknownTerm() {
    const term = surfaceForm.trim();
    if (term.length === 0) {
      setMessage("Enter the unknown term.");
      return;
    }
    await postJson(`${path}/unknown-terms`, {
      surfaceForm: term,
      observedCanonicalTerm: observedCanonicalTerm.trim() || null,
      context: context.trim() || null
    });
    setSurfaceForm("");
    setObservedCanonicalTerm("");
    setContext("");
    await load();
    setMessage(`Added “${term}” for review.`);
  }

  async function review(entry: VocabularyEntry, action: "APPROVE" | "REJECT") {
    const canonicalTerm = canonicalDrafts[entry.id]?.trim() ?? "";
    if (action === "APPROVE" && canonicalTerm.length === 0) {
      setMessage("Enter a canonical term before approval.");
      return;
    }
    await postJson(`${path}/candidates/${encodeURIComponent(entry.id)}/review`, {
      action,
      canonicalTerm: action === "APPROVE" ? canonicalTerm : null
    });
    await load();
    setMessage(action === "APPROVE" ? "Vocabulary mapping approved." : "Vocabulary term rejected.");
  }

  const candidates = entries?.filter((entry) => entry.status === "CANDIDATE") ?? [];
  const reviewed = entries?.filter((entry) => entry.status !== "CANDIDATE") ?? [];

  return (
    <section className="template-vocabulary-panel" aria-labelledby="template-vocabulary-heading">
      <div className="section-heading">
        <p className="eyebrow">Canonical language</p>
        <h3 id="template-vocabulary-heading">Template vocabulary</h3>
        <p className="vocabulary-snapshot" title={snapshotId}>
          Approved snapshot {snapshotId === "" ? "loading…" : `${snapshotId.slice(0, 18)}…`}
        </p>
      </div>

      {message.length > 0 ? (
        <p className="shell-note" role="status" aria-live="polite">
          {message}
        </p>
      ) : null}

      <div className="vocabulary-capture-grid">
        <label>
          Unknown term
          <input value={surfaceForm} onChange={(event) => setSurfaceForm(event.target.value)} />
        </label>
        <label>
          Suggested canonical term
          <input
            value={observedCanonicalTerm}
            onChange={(event) => setObservedCanonicalTerm(event.target.value)}
          />
        </label>
        <label className="vocabulary-context-field">
          Usage context
          <input value={context} onChange={(event) => setContext(event.target.value)} />
        </label>
        <button
          type="button"
          disabled={isPending("vocabulary-submit")}
          onClick={() =>
            void runAction("vocabulary-submit", async () => {
              try {
                await submitUnknownTerm();
              } catch (error) {
                setMessage(getUserFacingErrorMessage(error));
              }
            })
          }
        >
          Add for review
        </button>
      </div>

      {entries === null ? <p className="shell-note">Loading vocabulary…</p> : null}
      {entries !== null && candidates.length === 0 ? (
        <p className="shell-note">No vocabulary candidates awaiting review.</p>
      ) : null}
      {candidates.map((entry) => (
        <article className="vocabulary-review-row" key={entry.id}>
          <div>
            <strong>{entry.surfaceForm}</strong>
            <span>{entry.occurrences.length} occurrence(s)</span>
          </div>
          <label>
            Canonical term
            <input
              value={canonicalDrafts[entry.id] ?? ""}
              onChange={(event) =>
                setCanonicalDrafts((current) => ({
                  ...current,
                  [entry.id]: event.target.value
                }))
              }
            />
          </label>
          <div className="row-actions">
            <button
              type="button"
              disabled={isPending(`vocabulary-approve-${entry.id}`)}
              onClick={() =>
                void runAction(`vocabulary-approve-${entry.id}`, async () => {
                  try {
                    await review(entry, "APPROVE");
                  } catch (error) {
                    setMessage(getUserFacingErrorMessage(error));
                  }
                })
              }
            >
              Approve
            </button>
            <button
              className="secondary"
              type="button"
              disabled={isPending(`vocabulary-reject-${entry.id}`)}
              onClick={() =>
                void runAction(`vocabulary-reject-${entry.id}`, async () => {
                  try {
                    await review(entry, "REJECT");
                  } catch (error) {
                    setMessage(getUserFacingErrorMessage(error));
                  }
                })
              }
            >
              Reject
            </button>
          </div>
        </article>
      ))}

      {reviewed.length > 0 ? (
        <details className="vocabulary-reviewed-list">
          <summary>Reviewed mappings ({reviewed.length})</summary>
          {reviewed.map((entry) => (
            <p key={entry.id}>
              <strong>{entry.surfaceForm}</strong>
              <span>
                {entry.status === "APPROVED" ? ` → ${entry.canonicalTerm}` : " · rejected"}
              </span>
            </p>
          ))}
        </details>
      ) : null}
    </section>
  );
}
