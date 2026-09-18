import { randomUUID } from "node:crypto";
import { Cp2Error } from "../../cp2-error.js";
import { canonicalJson, sha256 } from "./manifest.js";

export type VocabStatus = "CANDIDATE" | "APPROVED" | "REJECTED";

export type VocabResolution =
  { resolved: true; raw: string; canonicalTerm: string } | { resolved: false; raw: string };

export interface VocabularyOccurrenceRecord {
  id: string;
  vocabularyEntryId: string;
  businessId: string;
  accountId: string;
  surfaceForm: string;
  sourceSessionId: string | null;
  submittedBy: string | null;
  observedCanonicalTerm: string | null;
  context: string | null;
  createdAt: string;
}

export interface VocabularyEntryRecord {
  id: string;
  businessId: string;
  accountId: string;
  surfaceForm: string;
  canonicalTerm: string | null;
  status: VocabStatus;
  sourceSessionId: string | null;
  submittedBy: string | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  occurrences: VocabularyOccurrenceRecord[];
}

export interface VocabularySnapshot {
  vocabularyEntries?: VocabularyEntryRecord[];
  vocabularyOccurrences?: VocabularyOccurrenceRecord[];
  cacheLoaded?: boolean;
}

interface AuthorizedActor {
  account: { id: string };
  user: { id: string };
}

export interface VocabularyDomainDeps {
  requireAccess: (
    sessionId: string | null,
    businessId: string,
    permission: "business:read" | "launch:write",
    now: Date
  ) => AuthorizedActor;
}

export class VocabularyDomain {
  private readonly entries = new Map<string, VocabularyEntryRecord>();
  private readonly occurrences = new Map<string, VocabularyOccurrenceRecord>();
  private approvedCache = new Map<string, string>();
  private loadState: { loaded: true } | { loaded: false; error: Error | null } = {
    loaded: false,
    error: null
  };

  constructor(private readonly deps: VocabularyDomainDeps) {}

  get vocabularyEntriesMap(): ReadonlyMap<string, VocabularyEntryRecord> {
    return this.entries;
  }

  get vocabularyOccurrencesMap(): ReadonlyMap<string, VocabularyOccurrenceRecord> {
    return this.occurrences;
  }

  restore(snapshot: VocabularySnapshot): void {
    this.entries.clear();
    this.occurrences.clear();
    for (const entry of snapshot.vocabularyEntries ?? []) {
      this.entries.set(entry.id, cloneEntry(entry));
    }
    for (const occurrence of snapshot.vocabularyOccurrences ?? []) {
      this.occurrences.set(occurrence.id, { ...occurrence });
    }
    this.rebuildApprovedCache();
    this.loadState =
      snapshot.cacheLoaded === false ? { loaded: false, error: null } : { loaded: true };
  }

  clear(): void {
    this.entries.clear();
    this.occurrences.clear();
    this.approvedCache.clear();
    this.loadState = { loaded: false, error: null };
  }

  initializeApprovedCache(): void {
    this.rebuildApprovedCache();
    this.loadState = { loaded: true };
  }

  markCacheLoadFailed(error: Error): void {
    this.approvedCache.clear();
    this.loadState = { loaded: false, error };
  }

  resolveVocabulary(term: string): VocabResolution {
    if (!this.loadState.loaded) {
      throw new Cp2Error(
        503,
        "VOCABULARY_CACHE_UNAVAILABLE",
        this.loadState.error?.message ?? "Approved vocabulary cache has not been initialized."
      );
    }
    const canonicalTerm = this.approvedCache.get(term);
    return canonicalTerm === undefined
      ? { resolved: false, raw: term }
      : { resolved: true, raw: term, canonicalTerm };
  }

  mapVocabularyText(text: string): {
    mappedText: string;
    resolutions: VocabResolution[];
  } {
    const resolutions: VocabResolution[] = [];
    const mappedText = text.replace(/\S+/gu, (token) => {
      const resolution = this.resolveVocabulary(token);
      resolutions.push(resolution);
      return resolution.resolved ? resolution.canonicalTerm : `[UNK:${resolution.raw}]`;
    });
    return { mappedText, resolutions };
  }

