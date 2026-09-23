import { describe, expect, it } from "vitest";
import {
  EARTH_RADIUS_METERS,
  corridorLengthMeters,
  projectPointOntoCorridor,
  resolveCorridor,
  validateCorridorGeometry,
  type CorridorCandidate,
  type LineStringGeometry
} from "../packages/business-core/src";

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** Great-circle reference (haversine) with the same Earth radius. */
function haversineMeters(a: [number, number], b: [number, number]): number {
  const dLat = toRadians(b[1] - a[1]);
  const dLng = toRadians(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a[1])) * Math.cos(toRadians(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

// A straight north-south road along longitude 36.8, from latitude -1.3 to -1.2 (~11.1 km).
const meridian: LineStringGeometry = {
  type: "LineString",
  coordinates: [
    [36.8, -1.3],
    [36.8, -1.2]
  ]
};
const metresPerDegreeLatitude = (EARTH_RADIUS_METERS * Math.PI) / 180;

// A Thika-Road-like polyline out of Nairobi (reference route for distance-along accuracy).
const thikaRoad: LineStringGeometry = {
  type: "LineString",
  coordinates: [
    [36.8219, -1.2921],
    [36.8406, -1.2689],
    [36.8792, -1.2305],
    [36.9253, -1.2091],
    [36.9795, -1.1601],
    [37.0144, -1.0967],
    [37.0693, -1.0332]
  ]
};

function candidate(
  id: string,
  geometry: unknown,
  overrides: Partial<CorridorCandidate> = {}
): CorridorCandidate {
  return { id, priority: 100, geometryVersion: 1, geometry, ...overrides };
}

const tolerance2km = () => 2000;

describe("corridor geometry validation (A14)", () => {
  it("accepts a LineString and computes its length server-side", () => {
    const result = validateCorridorGeometry(meridian);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.distanceMeters).toBeCloseTo(0.1 * metresPerDegreeLatitude, 3);
    }
  });

  it.each([
    ["malformed type", { type: "Point", coordinates: [36.8, -1.3] }],
    ["non-array coordinates", { type: "LineString", coordinates: "36.8,-1.3" }],
    ["one-point geometry", { type: "LineString", coordinates: [[36.8, -1.3]] }],
    [
      "zero-length geometry",
      {
        type: "LineString",
        coordinates: [
          [36.8, -1.3],
          [36.8, -1.3]
        ]
      }
    ],
    [
      "invalid longitude",
      {
        type: "LineString",
        coordinates: [
          [181, -1.3],
          [36.8, -1.2]
        ]
      }
    ],
    [
      "invalid latitude",
      {
        type: "LineString",
        coordinates: [
          [36.8, -91],
          [36.8, -1.2]
        ]
      }
    ],
    [
      "non-numeric position",
      {
        type: "LineString",
        coordinates: [
          ["36.8", -1.3],
          [36.8, -1.2]
        ]
      }
    ],
    [
      "three-element position",
      {
        type: "LineString",
        coordinates: [
          [36.8, -1.3, 1600],
          [36.8, -1.2]
        ]
      }
    ],
    ["null", null]
  ])("rejects %s", (_label, geometry) => {
    expect(validateCorridorGeometry(geometry).ok).toBe(false);
  });
});

describe("projectPointOntoCorridor (A15)", () => {
  it("measures a point exactly on the route as zero diversion", () => {
    const projection = projectPointOntoCorridor({ latitude: -1.25, longitude: 36.8 }, meridian);
    expect(projection.diversionMeters).toBeCloseTo(0, 6);
    expect(projection.distanceAlongMeters).toBeCloseTo(0.05 * metresPerDegreeLatitude, 3);
    expect(projection.segmentIndex).toBe(0);
  });

  it("measures perpendicular diversion and distance along", () => {
    const projection = projectPointOntoCorridor({ latitude: -1.25, longitude: 36.81 }, meridian);
    const expectedDiversion = haversineMeters([36.8, -1.25], [36.81, -1.25]);
    expect(Math.abs(projection.diversionMeters - expectedDiversion)).toBeLessThan(0.5);
    expect(projection.distanceAlongMeters).toBeCloseTo(0.05 * metresPerDegreeLatitude, 0);
  });

  it("clamps a point before the origin to the origin", () => {
    const projection = projectPointOntoCorridor({ latitude: -1.31, longitude: 36.8 }, meridian);
    expect(projection.distanceAlongMeters).toBe(0);
    expect(projection.diversionMeters).toBeCloseTo(0.01 * metresPerDegreeLatitude, 3);
  });

  it("clamps a point after the destination to the destination", () => {
    const projection = projectPointOntoCorridor({ latitude: -1.19, longitude: 36.8 }, meridian);
    expect(projection.distanceAlongMeters).toBeCloseTo(corridorLengthMeters(meridian), 6);
    expect(projection.diversionMeters).toBeCloseTo(0.01 * metresPerDegreeLatitude, 3);
  });

  it("is accurate against a great-circle reference along a real-length route", () => {
    const reference = thikaRoad.coordinates
      .slice(1)
      .reduce(
        (sum, point, index) =>
          sum + haversineMeters(thikaRoad.coordinates[index] as [number, number], point),
        0
      );
    const length = corridorLengthMeters(thikaRoad);
    expect(Math.abs(length - reference) / reference).toBeLessThan(1e-4);

    // A shop exactly at the fourth vertex: distance along equals the first three segments.
    const alongToVertex = thikaRoad.coordinates
      .slice(1, 4)
      .reduce(
        (sum, point, index) =>
          sum + haversineMeters(thikaRoad.coordinates[index] as [number, number], point),
        0
      );
    const projection = projectPointOntoCorridor(
      { latitude: -1.2091, longitude: 36.9253 },
      thikaRoad
    );
    expect(projection.diversionMeters).toBeLessThan(0.01);
    expect(Math.abs(projection.distanceAlongMeters - alongToVertex)).toBeLessThan(2);
  });
});

