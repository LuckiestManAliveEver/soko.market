import { useEffect, useState } from "react";

import { getJson, postJson } from "./api-helpers";
import { useApiMutationRevision } from "./hooks/useApiMutationRevision";
import { useAsyncActions } from "./hooks/useAsyncActions";
import { getUserFacingErrorMessage } from "./user-facing-error";

// Local response shapes, mirroring services/api/src/cp2/domains/model-templates/types.ts.
// This domain has no packages/shared-types entries yet (confirmed by grep before writing this
// file) - the existing read-only ModelTemplateReportCardPanel.tsx already established the
// precedent of declaring narrow local interfaces here rather than a shared-types addition, so
// this panel follows the same convention for consistency instead of introducing a second pattern.

type TemplateVersionState =
  | "DRAFT"
  | "CANDIDATE"
  | "EVALUATING"
  | "PASSED"
  | "FAILED"
  | "PROMOTED"
  | "RETIRED";

type ObservationState = "OBSERVED" | "CANDIDATE_FAILURE" | "REVIEWED" | "CORRECTED" | "APPROVED";

type DatasetSplit = "TRAINING" | "VALIDATION" | "REGRESSION";

type OptimizationStrategy =
  | "PROMPT_OPTIMIZATION"
  | "CONTEXT_GISTING"
  | "DATASET_DISTILLATION"
  | "ADAPTER_TRAINING"
  | "FULL_FINE_TUNE"
  | "QUANTIZATION";

const optimizationStrategies: OptimizationStrategy[] = [
  "PROMPT_OPTIMIZATION",
  "CONTEXT_GISTING",
  "DATASET_DISTILLATION",
  "ADAPTER_TRAINING",
  "FULL_FINE_TUNE",
  "QUANTIZATION"
];

const datasetSplits: DatasetSplit[] = ["TRAINING", "VALIDATION", "REGRESSION"];

interface TemplateSummary {
  id: string;
  name: string;
  productionVersionId: string | null;
  previousProductionVersionId: string | null;
}

interface TemplateVersionSummary {
  id: string;
  version: string;
  state: TemplateVersionState;
  baseModelId: string;
}

interface ObservationRecord {
  id: string;
  templateId: string;
  templateVersionId: string;
  state: ObservationState;
  failureReason: string | null;
  riskFlags: string[];
  createdAt: string;
}

interface CorrectionRecord {
  id: string;
  observationId: string;
  templateId: string;
  status: "SUBMITTED" | "APPROVED" | "REJECTED";
  explanation: string;
  submittedAt: string;
}

interface DatasetVersionSummary {
  id: string;
  templateId: string;
  version: number;
  name: string;
  exampleCount: number;
}

interface ImprovementRunSummary {
  id: string;
  templateId: string;
  status: "RUNNING" | "COMPLETED" | "FAILED";
  strategy: OptimizationStrategy;
  candidateVersionId: string | null;
  errorCode: string | null;
  startedAt: string;
  completedAt: string | null;
}

interface PromotionResult {
  id: string;
  templateId: string;
  candidateVersionId: string;
  decision: "PROMOTED" | "REJECTED" | "ROLLED_BACK";
  regressionCount: number;
  reason: string;
  createdAt: string;
}

interface ExportResult {
  fileName: string;
  manifestSha256: string;
  [key: string]: unknown;
}

interface ObservationDraft {
  templateVersionId: string;
  input: string;
  output: string;
  suspectedFailure: boolean;
  failureReason: string;
  sourceConversationId: string;
}

const emptyObservationDraft: ObservationDraft = {
  templateVersionId: "",
  input: "",
  output: "",
  suspectedFailure: true,
  failureReason: "",
  sourceConversationId: ""
};

interface CorrectionDraft {
  observationId: string;
  correctedOutput: string;
  explanation: string;
  rubric: string;
}

const emptyCorrectionDraft: CorrectionDraft = {
  observationId: "",
  correctedOutput: "",
  explanation: "",
  rubric: ""
};

interface DatasetDraft {
  name: string;
  split: DatasetSplit;
}

const emptyDatasetDraft: DatasetDraft = { name: "", split: "TRAINING" };

