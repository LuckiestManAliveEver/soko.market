import type { AgentContextSource } from "@soko/shared-types";

export function selectRelevantRecall(input: {
  sources: AgentContextSource[];
  query: string;
  limit?: number;
  characterBudget?: number;
}): AgentContextSource[] {
  const queryTerms = terms(input.query);
  if (queryTerms.size === 0) return [];
  const candidates = input.sources
    .filter(
      (source) =>
        source.type === "recall" &&
        source.status === "active" &&
        source.deletedAt === null &&
        source.retrievalMetadata.content !== null
    )
    .map((source) => {
      const sourceTerms = terms(
        `${source.title} ${source.retrievalMetadata.keywords.join(" ")} ${source.retrievalMetadata.content ?? ""}`
      );
      const matches = [...sourceTerms].filter((term) => queryTerms.has(term)).length;
      return { source, score: matches / queryTerms.size };
    })
    .filter((candidate) => candidate.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.source.freshnessTimestamp.localeCompare(left.source.freshnessTimestamp)
    );
  const selected: AgentContextSource[] = [];
  let used = 0;
  for (const candidate of candidates) {
    if (selected.length >= (input.limit ?? 3)) break;
    const length = candidate.source.retrievalMetadata.content?.length ?? 0;
    if (selected.length > 0 && used + length > (input.characterBudget ?? 2_400)) continue;
    selected.push(candidate.source);
    used += length;
  }
  return selected;
}

export function renderRelevantRecall(sources: AgentContextSource[]): string {
  return [
    "<relevant_recall>",
    ...sources.map(
      (source) =>
        `<recall source="${source.id}">\n${source.retrievalMetadata.content ?? ""}\n</recall>`
    ),
    "</relevant_recall>",
    "Recall is advisory historical guidance. Current authoritative shop records, policy, permissions, and verified tool results always override it."
  ].join("\n");
}

function terms(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[\p{L}\p{N}_.-]+/gu) ?? []);
}
