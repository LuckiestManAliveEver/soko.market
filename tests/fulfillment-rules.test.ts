import { describe, expect, it } from "vitest";
import {
  calculateLineWeight,
  calculateOrderFulfillmentWeight,
  exactDecimal,
  isValidIanaTimeZone,
  isValidLocalTime,
  permissionsForRole,
  roleCan,
  snapshotInvoiceLineWeight,
  validateCoordinates,
  validateDispatchPolicyInput,
  validateProductInput,
  validateVehicleInput,
  type DispatchPolicyInput
} from "../packages/business-core/src";
import {
  GramsFormatError,
  MAX_GRAMS,
  formatGrams,
  formatKilogramsForDisplay,
  isGramsString,
  parseGrams,
  parseKilogramsInput,
  parsePositiveGrams
} from "../packages/shared-types/src";

const SACK = 90_000n;
const CARTON = 12_000n;
const BALE = 24_000n;

describe("A22 gram wire format", () => {
  it("round-trips bigint through canonical decimal strings", () => {
    for (const value of [0n, 1n, 900_000n, 6_150_000n]) {
      expect(parseGrams(formatGrams(value))).toBe(value);
    }
    expect(formatGrams(6_150_000n)).toBe("6150000");
  });

  it("preserves values above Number.MAX_SAFE_INTEGER exactly", () => {
    const huge = BigInt(Number.MAX_SAFE_INTEGER) * 1000n + 7n;
    expect(formatGrams(huge)).toBe("9007199254740991007");
    expect(parseGrams("9007199254740991007")).toBe(huge);
    expect(parseGrams(formatGrams(MAX_GRAMS))).toBe(MAX_GRAMS);
  });

  it.each([
    ["negative", "-1"],
    ["decimal", "1.5"],
    ["empty", ""],
    ["non-digit", "12kg"],
    ["whitespace", " 12"],
    ["leading zero", "012"],
    ["exponent", "1e3"],
    ["beyond BIGINT", (MAX_GRAMS + 1n).toString()]
  ])("rejects %s strings", (_label, value) => {
    expect(() => parseGrams(value)).toThrow(GramsFormatError);
    expect(isGramsString(value)).toBe(false);
  });

  it("rejects JSON numbers outright, even safe integers", () => {
    expect(() => parseGrams(1000)).toThrow(GramsFormatError);
    expect(() => parseGrams(null)).toThrow(GramsFormatError);
  });

  it("rejects zero only where a positive quantity is required", () => {
    expect(parseGrams("0")).toBe(0n);
    expect(() => parsePositiveGrams("0")).toThrow(GramsFormatError);
    expect(() => formatGrams(-1n)).toThrow(GramsFormatError);
  });

  it("formats kilograms for display exactly, without float division", () => {
    expect(formatKilogramsForDisplay("6150000")).toBe("6,150 kg");
    expect(formatKilogramsForDisplay("900")).toBe("0.9 kg");
    expect(formatKilogramsForDisplay(1_234_567n)).toBe("1,234.567 kg");
    expect(formatKilogramsForDisplay(1_234_567n, { maximumFractionDigits: 1 })).toBe("1,234.6 kg");
    expect(formatKilogramsForDisplay("7000000", { maximumFractionDigits: 0 })).toBe("7,000 kg");
    expect(formatKilogramsForDisplay("9007199254740991007", { maximumFractionDigits: 0 })).toBe(
      "9,007,199,254,740,991 kg"
    );
  });

  it("parses typed kilograms into exact grams without floating point", () => {
    expect(parseKilogramsInput("6000")).toBe("6000000");
    expect(parseKilogramsInput("6,000")).toBe("6000000");
    expect(parseKilogramsInput(" 6 000 kg ")).toBe("6000000");
    expect(parseKilogramsInput("0.9")).toBe("900");
    expect(parseKilogramsInput("12.345")).toBe("12345");
    expect(parseKilogramsInput("0.1")).toBe("100");
    expect(parseKilogramsInput("1.005")).toBe("1005");
    expect(parseKilogramsInput("0")).toBe("0");
    expect(parseKilogramsInput("007")).toBe("7000");
    // Round-trips with the display helper.
    expect(formatKilogramsForDisplay(parseKilogramsInput("6,150"))).toBe("6,150 kg");
    // Above Number.MAX_SAFE_INTEGER grams stays exact.
    expect(parseKilogramsInput("9007199254740991.007")).toBe("9007199254740991007");
    expect(parseKilogramsInput("1,234,567.5")).toBe("1234567500");
    expect(parseKilogramsInput("12_000")).toBe("12000000");
    // Decimal commas and loose separators are refused, never read as a 10x or 100x weight.
    for (const ambiguous of [
      "0,900",
      "0,500",
      "0 250",
      "00,900",
      "0,9",
      "6,5",
      "6 5",
      "1,2,3",
      "6,0000",
      "60,00",
      "6,000 000",
      "6,"
    ]) {
      expect(() => parseKilogramsInput(ambiguous), ambiguous).toThrow(GramsFormatError);
    }
    for (const bad of ["", " ", "-5", "+5", "1e3", "1.2345", "1.", ".5", "abc", "5 lb", "1.2.3"]) {
      expect(() => parseKilogramsInput(bad), bad).toThrow(GramsFormatError);
    }
    expect(() => parseKilogramsInput("9223372036854775.808")).toThrow(GramsFormatError);
    expect(parseKilogramsInput("9223372036854775.807")).toBe(MAX_GRAMS.toString());
  });
});

