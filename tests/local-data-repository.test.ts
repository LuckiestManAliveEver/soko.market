import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { catalogueRepository, conversationRepository } from "../apps/web/src/local-data-repository";

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("navigator", { onLine: true });
});

describe("local-first data repositories", () => {
  it("keeps cached domain data scoped to the signed-in owner", async () => {
    const ownerOne = catalogueRepository<string[]>("account-1");
    const ownerTwo = catalogueRepository<string[]>("account-2");

    await ownerOne.writeCached("products", ["Sugar"]);

    expect(await ownerOne.readCached("products")).toMatchObject({
      status: "hydrated",
      value: ["Sugar"]
    });
    expect(await ownerTwo.readCached("products")).toMatchObject({
      status: "empty",
      value: null
    });
  });

  it("prevents an older refresh from overwriting a newer result", async () => {
    const repository = conversationRepository<string[]>("account-1");
    let resolveOld: ((value: string[]) => void) | undefined;
    const oldRefresh = repository.refresh(
      "inbox",
      () =>
        new Promise<string[]>((resolve) => {
          resolveOld = resolve;
        })
    );
    const newRefresh = repository.refresh("inbox", async () => ["new"]);

    await newRefresh;
    resolveOld?.(["old"]);
    await oldRefresh;

    expect((await repository.readCached("inbox")).value).toEqual(["new"]);
  });

  it("clears every record in an account scope on logout", async () => {
    const catalogue = catalogueRepository<string[]>("account-1");
    const conversations = conversationRepository<string[]>("account-1");
    await catalogue.writeCached("products", ["Sugar"]);
    await conversations.writeCached("inbox", ["conversation-1"]);

    await catalogue.clearForLogout();

    expect((await catalogue.readCached("products")).status).toBe("empty");
    expect((await conversations.readCached("inbox")).status).toBe("empty");
  });
});
