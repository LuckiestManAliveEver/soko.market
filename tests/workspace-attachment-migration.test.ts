import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("workspace conversation attachment migration", () => {
  it("adds durable attachment metadata and ownership/message lookup indexes", () => {
    const migration = readFileSync(
      "infra/db/migrations/058_workspace_conversation_attachments.sql",
      "utf8"
    );
    expect(migration).toContain("create table if not exists cp2_conversation_attachments");
    expect(migration).toContain("record jsonb not null");
    expect(migration).toContain("cp2_conversation_attachments_conversation_idx");
    expect(migration).toContain("cp2_conversation_attachments_message_idx");
    expect(migration).toContain("cp2_conversation_attachments_account_idx");
  });

  it("moves legacy JSONB bytes into private bytea blob storage", () => {
    const migration = readFileSync(
      "infra/db/migrations/059_conversation_attachment_blob_storage.sql",
      "utf8"
    );
    const rollback = readFileSync(
      "infra/db/rollbacks/059_conversation_attachment_blob_storage.down.sql",
      "utf8"
    );
    expect(migration).toContain("create table if not exists cp2_conversation_attachment_blobs");
    expect(migration).toContain("content bytea not null");
    expect(migration).toContain("decode(record ->> 'contentBase64', 'base64')");
    expect(migration).toContain("record - 'contentBase64'");
    expect(rollback).toContain("encode(blob.content, 'base64')");
    expect(readFileSync("services/api/src/cp2/postgres-store.ts", "utf8")).toContain(
      '"059_conversation_attachment_blob_storage.sql"'
    );
  });
});