describe("A4 line weight", () => {
  it.each([
    ["individual unit", 500n, 1, 500n],
    ["carton", CARTON, 1, 12_000n],
    ["sack", SACK, 1, 90_000n],
    ["bale", BALE, 1, 24_000n],
    ["multiple sacks", SACK, 10, 900_000n],
    ["multiple cartons", CARTON, 250, 3_000_000n]
  ])("resolves %s", (_label, unit, quantity, expected) => {
    expect(calculateLineWeight(unit, quantity)).toEqual({
      status: "RESOLVED",
      totalWeightGrams: expected
    });
  });

  it("is exact for fractional quantities when the result is whole grams (D6)", () => {
    expect(calculateLineWeight(SACK, 2.5)).toEqual({
      status: "RESOLVED",
      totalWeightGrams: 225_000n
    });
    // 0.1 is not representable in binary floating point; the decimal path is still exact.
    expect(calculateLineWeight(1000n, 0.1)).toEqual({ status: "RESOLVED", totalWeightGrams: 100n });
    expect(calculateLineWeight(3n, 1e-7)).toEqual({
      status: "UNRESOLVED",
      reason: "NON_INTEGRAL_WEIGHT"
    });
    expect(exactDecimal(1e21)).toEqual({ digits: 10n ** 21n, scale: 0 });
  });

  it("marks a non-whole-gram product UNRESOLVED instead of rounding", () => {
    expect(calculateLineWeight(1n, 0.5)).toEqual({
      status: "UNRESOLVED",
      reason: "NON_INTEGRAL_WEIGHT"
    });
  });

  it("is BIGINT-safe beyond Number.MAX_SAFE_INTEGER", () => {
    const result = calculateLineWeight(9_000_000_000_000n, 3000);
    expect(result).toEqual({ status: "RESOLVED", totalWeightGrams: 27_000_000_000_000_000n });
  });

  it("treats missing unit weight as unknown, never zero", () => {
    expect(calculateLineWeight(null, 4)).toEqual({
      status: "UNRESOLVED",
      reason: "MISSING_UNIT_WEIGHT"
    });
    expect(snapshotInvoiceLineWeight(null, 4)).toEqual({
      unitWeightGramsSnapshot: null,
      totalWeightGrams: null,
      weightStatus: "UNRESOLVED",
      weightUnresolvedReason: "MISSING_UNIT_WEIGHT"
    });
  });

  it("snapshots unit and total weight as decimal strings", () => {
    expect(snapshotInvoiceLineWeight("90000", 10)).toEqual({
      unitWeightGramsSnapshot: "90000",
      totalWeightGrams: "900000",
      weightStatus: "RESOLVED",
      weightUnresolvedReason: null
    });
  });

  it("validates product unit weight as a positive whole-gram decimal string", () => {
    expect(validateProductInput({ name: "Maize sack", unitWeightGrams: "90000" }).ok).toBe(true);
    expect(validateProductInput({ name: "Maize sack", unitWeightGrams: null }).ok).toBe(true);
    expect(validateProductInput({ name: "Maize sack" }).ok).toBe(true);
    expect(validateProductInput({ name: "Maize sack", unitWeightGrams: "0" }).ok).toBe(false);
    expect(validateProductInput({ name: "Maize sack", unitWeightGrams: "-5" }).ok).toBe(false);
    expect(validateProductInput({ name: "Maize sack", unitWeightGrams: "1.5" }).ok).toBe(false);
  });
});

