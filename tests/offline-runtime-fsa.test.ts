import { describe, expect, it } from "vitest";
import {
  openRemovableDatabase,
  installOfflineRuntime,
  LocalProvider,
  type Scope
} from "../packages/offline-runtime/index";

/** Minimal in-memory stand-in for the File System Access API, covering just the surface
 *  openRemovableDatabase relies on: create-on-demand file/directory handles, permission
 *  queries, and a writable stream that commits on close(). Real browsers back this with an
 *  actual removable device; the contract under test is the same either way. */
class FakeWritable {
  private chunks: string[] = [];
  constructor(private readonly commit: (text: string) => void) {}
  async write(data: string): Promise<void> {
    this.chunks.push(data);
  }
  async close(): Promise<void> {
    this.commit(this.chunks.join(""));
  }
}
class FakeFileHandle {
  readonly kind = "file";
  content: string | null = null;
  constructor(readonly name: string) {}
  async getFile() {
    if (this.content === null) throw new DOMException("Not found", "NotFoundError");
    const content = this.content;
    return { text: async () => content } as File;
  }
  async createWritable() {
    return new FakeWritable((text) => {
      this.content = text;
    });
  }
}
class FakeDirectoryHandle {
  readonly kind = "directory";
  permission: "granted" | "denied" | "prompt" = "granted";
  private readonly files = new Map<string, FakeFileHandle>();
  private readonly dirs = new Map<string, FakeDirectoryHandle>();
  constructor(readonly name = "root") {}
  async queryPermission() {
    return this.permission;
  }
  async requestPermission() {
    return this.permission;
  }
  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    let dir = this.dirs.get(name);
    if (!dir) {
      if (!options?.create) throw new DOMException("Not found", "NotFoundError");
      dir = new FakeDirectoryHandle(name);
      this.dirs.set(name, dir);
    }
    return dir;
  }
  async getFileHandle(name: string, options?: { create?: boolean }) {
    let file = this.files.get(name);
    if (!file) {
      if (!options?.create) throw new DOMException("Not found", "NotFoundError");
      file = new FakeFileHandle(name);
      this.files.set(name, file);
    }
    return file;
  }
}
function fakeDevice(): FileSystemDirectoryHandle {
  return new FakeDirectoryHandle() as unknown as FileSystemDirectoryHandle;
}
const scope: Scope = { accountId: "account", storeId: "shop", deviceId: "device" };

describe("Removable device local store", () => {
  it("starts empty, persists transactions, and survives being reopened on the same handle", async () => {
    const device = fakeDevice();
    const first = await openRemovableDatabase(device);
    expect((await first.read(scope)).installed).toBe(false);
    await first.transaction(scope, (state) => {
      state.installed = true;
      state.installedAt = "2026-01-01T00:00:00.000Z";
    });
    const reopened = await openRemovableDatabase(device);
    const state = await reopened.read(scope);
    expect(state.installed).toBe(true);
    expect(state.installedAt).toBe("2026-01-01T00:00:00.000Z");
  });
  it("keeps two scopes on the same device independent", async () => {
    const device = fakeDevice();
    const db = await openRemovableDatabase(device);
    const other: Scope = { ...scope, storeId: "other-shop" };
    await db.transaction(scope, (state) => {
      state.installed = true;
    });
    expect((await db.read(other)).installed).toBe(false);
  });
  it("serializes concurrent transactions against the same scope instead of losing writes", async () => {
    const db = await openRemovableDatabase(fakeDevice());
    await Promise.all(
      Array.from({ length: 8 }, (_unused, index) =>
        db.transaction(scope, (state) => {
          state.rows.push({
            local_id: `row-${index}`,
            cloud_id: null,
            store_id: scope.storeId,
            collection: "products",
            payload: { id: `row-${index}` },
            dirty: true,
            synced_at: null,
            updated_at_local: "2026-01-01T00:00:00.000Z"
          });
        })
      )
    );
    expect((await db.read(scope)).rows).toHaveLength(8);
  });
  it("refuses to open when the device denies write permission", async () => {
    const device = new FakeDirectoryHandle();
    device.permission = "denied";
    await expect(
      openRemovableDatabase(device as unknown as FileSystemDirectoryHandle)
    ).rejects.toThrow("Permission");
  });
  it("runs the full offline install and a local mutation against the removable device", async () => {
    const db = await openRemovableDatabase(fakeDevice());
    await installOfflineRuntime({
      db,
      scope,
      businessDataOnly: true,
      binding: null,
      estimate: async () => ({ quota: 2 ** 30, usage: 0 }),
      snapshot: async () => ({
        accountId: scope.accountId,
        storeId: scope.storeId,
        cursor: "0",
        collections: { products: [{ id: "rice", businessId: scope.storeId, name: "Rice" }] }
      }),
      progress: () => undefined
    });
    await new LocalProvider(db, scope).call("catalogue.create", {
      body: { name: "Beans", quantity: 5 }
    });
    const state = await db.read(scope);
    expect(state.installed).toBe(true);
    expect(state.rows.map((row) => row.payload.name).sort()).toEqual(["Beans", "Rice"]);
    expect(state.operations).toHaveLength(1);
  });
});
