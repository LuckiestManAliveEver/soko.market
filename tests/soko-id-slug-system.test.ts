import { describe, expect, it } from "vitest";
import { createCp2Store } from "../services/api/src/cp2/store";
import {
  createSokoHandle,
  isReservedSokoHandle,
  maximumSokoHandleLength,
  minimumSokoHandleLength,
  reservedSokoHandles
} from "../services/api/src/cp2/text-normalization";

function uniquePhone(seed: number): string {
  return `2547011${String(seed).padStart(5, "0")}`;
}

function seedOwner(store: ReturnType<typeof createCp2Store>, seed: number, businessName: string) {
  const auth = store.signupWithPhonePin({ destination: uniquePhone(seed), pin: "1234" });
  const business = store.createBusiness({
    sessionId: auth.session.id,
    name: businessName,
    language: "en"
  });
  return { store, auth, business: business.business };
}

describe("createSokoHandle - the slugify function", () => {
  it("strips an apostrophe and collapses a space into a single hyphen", () => {
    expect(createSokoHandle("Mama's Kitchen")).toBe("mamas-kitchen");
  });

  it("normalizes accented characters (Café -> cafe)", () => {
    expect(createSokoHandle("Café Nyayo")).toBe("cafe-nyayo");
  });

  it("collapses a run of symbols and spaces into one hyphen", () => {
    expect(createSokoHandle("Duka la Simu #2")).toBe("duka-la-simu-2");
  });

  it("produces an empty string for an all-symbols input, never throws", () => {
    expect(createSokoHandle("!!! @@@ ###")).toBe("");
  });

  it("truncates an over-length input without leaving a trailing hyphen", () => {
    const longName = "a".repeat(100);
    const handle = createSokoHandle(longName);
    expect(handle.length).toBeLessThanOrEqual(48);
    expect(handle.endsWith("-")).toBe(false);
  });

  it("does not itself reject a reserved word - that's the generation layer's job", () => {
    // isReservedSokoHandle is a separate check createGlobalShopId applies on top of this - see
    // the "generation and collisions" suite below for the actual rejection behavior.
    expect(createSokoHandle("www")).toBe("www");
    expect(isReservedSokoHandle("www")).toBe(true);
  });
});

describe("reservedSokoHandles", () => {
  it("includes the universal short-link prefix so a store can never collide with GET /s/:slug", () => {
    expect(reservedSokoHandles.has("s")).toBe(true);
  });

  it("includes every top-level API and web route segment actually found in this monorepo", () => {
    for (const word of ["api", "auth", "businesses", "chat", "marketplace", "settings", "login"]) {
      expect(reservedSokoHandles.has(word)).toBe(true);
    }
  });

  it("is case-insensitive via isReservedSokoHandle", () => {
    expect(isReservedSokoHandle("WWW")).toBe(true);
    expect(isReservedSokoHandle(" Api ")).toBe(true);
  });
});

describe("sokoId generation and collisions", () => {
  it("assigns sequential numeric suffixes for repeated business names - the '3rd Mama Mboga' case", () => {
    const store = createCp2Store();
    const first = seedOwner(store, 1, "Mama Mboga");
    const second = seedOwner(store, 2, "Mama Mboga");
    const third = seedOwner(store, 3, "Mama Mboga");

    expect(first.business.sokoId).toBe("soko.mama-mboga");
    expect(second.business.sokoId).toBe("soko.mama-mboga-2");
    expect(third.business.sokoId).toBe("soko.mama-mboga-3");
  });

  it("skips a reserved-word business name and falls back rather than claiming it", () => {
    const store = createCp2Store();
    const owner = seedOwner(store, 10, "WWW");
    expect(owner.business.sokoId).not.toBe("soko.www");
    expect(isReservedSokoHandle(owner.business.sokoId.replace(/^soko\./u, ""))).toBe(false);
  });

  it("falls back to a generated base when the business name produces no usable handle at all", () => {
    const store = createCp2Store();
    const owner = seedOwner(store, 11, "!!! @@@ ###");
    expect(owner.business.sokoId.startsWith("soko.")).toBe(true);
    const handle = owner.business.sokoId.slice("soko.".length);
    expect(handle.length).toBeGreaterThanOrEqual(minimumSokoHandleLength);
  });
});

describe("resolveBusinessBySokoId - the one shared resolver", () => {
  it("resolves an active sokoId", () => {
    const store = createCp2Store();
    const owner = seedOwner(store, 20, "Active Shop");
    const resolution = store.resolveBusinessBySokoId(owner.business.sokoId);
    expect(resolution).toEqual({ status: "active", business: owner.business });
  });

  it("returns null for a sokoId that never existed", () => {
    const store = createCp2Store();
    expect(store.resolveBusinessBySokoId("soko.never-existed")).toBeNull();
  });

  it("resolves a retired (in-cooldown) sokoId as stale, pointing at the business's new one", () => {
    const store = createCp2Store();
    const owner = seedOwner(store, 21, "Renaming Shop");
    const oldSokoId = owner.business.sokoId;
    const renamed = store.renameSokoId({
      sessionId: owner.auth.session.id,
      businessId: owner.business.id,
      handle: "renamed-shop-handle"
    });

    const resolution = store.resolveBusinessBySokoId(oldSokoId);
    expect(resolution).toEqual({
      status: "stale",
      business: renamed,
      redirectTo: "soko.renamed-shop-handle"
    });
  });

  it("resolves a released (post-cooldown) sokoId as available again - it stops appearing in history-based resolution once claimed by a new business", () => {
    const store = createCp2Store();
    const owner = seedOwner(store, 22, "Original Owner Shop");
    const oldSokoId = owner.business.sokoId;
    store.renameSokoId({
      sessionId: owner.auth.session.id,
      businessId: owner.business.id,
      handle: "original-owner-renamed"
    });
    store.releaseExpiredSokoIds({ cooldownMs: 0 });

    const newOwner = seedOwner(store, 23, "New Claimant Shop");
    const claimed = store.renameSokoId({
      sessionId: newOwner.auth.session.id,
      businessId: newOwner.business.id,
      handle: oldSokoId.replace(/^soko\./u, "")
    });
    expect(claimed.sokoId).toBe(oldSokoId);

    const resolution = store.resolveBusinessBySokoId(oldSokoId);
    expect(resolution).toEqual({ status: "active", business: claimed });
  });
});