describe("A5 canonical order fulfillment weight", () => {
  const resolved = (id: string, grams: string) => ({
    id,
    totalWeightGrams: grams,
    weightStatus: "RESOLVED" as const
  });

  it("sums resolved line snapshots into a RESOLVED total", () => {
    expect(
      calculateOrderFulfillmentWeight({
        items: [resolved("a", "900000"), resolved("b", "12000"), resolved("c", "24000")]
      })
    ).toEqual({ status: "RESOLVED", totalWeightGrams: 936_000n });
  });

  it("is UNRESOLVED when one line is unresolved - never a partial total", () => {
    expect(
      calculateOrderFulfillmentWeight({
        items: [
          resolved("a", "900000"),
          { id: "b", weightStatus: "UNRESOLVED", weightUnresolvedReason: "MISSING_UNIT_WEIGHT" }
        ]
      })
    ).toEqual({
      status: "UNRESOLVED",
      unresolvedLineIds: ["b"],
      unresolvedLines: [{ lineId: "b", reason: "MISSING_UNIT_WEIGHT" }]
    });
  });

  it("reports every unresolved line, including pre-snapshot history", () => {
    const result = calculateOrderFulfillmentWeight({
      items: [
        { id: "a", weightStatus: "UNRESOLVED", weightUnresolvedReason: "NON_INTEGRAL_WEIGHT" },
        resolved("b", "1"),
        { id: "c" }
      ]
    });
    expect(result).toEqual({
      status: "UNRESOLVED",
      unresolvedLineIds: ["a", "c"],
      unresolvedLines: [
        { lineId: "a", reason: "NON_INTEGRAL_WEIGHT" },
        { lineId: "c", reason: "NOT_SNAPSHOTTED" }
      ]
    });
  });

  it("does not report an order with no lines as weighing zero", () => {
    expect(calculateOrderFulfillmentWeight({ items: [] }).status).toBe("UNRESOLVED");
  });
});

describe("A9/A10 dispatch policy validation", () => {
  const base: DispatchPolicyInput = {
    name: "Thika corridor",
    targetLoadGrams: 6_000_000n,
    minimumDispatchLoadGrams: null,
    maxDiversionMeters: 2000,
    cutoffLocalTime: "18:00",
    maxWaitHours: 72,
    fulfillmentLeadDays: 1,
    underThresholdFallback: ["TRY_SMALLER_VEHICLE", "REQUIRE_DISPATCH_APPROVAL"],
    overflowStrategy: "NEXT_MANIFEST"
  };

  it("accepts minimum < target, minimum = target and a null minimum", () => {
    expect(validateDispatchPolicyInput(base).ok).toBe(true);
    expect(validateDispatchPolicyInput({ ...base, minimumDispatchLoadGrams: 4_000_000n }).ok).toBe(
      true
    );
    expect(validateDispatchPolicyInput({ ...base, minimumDispatchLoadGrams: 6_000_000n }).ok).toBe(
      true
    );
  });

  it("rejects minimum > target", () => {
    const result = validateDispatchPolicyInput({ ...base, minimumDispatchLoadGrams: 6_000_001n });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("cannot exceed the target");
  });

  it.each([
    ["zero target", { targetLoadGrams: 0n }],
    ["zero minimum", { minimumDispatchLoadGrams: 0n }],
    ["zero diversion", { maxDiversionMeters: 0 }],
    ["fractional diversion", { maxDiversionMeters: 2.5 }],
    ["bad cutoff", { cutoffLocalTime: "6pm" }],
    ["24:00 cutoff", { cutoffLocalTime: "24:00" }],
    ["zero max wait", { maxWaitHours: 0 }],
    ["negative lead days", { fulfillmentLeadDays: -1 }],
    [
      "duplicate fallback",
      { underThresholdFallback: ["TRY_SMALLER_VEHICLE", "TRY_SMALLER_VEHICLE"] }
    ],
    ["unknown fallback", { underThresholdFallback: ["DISPATCH_ANYWAY"] }],
    ["unknown overflow", { overflowStrategy: "SPLIT" }],
    ["empty name", { name: "  " }]
  ])("rejects %s", (_label, override) => {
    expect(
      validateDispatchPolicyInput({ ...base, ...(override as Partial<DispatchPolicyInput>) }).ok
    ).toBe(false);
  });

  it("validates local times", () => {
    expect(isValidLocalTime("00:00")).toBe(true);
    expect(isValidLocalTime("23:59")).toBe(true);
    expect(isValidLocalTime("7:00")).toBe(false);
  });
});

