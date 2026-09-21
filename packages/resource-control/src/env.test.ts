import { describe, expect, it } from "vitest";
import { nonNegativeIntegerFromEnv, positiveIntegerFromEnv } from "./env.js";

describe("positiveIntegerFromEnv", () => {
  it("returns the fallback when unset", () => {
    expect(positiveIntegerFromEnv("X", 7, {})).toBe(7);
  });

  it("parses a valid positive integer", () => {
    expect(positiveIntegerFromEnv("X", 7, { X: "12" })).toBe(12);
  });

  it("throws for zero", () => {
    expect(() => positiveIntegerFromEnv("X", 7, { X: "0" })).toThrow(
      "X must be a positive integer."
    );
  });

  it("throws for a negative value", () => {
    expect(() => positiveIntegerFromEnv("X", 7, { X: "-3" })).toThrow(/positive integer/);
  });

  it("throws for a non-numeric value", () => {
    expect(() => positiveIntegerFromEnv("X", 7, { X: "abc" })).toThrow(/positive integer/);
  });
});

describe("nonNegativeIntegerFromEnv", () => {
  it("accepts zero", () => {
    expect(nonNegativeIntegerFromEnv("X", 7, { X: "0" })).toBe(0);
  });

  it("throws for a negative value", () => {
    expect(() => nonNegativeIntegerFromEnv("X", 7, { X: "-1" })).toThrow(/non-negative integer/);
  });
});
