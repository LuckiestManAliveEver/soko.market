import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import type * as Sqlite from "node:sqlite";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof Sqlite;
import { readFileSync } from "node:fs";
import {
  openSqliteLocalDatabase,
  LocalProvider,
  installOfflineRuntime,
  type SqliteDriver
} from "../packages/offline-runtime/index";

describe("Native SQLite local store", () => {
  it("runs the actual migration, enforces constraints and atomically projects entities and log", async () => {
    const driver = new DatabaseSync(":memory:");
    const db = openSqliteLocalDatabase(driver as unknown as SqliteDriver);
    const scope = { accountId: "account", storeId: "shop", deviceId: "native-device" };
    try {
      await installOfflineRuntime({
        db,
        scope,
        businessDataOnly: true,
        binding: null,
        estimate: async () => ({ quota: 2 ** 30, usage: 0 }),
        snapshot: async () => ({
          accountId: "account",
          storeId: "shop",
          cursor: "0",
          collections: {}
        }),
        progress: () => undefined
      });
      await new LocalProvider(db, scope).call("catalogue.create", {
        body: { name: "Rice", quantity: 2 }
      });
      expect(driver.prepare("SELECT count(*) AS n FROM products").get()?.n).toBe(1);
      expect(
        driver.prepare("SELECT sync_status, local_seq, dirty FROM sync_operations").get()
      ).toMatchObject({ sync_status: "PENDING", local_seq: 1, dirty: 1 });
      await expect(
        new LocalProvider(db, scope).call("catalogue.update", {
          id: "missing",
          body: { name: "Broken" }
        })
      ).rejects.toThrow();
      expect(driver.prepare("SELECT count(*) AS n FROM sync_operations").get()?.n).toBe(1);
      expect(() => driver.exec("UPDATE products SET dirty=2")).toThrow();
      expect(() => driver.exec("UPDATE products SET store_id=NULL")).toThrow();
      expect(() => driver.exec("UPDATE products SET scope_key='missing'")).toThrow();
      const sql = readFileSync(
        new URL("../packages/offline-runtime/schema/local.sql", import.meta.url),
        "utf8"
      );
      driver.exec(sql);
      expect(driver.prepare("SELECT count(*) AS n FROM local_migrations").get()?.n).toBe(1);
    } finally {
      db.close();
    }
  });
});
