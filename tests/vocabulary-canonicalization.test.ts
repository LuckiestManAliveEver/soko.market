import { describe, expect, it } from "vitest";
import { Cp2Error } from "../services/api/src/cp2/cp2-error";
import {
  computeVocabularySnapshotId,
  VocabularyDomain
} from "../services/api/src/cp2/domains/model-templates/vocabulary";

const actor = { account: { id: "acct-1" }, user: { id: "user-1" } };

function domain() {
  const vocabulary = new VocabularyDomain({
    requireAccess: () => actor
  });
  vocabulary.initializeApprovedCache();
  return vocabulary;
}

describe("template vocabulary canonicalization", () => {
  it("resolves only approved exact matches", () => {
    const vocabulary = domain();
    const entry = vocabulary.recordUnknownTerm({
      sessionId: "session-1",
      businessId: "shop-1",
      surfaceForm: "unga",
      observedCanonicalTerm: "maize flour"
    });

    expect(vocabulary.resolveVocabulary("shop-1", "unga")).toEqual({
      resolved: false,
      raw: "unga"
    });

    vocabulary.reviewVocabularyEntry({
      sessionId: "admin-session",
      businessId: "shop-1",
      vocabularyEntryId: entry.id,
      action: "APPROVE",
      canonicalTerm: "maize flour"
    });

    expect(vocabulary.resolveVocabulary("shop-1", "unga")).toEqual({
      resolved: true,
      raw: "unga",
      canonicalTerm: "maize flour"
    });
  });

  it("keeps candidate and rejected entries out of runtime resolution", () => {
    const vocabulary = domain();
    const candidate = vocabulary.recordUnknownTerm({
      sessionId: "session-1",
      businessId: "shop-1",
      surfaceForm: "mbosho",
      observedCanonicalTerm: "cowpeas"
    });
    const rejected = vocabulary.recordUnknownTerm({
      sessionId: "session-1",
      businessId: "shop-1",
      surfaceForm: "ndengu",
      observedCanonicalTerm: "green grams"
    });

    vocabulary.reviewVocabularyEntry({
      sessionId: "admin-session",
      businessId: "shop-1",
      vocabularyEntryId: rejected.id,
      action: "REJECT"
    });

    expect(vocabulary.resolveVocabulary("shop-1", candidate.surfaceForm)).toEqual({
      resolved: false,
      raw: candidate.surfaceForm
    });
    expect(vocabulary.resolveVocabulary("shop-1", rejected.surfaceForm)).toEqual({
      resolved: false,
      raw: rejected.surfaceForm
    });
  });

  it("treats off-by-one near matches as unknowns", () => {
    const vocabulary = domain();
    const entry = vocabulary.recordUnknownTerm({
      sessionId: "session-1",
      businessId: "shop-1",
      surfaceForm: "unga",
      observedCanonicalTerm: "maize flour"
    });
    vocabulary.reviewVocabularyEntry({
      sessionId: "admin-session",
      businessId: "shop-1",
      vocabularyEntryId: entry.id,
      action: "APPROVE",
      canonicalTerm: "maize flour"
    });

    expect(vocabulary.resolveVocabulary("shop-1", "ungaa")).toEqual({
      resolved: false,
      raw: "ungaa"
    });
  });

  it("logs repeated unknown terms as occurrence evidence without duplicate entries", () => {
    const vocabulary = domain();
    const first = vocabulary.recordUnknownTerm({
      sessionId: "session-1",
      businessId: "shop-1",
      surfaceForm: "mbosho",
      sourceSessionId: "conversation-1",
      context: "Nipe unga na mbosho"
    });
    const second = vocabulary.recordUnknownTerm({
      sessionId: "session-2",
      businessId: "shop-1",
      surfaceForm: "mbosho",
      sourceSessionId: "conversation-2",
      context: "Ongeza mbosho"
    });

    expect(second.id).toBe(first.id);
    expect(
      vocabulary.listVocabularyCandidates({ sessionId: "admin-session", businessId: "shop-1" })
    ).toHaveLength(1);
    expect(vocabulary.vocabularyOccurrencesMap.size).toBe(2);
  });

  it("makes approvals visible without rebuilding the domain", () => {
    const vocabulary = domain();
    const entry = vocabulary.recordUnknownTerm({
      sessionId: "session-1",
      businessId: "shop-1",
      surfaceForm: "unga",
      observedCanonicalTerm: "maize flour"
    });
    vocabulary.reviewVocabularyEntry({
      sessionId: "admin-session",
      businessId: "shop-1",
      vocabularyEntryId: entry.id,
      action: "APPROVE",
      canonicalTerm: "maize flour"
    });

    expect(vocabulary.resolveVocabulary("shop-1", "unga").resolved).toBe(true);
  });

  it("distinguishes cache load failure from an empty approved dictionary", () => {
    const empty = domain();
    expect(empty.resolveVocabulary("shop-1", "unga")).toEqual({ resolved: false, raw: "unga" });

    const failed = domain();
    failed.markCacheLoadFailed(new Error("database unavailable"));

    expect(() => failed.resolveVocabulary("shop-1", "unga")).toThrow(Cp2Error);
  });

  it("computes stable snapshot identity from approved resolver mappings only", () => {
    const first = computeVocabularySnapshotId([
      { surfaceForm: "unga", canonicalTerm: "maize flour" },
      { surfaceForm: "mbosho", canonicalTerm: "cowpeas" }
    ]);
    const second = computeVocabularySnapshotId([
      { surfaceForm: "mbosho", canonicalTerm: "cowpeas" },
      { surfaceForm: "unga", canonicalTerm: "maize flour" }
    ]);
    const changed = computeVocabularySnapshotId([
      { surfaceForm: "unga", canonicalTerm: "maize flour" }
    ]);

    expect(first).toBe(second);
    expect(first).not.toBe(changed);
  });

  it("isolates approved resolution and snapshot identity by business", () => {
    const vocabulary = domain();
    const entry = vocabulary.recordUnknownTerm({
      sessionId: "admin-session",
      businessId: "shop-1",
      surfaceForm: "unga"
    });
    vocabulary.reviewVocabularyEntry({
      sessionId: "admin-session",
      businessId: "shop-1",
      vocabularyEntryId: entry.id,
      action: "APPROVE",
      canonicalTerm: "flour"
    });

    expect(vocabulary.resolveVocabulary("shop-1", "unga")).toMatchObject({ resolved: true });
    expect(vocabulary.resolveVocabulary("shop-2", "unga")).toEqual({
      resolved: false,
      raw: "unga"
    });
    expect(vocabulary.currentVocabularySnapshotId("shop-1")).not.toBe(
      vocabulary.currentVocabularySnapshotId("shop-2")
    );
  });
});