  recordUnknownTerm(input: {
    sessionId: string | null;
    businessId: string;
    surfaceForm: string;
    sourceSessionId?: string | null;
    observedCanonicalTerm?: string | null;
    context?: string | null;
  }): VocabularyEntryRecord {
    const now = new Date();
    const actor = this.requireRead(input.sessionId, input.businessId, now);
    const surfaceForm = requireSurface(input.surfaceForm);
    let entry = [...this.entries.values()].find(
      (candidate) =>
        candidate.businessId === input.businessId && candidate.surfaceForm === surfaceForm
    );
    if (entry === undefined) {
      entry = {
        id: randomUUID(),
        businessId: input.businessId,
        accountId: actor.account.id,
        surfaceForm,
        canonicalTerm: input.observedCanonicalTerm ?? null,
        status: "CANDIDATE",
        sourceSessionId: input.sourceSessionId ?? null,
        submittedBy: actor.user.id,
        createdAt: now.toISOString(),
        reviewedAt: null,
        reviewedBy: null,
        occurrences: []
      };
      this.entries.set(entry.id, entry);
    }
    const occurrence: VocabularyOccurrenceRecord = {
      id: randomUUID(),
      vocabularyEntryId: entry.id,
      businessId: input.businessId,
      accountId: actor.account.id,
      surfaceForm,
      sourceSessionId: input.sourceSessionId ?? null,
      submittedBy: actor.user.id,
      observedCanonicalTerm: input.observedCanonicalTerm ?? null,
      context: input.context ?? null,
      createdAt: now.toISOString()
    };
    this.occurrences.set(occurrence.id, occurrence);
    entry.occurrences = [...entry.occurrences, occurrence];
    if (entry.canonicalTerm === null && input.observedCanonicalTerm !== undefined) {
      entry.canonicalTerm = input.observedCanonicalTerm;
    }
    return cloneEntry(entry);
  }

  listVocabularyCandidates(input: {
    sessionId: string | null;
    businessId: string;
  }): VocabularyEntryRecord[] {
    this.requireWrite(input.sessionId, input.businessId, new Date());
    return [...this.entries.values()]
      .filter((entry) => entry.businessId === input.businessId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(cloneEntry);
  }

  reviewVocabularyEntry(input: {
    sessionId: string | null;
    businessId: string;
    vocabularyEntryId: string;
    action: "APPROVE" | "REJECT";
    canonicalTerm?: string | null;
  }): VocabularyEntryRecord {
    const now = new Date();
    const actor = this.requireWrite(input.sessionId, input.businessId, now);
    const entry = this.entries.get(input.vocabularyEntryId);
    if (entry === undefined || entry.businessId !== input.businessId) {
      throw new Cp2Error(404, "VOCABULARY_ENTRY_NOT_FOUND", "Vocabulary entry was not found.");
    }
    if (input.action === "APPROVE") {
      const canonicalTerm = requireSurface(input.canonicalTerm ?? entry.canonicalTerm ?? "");
      entry.status = "APPROVED";
      entry.canonicalTerm = canonicalTerm;
      this.approvedCache.set(entry.surfaceForm, canonicalTerm);
    } else {
      entry.status = "REJECTED";
      this.approvedCache.delete(entry.surfaceForm);
    }
    entry.reviewedAt = now.toISOString();
    entry.reviewedBy = actor.user.id;
    return cloneEntry(entry);
  }

  currentVocabularySnapshotId(): string {
    return computeVocabularySnapshotId(
      [...this.entries.values()]
        .filter(isApprovedMapping)
        .map((entry) => ({ surfaceForm: entry.surfaceForm, canonicalTerm: entry.canonicalTerm }))
    );
  }

  deleteBusinessData(businessId: string): number {
    let deleted = 0;
    for (const [id, entry] of [...this.entries]) {
      if (entry.businessId === businessId) {
        this.entries.delete(id);
        deleted += 1;
      }
    }
    for (const [id, occurrence] of [...this.occurrences]) {
      if (occurrence.businessId === businessId) {
        this.occurrences.delete(id);
        deleted += 1;
      }
    }
    this.rebuildApprovedCache();
    return deleted;
  }

  deleteBusinessesInScope(scope: ReadonlySet<string>): number {
    let deleted = 0;
    for (const businessId of scope) deleted += this.deleteBusinessData(businessId);
    return deleted;
  }

  private rebuildApprovedCache(): void {
    this.approvedCache = new Map(
      [...this.entries.values()]
        .filter((entry) => entry.status === "APPROVED" && entry.canonicalTerm !== null)
        .map((entry) => [entry.surfaceForm, entry.canonicalTerm as string])
    );
  }

  private requireRead(sessionId: string | null, businessId: string, now: Date): AuthorizedActor {
    return this.deps.requireAccess(sessionId, businessId, "business:read", now);
  }

  private requireWrite(sessionId: string | null, businessId: string, now: Date): AuthorizedActor {
    return this.deps.requireAccess(sessionId, businessId, "launch:write", now);
  }
}

export function computeVocabularySnapshotId(
  entries: Array<{ surfaceForm: string; canonicalTerm: string }>
): string {
  const stable = entries
    .map((entry) => ({ surfaceForm: entry.surfaceForm, canonicalTerm: entry.canonicalTerm }))
    .sort((a, b) => a.surfaceForm.localeCompare(b.surfaceForm));
  return sha256(canonicalJson(stable));
}

function requireSurface(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Cp2Error(400, "VOCABULARY_TERM_REQUIRED", "Vocabulary terms cannot be empty.");
  }
  return trimmed;
}

function cloneEntry(entry: VocabularyEntryRecord): VocabularyEntryRecord {
  return {
    ...entry,
    occurrences: entry.occurrences.map((occurrence) => ({ ...occurrence }))
  };
}

function isApprovedMapping(
  entry: VocabularyEntryRecord
): entry is VocabularyEntryRecord & { canonicalTerm: string } {
  return entry.status === "APPROVED" && entry.canonicalTerm !== null;
}