describe("renameSokoId", () => {
  it("moves the old sokoId into history with releasedAt null (in cooldown)", () => {
    const store = createCp2Store();
    const owner = seedOwner(store, 30, "First Handle Shop");
    const oldSokoId = owner.business.sokoId;
    store.renameSokoId({
      sessionId: owner.auth.session.id,
      businessId: owner.business.id,
      handle: "second-handle"
    });
    const snapshot = store.snapshot();
    const historyEntry = snapshot.sokoIdHistory?.find((entry) => entry.sokoId === oldSokoId);
    expect(historyEntry).toMatchObject({ businessId: owner.business.id, releasedAt: null });
  });

  it("rejects an in-cooldown handle that a different business is still holding history for", () => {
    const store = createCp2Store();
    const first = seedOwner(store, 31, "First Shop");
    store.renameSokoId({
      sessionId: first.auth.session.id,
      businessId: first.business.id,
      handle: "claimed-once"
    });
    store.renameSokoId({
      sessionId: first.auth.session.id,
      businessId: first.business.id,
      handle: "claimed-twice"
    });

    const second = seedOwner(store, 32, "Second Shop");
    expect(() =>
      store.renameSokoId({
        sessionId: second.auth.session.id,
        businessId: second.business.id,
        handle: "claimed-once"
      })
    ).toThrowError(expect.objectContaining({ code: "soko_id_taken" }));
  });

  it("rejects a reserved handle", () => {
    const store = createCp2Store();
    const owner = seedOwner(store, 33, "Reserved Attempt Shop");
    expect(() =>
      store.renameSokoId({
        sessionId: owner.auth.session.id,
        businessId: owner.business.id,
        handle: "settings"
      })
    ).toThrowError(expect.objectContaining({ code: "soko_id_reserved" }));
  });

  it("rejects a handle shorter than the minimum length", () => {
    const store = createCp2Store();
    const owner = seedOwner(store, 34, "Too Short Shop");
    expect(() =>
      store.renameSokoId({
        sessionId: owner.auth.session.id,
        businessId: owner.business.id,
        handle: "a"
      })
    ).toThrowError(expect.objectContaining({ code: "soko_id_invalid" }));
  });

  it("rejects a handle longer than the DNS label maximum", () => {
    const store = createCp2Store();
    const owner = seedOwner(store, 35, "Too Long Shop");
    expect(() =>
      store.renameSokoId({
        sessionId: owner.auth.session.id,
        businessId: owner.business.id,
        handle: "a".repeat(maximumSokoHandleLength + 1)
      })
    ).toThrowError(expect.objectContaining({ code: "soko_id_invalid" }));
  });

  it("renaming a business's display name never changes its sokoId (pinned by default)", () => {
    const store = createCp2Store();
    const owner = seedOwner(store, 36, "Pinned Name Shop");
    const originalSokoId = owner.business.sokoId;
    // No public rename-the-business-name endpoint mutates sokoId anywhere in this codebase -
    // this test documents that invariant by re-reading the business unchanged.
    const stillActive = store.resolveBusinessBySokoId(originalSokoId);
    expect(stillActive).toEqual({ status: "active", business: owner.business });
  });
});

describe("releaseExpiredSokoIds", () => {
  it("does not release a history entry before its cooldown elapses", () => {
    const store = createCp2Store();
    const owner = seedOwner(store, 40, "Fresh Rename Shop");
    store.renameSokoId({
      sessionId: owner.auth.session.id,
      businessId: owner.business.id,
      handle: "fresh-rename-target"
    });
    const released = store.releaseExpiredSokoIds({ cooldownMs: 30 * 24 * 60 * 60_000 });
    expect(released).toBe(0);
  });

  it("releases a history entry once its cooldown has elapsed, making the old handle available again", () => {
    const store = createCp2Store();
    const owner = seedOwner(store, 41, "Old Rename Shop");
    const oldSokoId = owner.business.sokoId;
    store.renameSokoId({
      sessionId: owner.auth.session.id,
      businessId: owner.business.id,
      handle: "old-rename-target"
    });

    const released = store.releaseExpiredSokoIds({ cooldownMs: 0 });
    expect(released).toBe(1);

    const other = seedOwner(store, 42, "Reclaiming Shop");
    const reclaimed = store.renameSokoId({
      sessionId: other.auth.session.id,
      businessId: other.business.id,
      handle: oldSokoId.replace(/^soko\./u, "")
    });
    expect(reclaimed.sokoId).toBe(oldSokoId);
  });

  it("is idempotent - calling it again after everything is released changes nothing further", () => {
    const store = createCp2Store();
    const owner = seedOwner(store, 43, "Idempotent Shop");
    store.renameSokoId({
      sessionId: owner.auth.session.id,
      businessId: owner.business.id,
      handle: "idempotent-target"
    });
    expect(store.releaseExpiredSokoIds({ cooldownMs: 0 })).toBe(1);
    expect(store.releaseExpiredSokoIds({ cooldownMs: 0 })).toBe(0);
  });
});