interface ImprovementDraft {
  parentVersionId: string;
  datasetVersionId: string;
  evaluationSuiteId: string;
  targetBaseModelId: string;
  strategy: OptimizationStrategy;
  strategyConfig: string;
}

const emptyImprovementDraft: ImprovementDraft = {
  parentVersionId: "",
  datasetVersionId: "",
  evaluationSuiteId: "",
  targetBaseModelId: "",
  strategy: "PROMPT_OPTIMIZATION",
  strategyConfig: ""
};

interface PromoteDraft {
  candidateVersionId: string;
  evaluationRunId: string;
  maxRegressions: string;
  minimumScoreDelta: string;
}

const emptyPromoteDraft: PromoteDraft = {
  candidateVersionId: "",
  evaluationRunId: "",
  maxRegressions: "",
  minimumScoreDelta: ""
};

function parseRequiredJson(text: string, label: string): unknown {
  const trimmed = text.trim();
  if (trimmed.length === 0) throw new Error(`${label} is required, as JSON.`);
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }
}

function parseOptionalJsonRecord(text: string, label: string): Record<string, unknown> {
  if (text.trim().length === 0) return {};
  const parsed = parseRequiredJson(text, label);
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function shortId(id: string): string {
  return id.length <= 8 ? id : `${id.slice(0, 8)}…`;
}

function downloadJsonFile(fileName: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

// Governance/lifecycle counterpart to the read-only ModelTemplateReportCardPanel: capturing
// production observations, submitting and approving expert corrections, building training
// datasets, running improvement jobs, and promoting/rolling back/exporting template versions.
// An internal-operator surface (mounted in AgentProfileSurface's "Model & inference" settings
// group), not a merchant chat action - see docs/frontend/frontend.md's Phase 4k precedent.
//
// Observations and corrections have no GET (list or single) endpoint in this domain today - only
// POST create and POST review/approval. This panel tracks what it has captured or submitted in
// this session (from real API responses only, never fabricated) rather than pretending a listing
// endpoint exists.
export function ModelTemplateGovernancePanel({ businessId }: { businessId: string }) {
  const modelTemplatesPath = `/businesses/${businessId}/model-templates`;
  const mutationRevision = useApiMutationRevision(modelTemplatesPath);
  const { isPending, runAction } = useAsyncActions();

  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [versions, setVersions] = useState<TemplateVersionSummary[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [observations, setObservations] = useState<ObservationRecord[]>([]);
  const [observationDraft, setObservationDraft] = useState<ObservationDraft>(emptyObservationDraft);

  const [corrections, setCorrections] = useState<CorrectionRecord[]>([]);
  const [correctionDraft, setCorrectionDraft] = useState<CorrectionDraft>(emptyCorrectionDraft);

  const [datasets, setDatasets] = useState<DatasetVersionSummary[]>([]);
  const [datasetDraft, setDatasetDraft] = useState<DatasetDraft>(emptyDatasetDraft);
  const [datasetSelection, setDatasetSelection] = useState<Record<string, boolean>>({});

  const [improvementRuns, setImprovementRuns] = useState<ImprovementRunSummary[]>([]);
  const [improvementDraft, setImprovementDraft] = useState<ImprovementDraft>(emptyImprovementDraft);

  const [promoteDraft, setPromoteDraft] = useState<PromoteDraft>(emptyPromoteDraft);
  const [exportVersionId, setExportVersionId] = useState("");
  const [lastPromotion, setLastPromotion] = useState<PromotionResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    getJson<{ templates: TemplateSummary[] }>(modelTemplatesPath)
      .then((result) => {
        if (cancelled) return;
        setTemplates(result.templates);
        setSelectedTemplateId((current) =>
          current !== "" && result.templates.some((template) => template.id === current)
            ? current
            : (result.templates[0]?.id ?? "")
        );
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(getUserFacingErrorMessage(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [modelTemplatesPath, mutationRevision]);

  useEffect(() => {
    if (selectedTemplateId === "") {
      setVersions([]);
      return;
    }
    let cancelled = false;
    getJson<{ versions: TemplateVersionSummary[] }>(
      `${modelTemplatesPath}/${encodeURIComponent(selectedTemplateId)}/versions`
    )
      .then((result) => {
        if (!cancelled) setVersions(result.versions);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(getUserFacingErrorMessage(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [modelTemplatesPath, selectedTemplateId, mutationRevision]);

  const selectedTemplate = templates?.find((template) => template.id === selectedTemplateId) ?? null;
  const templateObservations = observations.filter((item) => item.templateId === selectedTemplateId);
  const templateCorrections = corrections.filter((item) => item.templateId === selectedTemplateId);
  const templateDatasets = datasets.filter((item) => item.templateId === selectedTemplateId);
  const templateImprovementRuns = improvementRuns.filter(
    (item) => item.templateId === selectedTemplateId
  );
  const correctableObservations = templateObservations.filter(
    (item) => item.state === "CANDIDATE_FAILURE" || item.state === "REVIEWED"
  );
  const approvedCorrections = templateCorrections.filter((item) => item.status === "APPROVED");
  const completedRunsWithCandidate = templateImprovementRuns.filter(
    (run) => run.status === "COMPLETED" && run.candidateVersionId !== null
  );

  function versionLabel(versionId: string): string {
    const version = versions.find((item) => item.id === versionId);
    return version === undefined ? shortId(versionId) : `v${version.version} (${version.state})`;
  }

  async function captureObservation() {
    if (selectedTemplateId === "") throw new Error("Select a template first.");
    if (observationDraft.templateVersionId === "") throw new Error("Select a template version.");
    const input = parseRequiredJson(observationDraft.input, "Observation input");
    const output = parseRequiredJson(observationDraft.output, "Observation output");
    const created = await postJson<ObservationRecord>(
      `${modelTemplatesPath}/${encodeURIComponent(selectedTemplateId)}/observations`,
      {
        templateVersionId: observationDraft.templateVersionId,
        input,
        output,
        suspectedFailure: observationDraft.suspectedFailure,
        failureReason: observationDraft.failureReason.trim() || null,
        sourceConversationId: observationDraft.sourceConversationId.trim() || null
      }
    );
    setObservations((current) => [created, ...current]);
    setObservationDraft(emptyObservationDraft);
    setMessage("Observation captured.");
  }

  async function reviewObservation(observation: ObservationRecord, isFailure: boolean) {
    const reason =
      isFailure && observation.failureReason !== null && observation.failureReason.trim().length > 0
        ? observation.failureReason
        : undefined;
    const updated = await postJson<ObservationRecord>(
      `/businesses/${businessId}/observations/${encodeURIComponent(observation.id)}/review`,
      { isFailure, ...(reason === undefined ? {} : { reason }) }
    );
    setObservations((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    setMessage(isFailure ? "Observation marked as a failure." : "Observation marked correct.");
  }

  async function submitCorrection() {
    if (selectedTemplateId === "") throw new Error("Select a template first.");
    if (correctionDraft.observationId === "") throw new Error("Select an observation to correct.");
    if (correctionDraft.explanation.trim().length === 0) {
      throw new Error("Explain what the correction changes.");
    }
    const correctedOutput = parseRequiredJson(correctionDraft.correctedOutput, "Corrected output");
    const created = await postJson<CorrectionRecord>(
      `${modelTemplatesPath}/${encodeURIComponent(selectedTemplateId)}/corrections`,
      {
        observationId: correctionDraft.observationId,
        correctedOutput,
        explanation: correctionDraft.explanation.trim(),
        rubric: correctionDraft.rubric.trim() || null
      }
    );
    setCorrections((current) => [created, ...current]);
    setCorrectionDraft(emptyCorrectionDraft);
    setMessage("Correction submitted for approval.");
  }

  async function decideCorrection(correction: CorrectionRecord, approve: boolean) {
    const updated = await postJson<CorrectionRecord>(
      `/businesses/${businessId}/corrections/${encodeURIComponent(correction.id)}/approval`,
      { approve }
    );
    setCorrections((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    setMessage(approve ? "Correction approved." : "Correction rejected.");
  }

  async function buildDataset() {
    if (selectedTemplateId === "") throw new Error("Select a template first.");
    if (datasetDraft.name.trim().length === 0) throw new Error("Name the dataset.");
    const selectedCorrectionIds = Object.entries(datasetSelection)
      .filter(([, checked]) => checked)
      .map(([correctionId]) => correctionId);
    if (selectedCorrectionIds.length === 0) {
      throw new Error("Select at least one approved correction.");
    }
    const result = await postJson<{ dataset: DatasetVersionSummary }>(
      `${modelTemplatesPath}/${encodeURIComponent(selectedTemplateId)}/datasets`,
      {
        name: datasetDraft.name.trim(),
        examples: selectedCorrectionIds.map((correctionId) => ({
          correctionId,
          evaluationCaseId: null,
          split: datasetDraft.split
        }))
      }
    );
    setDatasets((current) => [result.dataset, ...current]);
    setDatasetDraft(emptyDatasetDraft);
    setDatasetSelection({});
    setMessage(`Dataset "${result.dataset.name}" built with ${result.dataset.exampleCount} example(s).`);
  }

  async function startImprovementRun() {
    if (selectedTemplateId === "") throw new Error("Select a template first.");
    if (improvementDraft.parentVersionId === "") throw new Error("Select a parent version.");
    if (improvementDraft.datasetVersionId === "") throw new Error("Select a dataset version.");
    if (improvementDraft.evaluationSuiteId.trim().length === 0) {
      throw new Error("Enter an evaluation suite id.");
    }
    if (improvementDraft.targetBaseModelId.trim().length === 0) {
      throw new Error("Enter a target base model id.");
    }
    const strategyConfig = parseOptionalJsonRecord(
      improvementDraft.strategyConfig,
      "Strategy config"
    );
    const created = await postJson<ImprovementRunSummary>(
      `${modelTemplatesPath}/${encodeURIComponent(selectedTemplateId)}/improvement-runs`,
      {
        parentVersionId: improvementDraft.parentVersionId,
        datasetVersionId: improvementDraft.datasetVersionId,
        evaluationSuiteId: improvementDraft.evaluationSuiteId.trim(),
        targetBaseModelId: improvementDraft.targetBaseModelId.trim(),
        strategy: improvementDraft.strategy,
        strategyConfig
      }
    );
    setImprovementRuns((current) => [created, ...current]);
    setMessage(
      created.status === "COMPLETED"
        ? "Improvement run completed with a new candidate version."
        : `Improvement run ${created.status.toLowerCase()}.`
    );
  }

  async function refreshImprovementRun(run: ImprovementRunSummary) {
    const updated = await getJson<ImprovementRunSummary>(
      `/businesses/${businessId}/improvement-runs/${encodeURIComponent(run.id)}`
    );
    setImprovementRuns((current) => current.map((item) => (item.id === updated.id ? updated : item)));
  }

  async function promote() {
    if (selectedTemplateId === "") throw new Error("Select a template first.");
    if (promoteDraft.candidateVersionId === "") throw new Error("Select a candidate version.");
    if (promoteDraft.evaluationRunId.trim().length === 0) {
      throw new Error("Enter the completed evaluation run id for this candidate.");
    }
    const body: Record<string, unknown> = {
      candidateVersionId: promoteDraft.candidateVersionId,
      evaluationRunId: promoteDraft.evaluationRunId.trim()
    };
    if (promoteDraft.maxRegressions.trim() !== "") {
      body.maxRegressions = Number(promoteDraft.maxRegressions);
    }
    if (promoteDraft.minimumScoreDelta.trim() !== "") {
      body.minimumScoreDelta = Number(promoteDraft.minimumScoreDelta);
    }
    const result = await postJson<PromotionResult>(
      `${modelTemplatesPath}/${encodeURIComponent(selectedTemplateId)}/promotions`,
      body
    );
    setLastPromotion(result);
    setMessage(
      result.decision === "PROMOTED"
        ? "Candidate promoted to production."
        : `Promotion rejected by the gates: ${result.reason}`
    );
  }

  async function rollback() {
    if (selectedTemplateId === "") throw new Error("Select a template first.");
    const result = await postJson<PromotionResult>(
      `${modelTemplatesPath}/${encodeURIComponent(selectedTemplateId)}/rollback`,
      {}
    );
    setLastPromotion(result);
    setMessage("Rolled back to the previous production version.");
  }

  async function exportVersion() {
    if (exportVersionId === "") throw new Error("Select a version to export.");
    const result = await getJson<ExportResult>(
      `/businesses/${businessId}/model-template-versions/${encodeURIComponent(exportVersionId)}/export`
    );
    downloadJsonFile(result.fileName, result);
    setMessage(`Exported ${result.fileName}.`);
  }

  function run(key: string, action: () => Promise<void>) {
    void runAction(key, async () => {
      setError("");
      try {
        await action();
      } catch (cause) {
        setError(getUserFacingErrorMessage(cause));
      }
    });
  }

  function handlePromoteClick() {
    if (
      !window.confirm(
        `Promote this candidate to production for ${selectedTemplate?.name ?? "this template"}? This changes what's live for merchants.`
      )
    ) {
      return;
    }
    run("governance-promote", promote);
  }

  function handleRollbackClick() {
    if (
      !window.confirm(
        `Roll back ${selectedTemplate?.name ?? "this template"} to its previous production version? This changes what's live for merchants.`
      )
    ) {
      return;
    }
    run("governance-rollback", rollback);
  }

  if (templates === null) {
    return (
      <section className="record-form model-template-governance-panel" aria-label="Model governance">
        {error.length > 0 ? <p className="security-warning">{error}</p> : <p>Loading model templates…</p>}
      </section>
    );
  }

  return (
    <section
      className="record-form model-template-governance-panel"
      aria-label="Model template governance"
    >
      <div className="section-heading">
        <p className="eyebrow">Recursive expertise flywheel</p>
        <h3>Model Template governance</h3>
        <p>Capture production observations, correct them, retrain, and promote or roll back.</p>
      </div>
      {message.length > 0 ? <p className="shell-note">{message}</p> : null}
      {error.length > 0 ? <p className="security-warning">{error}</p> : null}

      {templates.length === 0 ? (
        <p className="shell-note">No model templates exist yet for this business.</p>
      ) : (
        <label>
          Template
          <select
            value={selectedTemplateId}
            onChange={(event) => setSelectedTemplateId(event.target.value)}
          >
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {selectedTemplate === null ? null : (
        <>
          {/* Observations */}
          <div className="nested-card">
            <div className="nested-card-title-row">
              <h3>Production observations</h3>
            </div>
            <p>
              Observations captured or reviewed this session — this domain has no listing endpoint
              yet, so only what you capture here is shown.
            </p>
            <label>
              Template version
              <select
                value={observationDraft.templateVersionId}
                onChange={(event) =>
                  setObservationDraft((current) => ({
                    ...current,
                    templateVersionId: event.target.value
                  }))
                }
              >
                <option value="">Select a version…</option>
                {versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {versionLabel(version.id)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Input (JSON)
              <textarea
                value={observationDraft.input}
                onChange={(event) =>
                  setObservationDraft((current) => ({ ...current, input: event.target.value }))
                }
                placeholder='{"message": "..."}'
              />
            </label>
            <label>
              Output (JSON)
              <textarea
                value={observationDraft.output}
                onChange={(event) =>
                  setObservationDraft((current) => ({ ...current, output: event.target.value }))
                }
                placeholder='{"reply": "..."}'
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={observationDraft.suspectedFailure}
                onChange={(event) =>
                  setObservationDraft((current) => ({
                    ...current,
                    suspectedFailure: event.target.checked
                  }))
                }
              />
              Suspected failure
            </label>
            <label>
              Failure reason (optional)
              <input
                value={observationDraft.failureReason}
                onChange={(event) =>
                  setObservationDraft((current) => ({
                    ...current,
                    failureReason: event.target.value
                  }))
                }
              />
            </label>
            <label>
              Source conversation id (optional)
              <input
                value={observationDraft.sourceConversationId}
                onChange={(event) =>
                  setObservationDraft((current) => ({
                    ...current,
                    sourceConversationId: event.target.value
                  }))
                }
              />
            </label>
            <div className="row-actions">
              <button
                type="button"
                disabled={isPending("governance-capture-observation")}
                onClick={() => run("governance-capture-observation", captureObservation)}
              >
                Capture observation
              </button>
            </div>

            {templateObservations.length === 0 ? (
              <p className="shell-note">No observations captured yet for this template.</p>
            ) : (
              templateObservations.map((observation) => (
                <article className="nested-card" key={observation.id}>
                  <div className="nested-card-title-row">
                    <div>
                      <p className="eyebrow">Observation {shortId(observation.id)}</p>
                      <p>
                        {observation.failureReason ?? "No failure reason recorded."}
                        {observation.riskFlags.length > 0
                          ? ` · flags: ${observation.riskFlags.join(", ")}`
                          : ""}
                      </p>
                    </div>
                    <span className="model-badge status-ready">{observation.state}</span>
                  </div>
                  {observation.state === "OBSERVED" || observation.state === "CANDIDATE_FAILURE" ? (
                    <div className="row-actions">
                      <button
                        type="button"
                        className="secondary"
                        disabled={isPending(`governance-review-${observation.id}-ok`)}
                        onClick={() =>
                          run(`governance-review-${observation.id}-ok`, () =>
                            reviewObservation(observation, false)
                          )
                        }
                      >
                        Mark correct
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={isPending(`governance-review-${observation.id}-fail`)}
                        onClick={() =>
                          run(`governance-review-${observation.id}-fail`, () =>
                            reviewObservation(observation, true)
                          )
                        }
                      >
                        Mark failure
                      </button>
                    </div>
                  ) : null}
                </article>
              ))
            )}
          </div>

          {/* Corrections */}
          <div className="nested-card">
            <div className="nested-card-title-row">
              <h3>Expert corrections</h3>
            </div>
            <label>
              Observation to correct
              <select
                value={correctionDraft.observationId}
                onChange={(event) =>
                  setCorrectionDraft((current) => ({
                    ...current,
                    observationId: event.target.value
                  }))
                }
              >
                <option value="">Select an observation…</option>
                {correctableObservations.map((observation) => (
                  <option key={observation.id} value={observation.id}>
                    {shortId(observation.id)} ({observation.state})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Corrected output (JSON)
              <textarea
                value={correctionDraft.correctedOutput}
                onChange={(event) =>
                  setCorrectionDraft((current) => ({
                    ...current,
                    correctedOutput: event.target.value
                  }))
                }
                placeholder='{"reply": "..."}'
              />
            </label>
            <label>
              Explanation
              <textarea
                value={correctionDraft.explanation}
                onChange={(event) =>
                  setCorrectionDraft((current) => ({ ...current, explanation: event.target.value }))
                }
              />
            </label>
            <label>
              Rubric (optional)
              <input
                value={correctionDraft.rubric}
                onChange={(event) =>
                  setCorrectionDraft((current) => ({ ...current, rubric: event.target.value }))
                }
              />
            </label>
            <div className="row-actions">
              <button
                type="button"
                disabled={isPending("governance-submit-correction")}
                onClick={() => run("governance-submit-correction", submitCorrection)}
              >
                Submit correction
              </button>
            </div>

            {templateCorrections.length === 0 ? (
              <p className="shell-note">No corrections submitted yet for this template.</p>
            ) : (
              templateCorrections.map((correction) => (
                <article className="nested-card" key={correction.id}>
                  <div className="nested-card-title-row">
                    <div>
                      <p className="eyebrow">Correction {shortId(correction.id)}</p>
                      <p>{correction.explanation}</p>
                    </div>
                    <span className="model-badge status-ready">{correction.status}</span>
                  </div>
                  {correction.status === "SUBMITTED" ? (
                    <div className="row-actions">
                      <button
                        type="button"
                        className="secondary"
                        disabled={isPending(`governance-correction-${correction.id}-approve`)}
                        onClick={() =>
                          run(`governance-correction-${correction.id}-approve`, () =>
                            decideCorrection(correction, true)
                          )
                        }
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={isPending(`governance-correction-${correction.id}-reject`)}
                        onClick={() =>
                          run(`governance-correction-${correction.id}-reject`, () =>
                            decideCorrection(correction, false)
                          )
                        }
                      >
                        Reject
                      </button>
                    </div>
                  ) : null}
                </article>
              ))
            )}
          </div>

          {/* Datasets + improvement runs */}
          <div className="nested-card">
            <div className="nested-card-title-row">
              <h3>Training dataset</h3>
            </div>
            {approvedCorrections.length === 0 ? (
              <p className="shell-note">Approve a correction above before building a dataset.</p>
            ) : (
              approvedCorrections.map((correction) => (
                <label key={correction.id}>
                  <input
                    type="checkbox"
                    checked={datasetSelection[correction.id] === true}
                    onChange={(event) =>
                      setDatasetSelection((current) => ({
                        ...current,
                        [correction.id]: event.target.checked
                      }))
                    }
                  />
                  {shortId(correction.id)} — {correction.explanation}
                </label>
              ))
            )}
            <label>
              Dataset name
              <input
                value={datasetDraft.name}
                onChange={(event) =>
                  setDatasetDraft((current) => ({ ...current, name: event.target.value }))
                }
              />
            </label>
            <label>
              Split
              <select
                value={datasetDraft.split}
                onChange={(event) =>
                  setDatasetDraft((current) => ({
                    ...current,
                    split: event.target.value as DatasetSplit
                  }))
                }
              >
                {datasetSplits.map((split) => (
                  <option key={split} value={split}>
                    {split}
                  </option>
                ))}
              </select>
            </label>
            <div className="row-actions">
              <button
                type="button"
                disabled={isPending("governance-build-dataset")}
                onClick={() => run("governance-build-dataset", buildDataset)}
              >
                Build dataset from approved corrections
              </button>
            </div>
            {templateDatasets.length === 0 ? (
              <p className="shell-note">No datasets built yet for this template.</p>
            ) : (
              templateDatasets.map((dataset) => (
                <p key={dataset.id} className="shell-note">
                  {dataset.name} — v{dataset.version}, {dataset.exampleCount} example(s)
                </p>
              ))
            )}
          </div>

          <div className="nested-card">
            <div className="nested-card-title-row">
              <h3>Improvement run</h3>
            </div>
            <label>
              Parent version
              <select
                value={improvementDraft.parentVersionId}
                onChange={(event) =>
                  setImprovementDraft((current) => ({
                    ...current,
                    parentVersionId: event.target.value
                  }))
                }
              >
                <option value="">Select a version…</option>
                {versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {versionLabel(version.id)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Dataset version
              <select
                value={improvementDraft.datasetVersionId}
                onChange={(event) =>
                  setImprovementDraft((current) => ({
                    ...current,
                    datasetVersionId: event.target.value
                  }))
                }
              >
                <option value="">Select a dataset…</option>
                {templateDatasets.map((dataset) => (
                  <option key={dataset.id} value={dataset.id}>
                    {dataset.name} (v{dataset.version})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Evaluation suite id
              <input
                value={improvementDraft.evaluationSuiteId}
                onChange={(event) =>
                  setImprovementDraft((current) => ({
                    ...current,
                    evaluationSuiteId: event.target.value
                  }))
                }
              />
            </label>
            <label>
              Target base model id
              <input
                value={improvementDraft.targetBaseModelId}
                onChange={(event) =>
                  setImprovementDraft((current) => ({
                    ...current,
                    targetBaseModelId: event.target.value
                  }))
                }
              />
            </label>
            <label>
              Strategy
              <select
                value={improvementDraft.strategy}
                onChange={(event) =>
                  setImprovementDraft((current) => ({
                    ...current,
                    strategy: event.target.value as OptimizationStrategy
                  }))
                }
              >
                {optimizationStrategies.map((strategy) => (
                  <option key={strategy} value={strategy}>
                    {strategy}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Strategy config (optional JSON)
              <textarea
                value={improvementDraft.strategyConfig}
                onChange={(event) =>
                  setImprovementDraft((current) => ({
                    ...current,
                    strategyConfig: event.target.value
                  }))
                }
                placeholder="{}"
              />
            </label>
            <div className="row-actions">
              <button
                type="button"
                disabled={isPending("governance-start-improvement")}
                onClick={() => run("governance-start-improvement", startImprovementRun)}
              >
                Start improvement run
              </button>
            </div>
            {templateImprovementRuns.length === 0 ? (
              <p className="shell-note">No improvement runs started yet for this template.</p>
            ) : (
              templateImprovementRuns.map((run_) => (
                <article className="nested-card" key={run_.id}>
                  <div className="nested-card-title-row">
                    <div>
                      <p className="eyebrow">Run {shortId(run_.id)}</p>
                      <p>
                        {run_.strategy}
                        {run_.candidateVersionId === null
                          ? ""
                          : ` · candidate ${versionLabel(run_.candidateVersionId)}`}
                        {run_.errorCode === null ? "" : ` · ${run_.errorCode}`}
                      </p>
                    </div>
                    <span className="model-badge status-ready">{run_.status}</span>
                  </div>
                  <div className="row-actions">
                    <button
                      type="button"
                      className="secondary"
                      disabled={isPending(`governance-refresh-run-${run_.id}`)}
                      onClick={() =>
                        run(`governance-refresh-run-${run_.id}`, () => refreshImprovementRun(run_))
                      }
                    >
                      Refresh status
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>

          {/* Promote / rollback / export */}
          <div className="nested-card">
            <div className="nested-card-title-row">
              <h3>Promote a version live</h3>
            </div>
            <p className="shell-note">
              Currently live: {selectedTemplate.productionVersionId === null
                ? "no promoted version"
                : versionLabel(selectedTemplate.productionVersionId)}
            </p>
            <label>
              Candidate version
              <select
                value={promoteDraft.candidateVersionId}
                onChange={(event) =>
                  setPromoteDraft((current) => ({
                    ...current,
                    candidateVersionId: event.target.value
                  }))
                }
              >
                <option value="">Select a candidate…</option>
                {completedRunsWithCandidate.map((completedRun) => (
                  <option key={completedRun.id} value={completedRun.candidateVersionId ?? ""}>
                    {versionLabel(completedRun.candidateVersionId ?? "")} (run{" "}
                    {shortId(completedRun.id)})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Evaluation run id (completed, for this candidate)
              <input
                value={promoteDraft.evaluationRunId}
                onChange={(event) =>
                  setPromoteDraft((current) => ({ ...current, evaluationRunId: event.target.value }))
                }
              />
            </label>
            <label>
              Max regressions allowed (optional)
              <input
                value={promoteDraft.maxRegressions}
                onChange={(event) =>
                  setPromoteDraft((current) => ({ ...current, maxRegressions: event.target.value }))
                }
              />
            </label>
            <label>
              Minimum score delta (optional)
              <input
                value={promoteDraft.minimumScoreDelta}
                onChange={(event) =>
                  setPromoteDraft((current) => ({
                    ...current,
                    minimumScoreDelta: event.target.value
                  }))
                }
              />
            </label>
            <div className="row-actions">
              <button
                type="button"
                className="danger"
                disabled={isPending("governance-promote")}
                onClick={handlePromoteClick}
              >
                Promote to production
              </button>
              <button
                type="button"
                className="danger"
                disabled={
                  isPending("governance-rollback") ||
                  selectedTemplate.previousProductionVersionId === null
                }
                onClick={handleRollbackClick}
              >
                Roll back to previous version
              </button>
            </div>
            {lastPromotion === null ? null : (
              <p className="shell-note">
                Last decision: {lastPromotion.decision} — {lastPromotion.reason}
              </p>
            )}
          </div>

          <div className="nested-card">
            <div className="nested-card-title-row">
              <h3>Export a version</h3>
            </div>
            <label>
              Version
              <select
                value={exportVersionId}
                onChange={(event) => setExportVersionId(event.target.value)}
              >
                <option value="">Select a version…</option>
                {versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {versionLabel(version.id)}
                  </option>
                ))}
              </select>
            </label>
            <div className="row-actions">
              <button
                type="button"
                disabled={isPending("governance-export")}
                onClick={() => run("governance-export", exportVersion)}
              >
                Export version
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
