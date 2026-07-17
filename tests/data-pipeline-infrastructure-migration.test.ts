import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("data pipeline infrastructure migration", () => {
  it("creates the durable message notification delivery collection", async () => {
    const sql = await readFile("infra/db/migrations/028_data_pipeline_infrastructure.sql", "utf8");
    expect(sql).toContain("create table if not exists cp2_message_notification_deliveries");
    expect(sql).toContain("cp2_message_notification_deliveries_status_idx");
  });

  it("provides an explicit rollback", async () => {
    const sql = await readFile(
      "infra/db/rollbacks/028_data_pipeline_infrastructure.down.sql",
      "utf8"
    );
    expect(sql).toContain("drop table if exists cp2_message_notification_deliveries");
  });

  it("bridges realtime cursor hints through PostgreSQL LISTEN and NOTIFY", async () => {
    const source = await readFile("services/api/src/cp2/postgres-store.ts", "utf8");
    expect(source).toContain("listen ${realtimeChannel}");
    expect(source).toContain("pg_notify($1, $2)");
    expect(source).toContain("sourceInstanceId");
    expect(source).toContain("publishExternalSyncChange");
    expect(source).toContain("scheduleRealtimeReconnect");
  });
});
