import { describe, expect, it } from "vitest";

import {
  canonicalizeComputerAction,
  classifyComputerAction,
  evaluateNavigationPolicy,
  hashComputerAction
} from "./policy.js";

describe("classifyComputerAction", () => {
  it("classifies navigate/observe/scroll as READ", () => {
    expect(classifyComputerAction({ toolName: "computer.navigate" })).toBe("READ");
    expect(classifyComputerAction({ toolName: "computer.observe" })).toBe("READ");
    expect(classifyComputerAction({ toolName: "computer.scroll" })).toBe("READ");
  });

  it("classifies typing without submit as MUTATE", () => {
    expect(
      classifyComputerAction({
        toolName: "computer.type",
        target: { description: "message input" },
        submit: false
      })
    ).toBe("MUTATE");
  });

  it("classifies an ordinary click as MUTATE", () => {
    expect(
      classifyComputerAction({
        toolName: "computer.click",
        target: { description: "search results tab" }
      })
    ).toBe("MUTATE");
  });

  it("classifies a click on a consequential-looking target as CONSEQUENTIAL", () => {
    expect(
      classifyComputerAction({
        toolName: "computer.click",
        target: { description: "Send button" }
      })
    ).toBe("CONSEQUENTIAL");
    expect(
      classifyComputerAction({
        toolName: "computer.click",
        target: { description: "Place order" }
      })
    ).toBe("CONSEQUENTIAL");
  });

  it("classifies submitting typed text as CONSEQUENTIAL when the target reads as consequential", () => {
    expect(
      classifyComputerAction({
        toolName: "computer.type",
        target: { description: "checkout confirm field" },
        submit: true
      })
    ).toBe("CONSEQUENTIAL");
  });

  it("does not trust a claimed non-consequential intent to override a consequential target", () => {
    expect(
      classifyComputerAction({
        toolName: "computer.click",
        target: { description: "Delete account" },
        claimedIntent: "just reading the page"
      })
    ).toBe("CONSEQUENTIAL");
  });

  it("blocks typing into a field already flagged sensitive by the last observation", () => {
    expect(
      classifyComputerAction({
        toolName: "computer.type",
        target: { description: "Password" },
        targetSensitive: true
      })
    ).toBe("BLOCKED");
  });

  it("blocks a click whose target descriptor names a credential field even if not pre-flagged", () => {
    expect(
      classifyComputerAction({
        toolName: "computer.click",
        target: { description: "Enter your OTP code" }
      })
    ).toBe("BLOCKED");
  });
});

describe("evaluateNavigationPolicy", () => {
  it("allows an ordinary https URL", () => {
    expect(evaluateNavigationPolicy("https://example.com/product/1")).toEqual({ allowed: true });
  });

  it("rejects an invalid URL", () => {
    const decision = evaluateNavigationPolicy("not-a-url");
    expect(decision.allowed).toBe(false);
  });

  it("rejects non-http(s) protocols", () => {
    const decision = evaluateNavigationPolicy("file:///etc/passwd");
    expect(decision.allowed).toBe(false);
  });

  it("blocks localhost and loopback", () => {
    expect(evaluateNavigationPolicy("http://localhost:3000/admin").allowed).toBe(false);
    expect(evaluateNavigationPolicy("http://127.0.0.1/admin").allowed).toBe(false);
  });

  it("blocks RFC1918 private ranges", () => {
    expect(evaluateNavigationPolicy("http://10.0.0.5/").allowed).toBe(false);
    expect(evaluateNavigationPolicy("http://192.168.1.1/").allowed).toBe(false);
    expect(evaluateNavigationPolicy("http://172.16.0.1/").allowed).toBe(false);
  });

  it("blocks the cloud metadata link-local address", () => {
    expect(evaluateNavigationPolicy("http://169.254.169.254/latest/meta-data/").allowed).toBe(
      false
    );
  });

  it("enforces an explicit allow-list when configured", () => {
    const decision = evaluateNavigationPolicy("https://evil.example/", {
      allowedDomains: ["good.example"]
    });
    expect(decision.allowed).toBe(false);
    expect(
      evaluateNavigationPolicy("https://good.example/", { allowedDomains: ["good.example"] })
    ).toEqual({ allowed: true });
    expect(
      evaluateNavigationPolicy("https://sub.good.example/", { allowedDomains: ["good.example"] })
    ).toEqual({ allowed: true });
  });

  it("enforces a block-list even without an allow-list", () => {
    expect(
      evaluateNavigationPolicy("https://blocked.example/", { blockedDomains: ["blocked.example"] })
        .allowed
    ).toBe(false);
  });
});

describe("hashComputerAction / canonicalizeComputerAction", () => {
  it("produces the same hash regardless of input key order", () => {
    const a = canonicalizeComputerAction("computer.click", "sess-1", { b: 2, a: 1 });
    const b = canonicalizeComputerAction("computer.click", "sess-1", { a: 1, b: 2 });
    expect(hashComputerAction(a)).toBe(hashComputerAction(b));
  });

  it("produces a different hash when the action content changes", () => {
    const original = canonicalizeComputerAction("computer.type", "sess-1", {
      text: "I'll take 20 bags at KSh 3,000."
    });
    const tampered = canonicalizeComputerAction("computer.type", "sess-1", {
      text: "I'll take 200 bags at KSh 300."
    });
    expect(hashComputerAction(original)).not.toBe(hashComputerAction(tampered));
  });

  it("produces a different hash for a different session", () => {
    const forSessionOne = canonicalizeComputerAction("computer.click", "sess-1", { x: 1 });
    const forSessionTwo = canonicalizeComputerAction("computer.click", "sess-2", { x: 1 });
    expect(hashComputerAction(forSessionOne)).not.toBe(hashComputerAction(forSessionTwo));
  });
});
