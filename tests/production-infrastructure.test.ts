import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRealtimeUrl, readApiBaseUrl } from "../apps/web/src/lib/api";
import { readBackupConfiguration, backupsExpiredBefore } from "../infra/backup/backup-r2.mjs";
import { postgresEnvironment } from "../infra/backup/postgres-env.mjs";
import { nextScheduledRun, parseDailySchedule } from "../infra/backup/schedule.mjs";
import {
  buildObjectKey,
  createR2ObjectStorage,
  validateUpload
} from "../services/api/src/storage/object-storage";

describe("production object storage", () => {
  it("creates tenant-scoped collision-resistant sanitized keys", () => {
    expect(
      buildObjectKey({
        uploadClass: "context-documents",
        tenantId: "shop/../../one",
        fileName: "../../Supplier list (final).csv",
        now: new Date("2026-07-27T12:00:00.000Z"),
        id: "fixed-id"
      })
    ).toBe("uploads/context-documents/shop-one/2026/07/fixed-id-Supplier-list-final-.csv");
  });

  it("checks allowlisted MIME types and magic bytes", () => {
    expect(() =>
      validateUpload({
        uploadClass: "receipt-images",
        contentType: "image/png",
        bytes: Buffer.from("not a png")
      })
    ).toThrow("do not match");
    expect(() =>
      validateUpload({
        uploadClass: "receipt-images",
        contentType: "image/png",
        bytes: Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.from("content")])
      })
    ).not.toThrow();
    expect(() =>
      validateUpload({
        uploadClass: "receipt-images",
        contentType: "text/html",
        bytes: Buffer.from("<html>")
      })
    ).toThrow("not allowed");
  });

  it("signs private R2 operations and creates expiring GET URLs", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: { "content-length": "4", "x-amz-meta-sha256": "checksum" }
      })
    );
    const storage = createR2ObjectStorage(
      {
        endpoint: new URL("https://account.r2.cloudflarestorage.com"),
        region: "auto",
        bucket: "private-bucket",
        accessKeyId: "access",
        secretAccessKey: "secret"
      },
      fetcher
    );
    await storage.putObject({
      key: "uploads/context-documents/shop/2026/07/id-file.txt",
      bytes: Buffer.from("test"),
      contentType: "text/plain",
      checksum: "checksum"
    });
    const options = fetcher.mock.calls[0]?.[1];
    expect(String(fetcher.mock.calls[0]?.[0])).toContain(
      "/private-bucket/uploads/context-documents/shop/2026/07/id-file.txt"
    );
    expect(new Headers(options?.headers).get("authorization")).toMatch(
      /^AWS4-HMAC-SHA256 Credential=access\//u
    );
    const signedUrl = new URL(
      await storage.createSignedGetUrl("uploads/context-documents/shop/2026/07/id-file.txt", 60)
    );
    expect(signedUrl.searchParams.get("X-Amz-Expires")).toBe("60");
    expect(signedUrl.searchParams.get("X-Amz-Signature")).toMatch(/^[a-f0-9]{64}$/u);
  });
});

describe("encrypted backup configuration", () => {
  const environment = {
    DATABASE_URL: "postgresql://soko:password@postgres:5432/soko_market",
    BACKUP_ENCRYPTION_PASSWORD: "a-long-backup-password-value",
    BACKUP_RETENTION_DAYS: "21",
    BACKUP_R2_PREFIX: "database-backups",
    R2_ENDPOINT: "https://account.r2.cloudflarestorage.com",
    R2_REGION: "auto",
    R2_BUCKET_NAME: "private-bucket",
    R2_ACCESS_KEY_ID: "access",
    R2_SECRET_ACCESS_KEY: "secret"
  };

  it("validates secrets, retention, and private R2 settings", () => {
    expect(readBackupConfiguration(environment)).toMatchObject({
      retentionDays: 21,
      prefix: "database-backups",
      r2: { bucket: "private-bucket", region: "auto" }
    });
    expect(() =>
      readBackupConfiguration({ ...environment, BACKUP_ENCRYPTION_PASSWORD: "too-short" })
    ).toThrow("at least 20 characters");
    expect(backupsExpiredBefore(14, new Date("2026-07-27T00:00:00.000Z")).toISOString()).toBe(
      "2026-07-13T00:00:00.000Z"
    );
  });

  it("passes database credentials through process environment instead of command arguments", () => {
    expect(
      postgresEnvironment(
        "postgresql://soko:p%40ssword@postgres:5432/soko_market?sslmode=disable",
        {}
      )
    ).toEqual({
      database: "soko_market",
      environment: {
        PGHOST: "postgres",
        PGPORT: "5432",
        PGUSER: "soko",
        PGPASSWORD: "p@ssword",
        PGDATABASE: "soko_market",
        PGSSLMODE: "disable"
      }
    });
  });

  it("accepts only daily UTC schedules and calculates the next run", () => {
    const schedule = parseDailySchedule("17 2 * * *");
    expect(schedule).toEqual({ minute: 17, hour: 2 });
    expect(nextScheduledRun(schedule, new Date("2026-07-27T03:00:00.000Z")).toISOString()).toBe(
      "2026-07-28T02:17:00.000Z"
    );
    expect(() => parseDailySchedule("*/5 * * * *")).toThrow("daily cron expression");
  });
});

describe("Vercel production routing", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the configured API hostname without a trailing slash", () => {
    vi.stubEnv("VITE_API_BASE_URL", " https://api.soko.market/ ");
    expect(readApiBaseUrl()).toBe("https://api.soko.market");
  });

  it("derives secure and local WebSocket endpoints from the API hostname", () => {
    expect(buildRealtimeUrl("https://api.soko.market")).toBe("wss://api.soko.market/v1/realtime");
    expect(buildRealtimeUrl("http://127.0.0.1:4000")).toBe("ws://127.0.0.1:4000/v1/realtime");
  });

  it("builds the workspace PWA, preserves SPA routes, and applies security headers", () => {
    const configuration = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      buildCommand: string;
      outputDirectory: string;
      rewrites: Array<{ destination: string }>;
      headers: Array<{ headers: Array<{ key: string }> }>;
    };
    expect(configuration.buildCommand).toContain("@soko/web");
    expect(configuration.outputDirectory).toBe("apps/web/dist");
    expect(configuration.rewrites).toContainEqual(
      expect.objectContaining({ destination: "/index.html" })
    );
    expect(
      configuration.headers.flatMap((item) => item.headers.map((header) => header.key))
    ).toEqual(expect.arrayContaining(["Content-Security-Policy", "X-Content-Type-Options"]));
  });
});
