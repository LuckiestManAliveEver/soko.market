import { describe, expect, it } from "vitest";
import {
  buildNormalizedSnapshotSql,
  normalizedCollections
} from "../services/api/src/cp2/postgres-store";

// Boot used to issue one query per normalized table (~150 round trips to a remote Neon database,
// ~50s of startup). The snapshot must now load in a single statement that still covers every
// table, keeps each table's `order by entity_id`, and tags rows with a stable collection index.
describe("buildNormalizedSnapshotSql", () => {
  const sql = buildNormalizedSnapshotSql(normalizedCollections);
  const branches = sql.split("\nunion all\n");

  it("loads every normalized collection in one statement", () => {
    expect(branches).toHaveLength(normalizedCollections.length);
    expect(sql.match(/;/gu)).toBeNull();
  });

  it("tags each branch with its collection index and keeps per-table entity_id order", () => {
    normalizedCollections.forEach((collection, index) => {
      expect(branches[index]).toBe(
        `select ${index}::int as collection_index, coalesce(jsonb_agg(record order by entity_id), '[]'::jsonb) as records from ${collection.tableName}`
      );
    });
  });
});
