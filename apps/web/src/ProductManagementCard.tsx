import { useEffect, useState } from "react";
import type { ProductSummary } from "@soko/shared-types";
import { useAsyncActions } from "./hooks/useAsyncActions";
import { deleteJson, getJson, patchJson, postJson } from "./api-helpers";
import { getUserFacingErrorMessage } from "./user-facing-error";
import type { StockAdjustmentResponse } from "./soko-application-shared";

interface ProductDraft {
  name: string;
  sku: string;
  unit: string;
  quantity: string;
  buyingPrice: string;
  sellingPrice: string;
}

const emptyDraft: ProductDraft = {
  name: "",
  sku: "",
  unit: "unit",
  quantity: "0",
  buyingPrice: "",
  sellingPrice: ""
};

function draftFromProduct(product: ProductSummary): ProductDraft {
  return {
    name: product.name,
    sku: product.sku ?? "",
    unit: product.unit,
    quantity: String(product.quantity),
    buyingPrice: product.buyingPrice === null ? "" : String(product.buyingPrice),
    sellingPrice: product.sellingPrice === null ? "" : String(product.sellingPrice)
  };
}

// Self-contained generated-surface card for the products domain (Phase 4a) - fetches its own data
// from businessId alone, same shape as ProductCaptureItemsCard/StatusBroadcastCard, rather than
// reusing useProductsState/ProductSurface, which need 8 injected deps tied to sibling hooks in
// SokoApplication.tsx. See docs/frontend/frontend.md Phase 4a for why.
export default function ProductManagementCard(props: { businessId: string; productId?: string }) {
  const { isPending, runAction } = useAsyncActions();
  const [products, setProducts] = useState<ProductSummary[] | null>(null);
  const [message, setMessage] = useState("");
  const [editingId, setEditingId] = useState<string | null>(props.productId ?? null);
  const [drafts, setDrafts] = useState<Record<string, ProductDraft>>({});
  const [stockDrafts, setStockDrafts] = useState<Record<string, string>>({});
  const [isAdding, setIsAdding] = useState(false);
  const [addDraft, setAddDraft] = useState<ProductDraft>(emptyDraft);

  useEffect(() => {
    let cancelled = false;
    void getJson<ProductSummary[]>(`/businesses/${props.businessId}/products`)
      .then((loaded) => {
        if (cancelled) return;
        setProducts(loaded);
        setDrafts(
          Object.fromEntries(loaded.map((product) => [product.id, draftFromProduct(product)]))
        );
      })
      .catch((error) => {
        if (!cancelled) setMessage(getUserFacingErrorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, [props.businessId]);

  function draftFor(productId: string, product: ProductSummary): ProductDraft {
    return drafts[productId] ?? draftFromProduct(product);
  }

  async function saveEdit(product: ProductSummary) {
    const draft = draftFor(product.id, product);
    if (draft.name.trim().length === 0) {
      setMessage("Enter a product name.");
      return;
    }
    const updated = await patchJson<ProductSummary>(
      `/businesses/${props.businessId}/products/${product.id}`,
      {
        name: draft.name.trim(),
        sku: draft.sku.trim() || null,
        unit: draft.unit.trim() || "unit",
        quantity: Number(draft.quantity),
        buyingPrice: draft.buyingPrice.trim().length === 0 ? null : Number(draft.buyingPrice),
        sellingPrice: draft.sellingPrice.trim().length === 0 ? null : Number(draft.sellingPrice)
      }
    );
    setProducts((current) =>
      (current ?? []).map((item) => (item.id === updated.id ? updated : item))
    );
    setEditingId(null);
    setMessage(`${updated.name} updated`);
  }

  async function removeProduct(product: ProductSummary) {
    if (!window.confirm(`Delete ${product.name}? This cannot be undone.`)) return;
    await deleteJson<ProductSummary>(`/businesses/${props.businessId}/products/${product.id}`);
    setProducts((current) => (current ?? []).filter((item) => item.id !== product.id));
    setMessage(`${product.name} removed`);
  }

  async function adjustStock(product: ProductSummary) {
    const quantityAfter = stockDrafts[product.id] ?? String(product.quantity);
    const result = await postJson<StockAdjustmentResponse>(
      `/businesses/${props.businessId}/products/${product.id}/stock-adjustments`,
      { quantityAfter: Number(quantityAfter), reason: "Adjusted from chat card" }
    );
    setProducts((current) =>
      (current ?? []).map((item) => (item.id === result.product.id ? result.product : item))
    );
    setMessage(`${result.product.name} stock set to ${result.product.quantity}`);
  }

  async function addProduct() {
    if (addDraft.name.trim().length === 0) {
      setMessage("Enter a product name.");
      return;
    }
    const created = await postJson<ProductSummary>(`/businesses/${props.businessId}/products`, {
      name: addDraft.name.trim(),
      sku: addDraft.sku.trim() || null,
      unit: addDraft.unit.trim() || "unit",
      quantity: Number(addDraft.quantity),
      buyingPrice: addDraft.buyingPrice.trim().length === 0 ? null : Number(addDraft.buyingPrice),
      sellingPrice: addDraft.sellingPrice.trim().length === 0 ? null : Number(addDraft.sellingPrice)
    });
    setProducts((current) => [created, ...(current ?? [])]);
    setAddDraft(emptyDraft);
    setIsAdding(false);
    setMessage(`${created.name} added`);
  }

  if (products === null) {
    return (
      <section className="record-form product-management-card" aria-label="Products">
        {message.length > 0 ? <p className="shell-note">{message}</p> : <p>Loading products…</p>}
      </section>
    );
  }

  return (
    <section className="record-form product-management-card" aria-label="Manage products">
      <div className="section-heading">
        <p className="eyebrow">Products</p>
        <h3>Manage products from chat</h3>
      </div>
      {message.length > 0 ? <p className="shell-note">{message}</p> : null}
      <div className="row-actions">
        <button type="button" onClick={() => setIsAdding((open) => !open)}>
          {isAdding ? "Cancel" : "Add product"}
        </button>
      </div>
      {isAdding ? (
        <div className="product-management-item">
          <label>
            Name
            <input
              value={addDraft.name}
              onChange={(event) =>
                setAddDraft((current) => ({ ...current, name: event.target.value }))
              }
            />
          </label>
          <label>
            Unit
            <input
              value={addDraft.unit}
              onChange={(event) =>
                setAddDraft((current) => ({ ...current, unit: event.target.value }))
              }
            />
          </label>
          <label>
            Quantity
            <input
              inputMode="decimal"
              value={addDraft.quantity}
              onChange={(event) =>
                setAddDraft((current) => ({ ...current, quantity: event.target.value }))
              }
            />
          </label>
          <label>
            Selling price
            <input
              inputMode="decimal"
              value={addDraft.sellingPrice}
              onChange={(event) =>
                setAddDraft((current) => ({ ...current, sellingPrice: event.target.value }))
              }
            />
          </label>
          <button
            type="button"
            disabled={isPending("product-management-add")}
            onClick={() =>
              void runAction("product-management-add", async () => {
                try {
                  await addProduct();
                } catch (error) {
                  setMessage(getUserFacingErrorMessage(error));
                }
              })
            }
          >
            Save product
          </button>
        </div>
      ) : null}
      {products.length === 0 ? <p className="shell-note">No products yet.</p> : null}
      {products.map((product) => {
        const isEditing = editingId === product.id;
        const draft = draftFor(product.id, product);
        return (
          <div className="product-management-item" key={product.id}>
            {isEditing ? (
              <>
                <label>
                  Name
                  <input
                    value={draft.name}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [product.id]: { ...draft, name: event.target.value }
                      }))
                    }
                  />
                </label>
                <label>
                  Unit
                  <input
                    value={draft.unit}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [product.id]: { ...draft, unit: event.target.value }
                      }))
                    }
                  />
                </label>
                <label>
                  Selling price
                  <input
                    inputMode="decimal"
                    value={draft.sellingPrice}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [product.id]: { ...draft, sellingPrice: event.target.value }
                      }))
                    }
                  />
                </label>
                <div className="row-actions">
                  <button
                    type="button"
                    disabled={isPending(`product-management-save-${product.id}`)}
                    onClick={() =>
                      void runAction(`product-management-save-${product.id}`, async () => {
                        try {
                          await saveEdit(product);
                        } catch (error) {
                          setMessage(getUserFacingErrorMessage(error));
                        }
                      })
                    }
                  >
                    Save
                  </button>
                  <button className="secondary" type="button" onClick={() => setEditingId(null)}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <p>
                  <strong>{product.name}</strong>
                  <br />
                  {product.quantity} {product.unit}
                  {product.sellingPrice === null ? "" : ` · ${product.sellingPrice}`}
                </p>
                <label>
                  Set quantity
                  <input
                    inputMode="decimal"
                    value={stockDrafts[product.id] ?? String(product.quantity)}
                    onChange={(event) =>
                      setStockDrafts((current) => ({
                        ...current,
                        [product.id]: event.target.value
                      }))
                    }
                  />
                </label>
                <div className="row-actions">
                  <button
                    type="button"
                    disabled={isPending(`product-management-stock-${product.id}`)}
                    onClick={() =>
                      void runAction(`product-management-stock-${product.id}`, async () => {
                        try {
                          await adjustStock(product);
                        } catch (error) {
                          setMessage(getUserFacingErrorMessage(error));
                        }
                      })
                    }
                  >
                    Adjust stock
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => setEditingId(product.id)}
                  >
                    Edit
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    disabled={isPending(`product-management-delete-${product.id}`)}
                    onClick={() =>
                      void runAction(`product-management-delete-${product.id}`, async () => {
                        try {
                          await removeProduct(product);
                        } catch (error) {
                          setMessage(getUserFacingErrorMessage(error));
                        }
                      })
                    }
                  >
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        );
      })}
    </section>
  );
}
