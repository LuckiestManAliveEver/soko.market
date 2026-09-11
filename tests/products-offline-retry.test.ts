import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const productsState = readFileSync("apps/web/src/hooks/useProductsState.ts", "utf8");

describe("useProductsState offline-retry queuing (regression)", () => {
  it("queues adjustStock's own inventory.adjust mutation on failure, not an unrelated supplier.create", () => {
    const adjustStockBody = productsState.slice(
      productsState.indexOf("async function adjustStock("),
      productsState.indexOf("async function saveProductFieldStructure(")
    );

    expect(adjustStockBody).toContain(
      'await deps.queueMutationAfterNetworkFailure(error, "inventory.adjust", {'
    );
    expect(adjustStockBody).toContain("productId: stockProductId");
    expect(adjustStockBody).toContain("quantityAfter: Number(stockQuantityAfter)");
    expect(adjustStockBody).toContain("reason: stockReason");
    expect(adjustStockBody).not.toContain("supplier.create");
    expect(adjustStockBody).not.toContain("deps.supplierForm");
  });

  it("does not queue any mutation on a failed product delete, since the sync protocol has no delete type", () => {
    const deleteProductBody = productsState.slice(
      productsState.indexOf("async function deleteProduct("),
      productsState.indexOf("async function adjustStock(")
    );

    expect(deleteProductBody).not.toContain("queueMutationAfterNetworkFailure");
    expect(deleteProductBody).not.toContain("inventory.adjust");
    expect(deleteProductBody).toContain("deps.setStatusMessage(getErrorMessage(error));");
  });

  it("no longer threads an unused supplierForm dependency through useProductsState", () => {
    expect(productsState).not.toContain("supplierForm: SupplierFormState");
    expect(productsState).not.toContain("setSupplierForm: Dispatch");
    expect(productsState).not.toContain("emptySupplierForm");
  });
});