describe("A7 vehicle, A6 coordinates, A11 timezone", () => {
  it("requires positive vehicle capacity", () => {
    expect(validateVehicleInput({ name: "Isuzu FRR", capacityGrams: 7_000_000n }).ok).toBe(true);
    expect(validateVehicleInput({ name: "Isuzu FRR", capacityGrams: 0n }).ok).toBe(false);
    expect(validateVehicleInput({ name: "", capacityGrams: 1n }).ok).toBe(false);
  });

  it("validates geographic ranges", () => {
    expect(validateCoordinates({ latitude: -1.0332, longitude: 37.0693 }).ok).toBe(true);
    expect(validateCoordinates({ latitude: 90, longitude: -180 }).ok).toBe(true);
    expect(validateCoordinates({ latitude: 90.0001, longitude: 0 }).ok).toBe(false);
    expect(validateCoordinates({ latitude: 0, longitude: 180.5 }).ok).toBe(false);
    expect(validateCoordinates({ latitude: Number.NaN, longitude: 0 }).ok).toBe(false);
    expect(validateCoordinates({ latitude: 0, longitude: 0, accuracyMeters: -1 }).ok).toBe(false);
  });

  it("accepts IANA zones and rejects anything else", () => {
    expect(isValidIanaTimeZone("Africa/Nairobi")).toBe(true);
    expect(isValidIanaTimeZone("America/New_York")).toBe(true);
    expect(isValidIanaTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidIanaTimeZone(" Africa/Nairobi")).toBe(false);
    expect(isValidIanaTimeZone("")).toBe(false);
  });
});

describe("A8 fulfillment permissions", () => {
  it("maps the A8 matrix onto business roles", () => {
    expect(permissionsForRole("owner")).toEqual(
      expect.arrayContaining([
        "fulfillment:read",
        "fulfillment:dispatch",
        "fulfillment:manage",
        "shop_location:write",
        "shop_location:read_precise",
        "delivery:record"
      ])
    );
    // Dispatcher = manager (D7): dispatch, but not corridor/vehicle/policy management.
    expect(roleCan("manager", "fulfillment:dispatch")).toBe(true);
    expect(roleCan("manager", "fulfillment:manage")).toBe(false);
    expect(roleCan("manager", "shop_location:read_precise")).toBe(true);
    // Salesperson: capture locations, limited pool view, no precise coordinates, no dispatch.
    expect(roleCan("sales_agent", "shop_location:write")).toBe(true);
    expect(roleCan("sales_agent", "fulfillment:read")).toBe(true);
    expect(roleCan("sales_agent", "shop_location:read_precise")).toBe(false);
    expect(roleCan("sales_agent", "fulfillment:dispatch")).toBe(false);
    // Driver: records deliveries only.
    expect(permissionsForRole("driver").sort()).toEqual(["business:read", "delivery:record"]);
    for (const role of ["cashier", "view_only"] as const) {
      expect(roleCan(role, "fulfillment:read")).toBe(false);
      expect(roleCan(role, "shop_location:write")).toBe(false);
    }
  });
});
