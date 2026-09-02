import { useEffect, useState } from "react";

import { getJson } from "./api-helpers";

interface TemplateSummary {
  id: string;
  name: string;
  productionVersionId: string | null;
}

interface TemplatePromotion {
  evaluationRunId: string;
  candidateVersionId: string;
  decision: "PROMOTED" | "REJECTED" | "ROLLED_BACK";
  createdAt: string;
}

interface TemplateLineage {
  promotions: TemplatePromotion[];
}

export interface ModelTemplateReportCard {
  templateId: string;
  templateName: string;
  version: string;
  state: string;
  baseModelId: string;
  previousVersion: string | null;
  scoreDelta: number | null;
  promptTokenReductionPercent: number | null;
  correctionsIncorporated: number;
  metrics: {
    taskSuccessRate: number;
    passed: number;
    total: number;
    regressionCount: number;
    medianLatencyMs: number;
    promptTokens: number;
    artifactSizeBytes: number;
  };
}

export function ModelTemplateReportCardPanel({ businessId }: { businessId: string }) {
  const [cards, setCards] = useState<ModelTemplateReportCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const listed = await getJson<{ templates: TemplateSummary[] }>(
          `/businesses/${businessId}/model-templates`
        );
        const loaded = await Promise.all(
          listed.templates
            .filter((template) => template.productionVersionId !== null)
            .map(async (template) => {
              const lineage = await getJson<TemplateLineage>(
                `/businesses/${businessId}/model-templates/${encodeURIComponent(template.id)}/lineage`
              );
              const promotion = lineage.promotions
                .filter(
                  (item) =>
                    item.decision === "PROMOTED" &&
                    item.candidateVersionId === template.productionVersionId
                )
                .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
              if (promotion === undefined) return null;
              return getJson<ModelTemplateReportCard>(
                `/businesses/${businessId}/evaluations/${encodeURIComponent(promotion.evaluationRunId)}/report-card`
              );
            })
        );
        if (!cancelled)
          setCards(loaded.filter((item): item is ModelTemplateReportCard => item !== null));
      } catch (cause) {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : "Report cards could not be loaded.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  return (
    <div className="record-form model-template-report-panel">
      <div className="section-heading">
        <p className="eyebrow">Executable expertise</p>
        <h3>Model Template report cards</h3>
        <p>Evidence from the evaluation lifecycle, independent of the selected foundation model.</p>
      </div>
      {loading ? <p className="shell-note">Loading report cards…</p> : null}
      {error.length > 0 ? <p className="security-warning">{error}</p> : null}
      {!loading && error.length === 0 && cards.length === 0 ? (
        <p className="shell-note">No promoted Model Template has an evaluation report yet.</p>
      ) : null}
      {cards.map((card) => (
        <article className="nested-card" key={card.templateId}>
          <div className="nested-card-title-row">
            <div>
              <p className="eyebrow">Version {card.version}</p>
              <h3>{card.templateName}</h3>
              <p>
                Base {card.baseModelId}
                {card.previousVersion === null ? "" : ` · previous ${card.previousVersion}`}
              </p>
            </div>
            <span className="model-badge status-ready">{card.state}</span>
          </div>
          <div className="metric-grid" aria-label={`${card.templateName} evaluation metrics`}>
            <div className="metric">
              <span>Task score</span>
              <strong>{card.metrics.taskSuccessRate}%</strong>
            </div>
            <div className="metric">
              <span>Passed</span>
              <strong>
                {card.metrics.passed}/{card.metrics.total}
              </strong>
            </div>
            <div className="metric">
              <span>Regressions</span>
              <strong>{card.metrics.regressionCount}</strong>
            </div>
            <div className="metric">
              <span>Score change</span>
              <strong>{signed(card.scoreDelta)}</strong>
            </div>
            <div className="metric">
              <span>Prompt reduction</span>
              <strong>{percent(card.promptTokenReductionPercent)}</strong>
            </div>
            <div className="metric">
              <span>Corrections learned</span>
              <strong>{card.correctionsIncorporated}</strong>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function percent(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

function signed(value: number | null): string {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}