describe("resolveCorridor (A15)", () => {
  it("resolves inside tolerance and reports the only candidate", () => {
    const result = resolveCorridor(
      { latitude: -1.25, longitude: 36.81 },
      [candidate("corridor-a", meridian)],
      tolerance2km
    );
    expect(result).toMatchObject({
      status: "RESOLVED",
      reason: "ONLY_CANDIDATE",
      selected: { corridorId: "corridor-a", segmentIndex: 0, maxDiversionMeters: 2000 },
      alternatives: []
    });
  });

  it("is inclusive exactly at the tolerance boundary and excludes just beyond it", () => {
    const point = { latitude: -1.25, longitude: 36.81 };
    const diversion = projectPointOntoCorridor(point, meridian).diversionMeters;
    expect(
      resolveCorridor(point, [candidate("corridor-a", meridian)], () => diversion).status
    ).toBe("RESOLVED");
    expect(
      resolveCorridor(point, [candidate("corridor-a", meridian)], () => diversion - 0.001)
    ).toMatchObject({ status: "UNRESOLVED", reason: "OUTSIDE_TOLERANCE" });
  });

  it("reports OUTSIDE_TOLERANCE with the nearest corridor for context", () => {
    const result = resolveCorridor(
      { latitude: -1.25, longitude: 36.9 },
      [candidate("corridor-a", meridian)],
      tolerance2km
    );
    expect(result).toMatchObject({
      status: "UNRESOLVED",
      reason: "OUTSIDE_TOLERANCE",
      nearest: { corridorId: "corridor-a" }
    });
  });

  it("picks the corridor with the smaller diversion on a fork", () => {
    const west = {
      type: "LineString",
      coordinates: [
        [36.8, -1.3],
        [36.8, -1.25],
        [36.78, -1.2]
      ]
    };
    const east = {
      type: "LineString",
      coordinates: [
        [36.8, -1.3],
        [36.8, -1.25],
        [36.82, -1.2]
      ]
    };
    const result = resolveCorridor(
      { latitude: -1.21, longitude: 36.816 },
      [candidate("west", west), candidate("east", east)],
      // Wide enough that both branches qualify, so the ranking itself is what is under test.
      () => 10_000
    );
    expect(result).toMatchObject({
      status: "RESOLVED",
      reason: "SMALLEST_DIVERSION",
      selected: { corridorId: "east", segmentIndex: 1 },
      alternatives: [{ corridorId: "west" }]
    });
  });

  it("breaks a diversion tie on a shared road section by priority, then by id", () => {
    const shared = meridian;
    const point = { latitude: -1.25, longitude: 36.805 };
    const byPriority = resolveCorridor(
      point,
      [candidate("b-corridor", shared, { priority: 50 }), candidate("a-corridor", shared)],
      tolerance2km
    );
    expect(byPriority).toMatchObject({
      status: "RESOLVED",
      reason: "PRIORITY_TIE_BREAK",
      selected: { corridorId: "b-corridor" },
      alternatives: [{ corridorId: "a-corridor" }]
    });
    const byId = resolveCorridor(
      point,
      [candidate("b-corridor", shared), candidate("a-corridor", shared)],
      tolerance2km
    );
    expect(byId).toMatchObject({
      status: "RESOLVED",
      reason: "ID_TIE_BREAK",
      selected: { corridorId: "a-corridor" },
      alternatives: [{ corridorId: "b-corridor" }]
    });
  });

  it("uses each corridor's own effective tolerance", () => {
    const point = { latitude: -1.25, longitude: 36.81 };
    const result = resolveCorridor(
      point,
      [candidate("tight", meridian), candidate("wide", meridian)],
      (corridor) => (corridor.id === "tight" ? 500 : 5000)
    );
    expect(result).toMatchObject({ status: "RESOLVED", selected: { corridorId: "wide" } });
    if (result.status === "RESOLVED") expect(result.alternatives).toEqual([]);
  });

  it("returns explicit unresolved reasons", () => {
    expect(resolveCorridor(null, [candidate("a", meridian)], tolerance2km)).toMatchObject({
      reason: "NO_LOCATION"
    });
    expect(resolveCorridor({ latitude: 0, longitude: 0 }, [], tolerance2km)).toMatchObject({
      reason: "NO_ACTIVE_CORRIDOR"
    });
    expect(
      resolveCorridor(
        { latitude: -1.25, longitude: 36.8 },
        [candidate("broken", { type: "LineString", coordinates: [[36.8, -1.3]] })],
        tolerance2km
      )
    ).toMatchObject({ reason: "INVALID_GEOMETRY" });
    expect(
      resolveCorridor({ latitude: -1.25, longitude: 36.8 }, [candidate("a", meridian)], () => null)
    ).toMatchObject({ reason: "NO_DISPATCH_POLICY" });
  });

  it("is deterministic regardless of input order", () => {
    const corridors = [
      candidate("c", meridian, { priority: 100 }),
      candidate("a", meridian, { priority: 100 }),
      candidate("b", meridian, { priority: 100 })
    ];
    const point = { latitude: -1.25, longitude: 36.805 };
    const forward = resolveCorridor(point, corridors, tolerance2km);
    const reversed = resolveCorridor(point, [...corridors].reverse(), tolerance2km);
    expect(forward).toEqual(reversed);
    if (forward.status === "RESOLVED") {
      expect([forward.selected, ...forward.alternatives].map((match) => match.corridorId)).toEqual([
        "a",
        "b",
        "c"
      ]);
    }
  });
});
