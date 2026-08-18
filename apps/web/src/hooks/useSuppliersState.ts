import { useState } from "react";

import { dataUrlPayload, getErrorMessage, readFileAsDataUrl } from "../chat-message-plumbing";
import { deleteJson, getJson, patchJson, postJson } from "../api-helpers";
import {
  emptySupplierForm,
  type NetworkNodeSummary,
  type PurchaseReceiptSummary,
  type ReceiptOCRJobSummary,
  type SalesAgentSummary,
  type SupplierBusinessCardSummary,
  type SupplierFormState,
  type SupplierSummary
} from "../soko-application-shared";

interface UseSuppliersStateDeps {
  businessId: string | null;
  setStatusMessage: (message: string) => void;
  loadReports: (businessId: string) => Promise<void>;
  registerReset: (domainKey: string, fn: () => void) => void;
  registerRefresh: (
    domainKey: string,
    views: readonly string[],
    fn: (businessId: string) => Promise<void>
  ) => void;
}

export function useSuppliersState(deps: UseSuppliersStateDeps) {
  const [suppliers, setSuppliers] = useState<SupplierBusinessCardSummary[]>([]);
  const [purchaseReceipts, setPurchaseReceipts] = useState<PurchaseReceiptSummary[]>([]);
  const [supplierForm, setSupplierForm] = useState<SupplierFormState>(emptySupplierForm);

  async function loadSuppliers(businessId: string) {
    try {
      setSuppliers(
        await getJson<SupplierBusinessCardSummary[]>(
          `/businesses/${businessId}/suppliers`,
          setSuppliers
        )
      );
    } catch (error) {
      deps.setStatusMessage(getErrorMessage(error));
    }
  }

  // Business-wide purchase history across every supplier, distinct from the per-supplier receipts
  // already embedded in SupplierBusinessCardSummary - this is the flat ledger view.
  async function loadPurchaseReceipts(businessId: string) {
    try {
      setPurchaseReceipts(
        await getJson<PurchaseReceiptSummary[]>(
          `/businesses/${businessId}/purchase-receipts`,
          setPurchaseReceipts
        )
      );
    } catch (error) {
      deps.setStatusMessage(getErrorMessage(error));
    }
  }

  async function saveSupplier() {
    if (deps.businessId === null) {
      return;
    }

    try {
      const payload = {
        name: supplierForm.name,
        phone: supplierForm.phone,
        email: supplierForm.email,
        notes: supplierForm.notes
      };

      if (supplierForm.id === null) {
        await postJson<SupplierSummary>(`/businesses/${deps.businessId}/suppliers`, payload);
      } else {
        await patchJson<SupplierSummary>(
          `/businesses/${deps.businessId}/suppliers/${supplierForm.id}`,
          payload
        );
      }

      setSupplierForm(emptySupplierForm);
      await loadSuppliers(deps.businessId);
      await deps.loadReports(deps.businessId);
      deps.setStatusMessage(supplierForm.id === null ? "Supplier created" : "Supplier updated");
    } catch (error) {
      deps.setStatusMessage(getErrorMessage(error));
    }
  }

  async function deleteSupplierCard(supplierId: string) {
    if (deps.businessId === null) {
      return;
    }
    const supplierName =
      suppliers.find((supplier) => supplier.id === supplierId)?.name ?? "this supplier";
    if (!window.confirm(`Delete ${supplierName}? This cannot be undone.`)) return;

    try {
      await deleteJson<{ deleted: true; supplierId: string }>(
        `/businesses/${deps.businessId}/suppliers/${supplierId}`
      );
      await loadSuppliers(deps.businessId);
      await deps.loadReports(deps.businessId);
      deps.setStatusMessage("Supplier deleted");
    } catch (error) {
      deps.setStatusMessage(getErrorMessage(error));
    }
  }

  async function saveSalesAgent(supplierId: string, agent: SupplierFormState) {
    if (deps.businessId === null) {
      return;
    }

    try {
      const payload = {
        name: agent.name,
        phone: agent.phone,
        email: agent.email,
        notes: agent.notes
      };

      if (agent.id === null) {
        await postJson<SalesAgentSummary>(
          `/businesses/${deps.businessId}/suppliers/${supplierId}/sales-agents`,
          payload
        );
      } else {
        await patchJson<SalesAgentSummary>(
          `/businesses/${deps.businessId}/suppliers/${supplierId}/sales-agents/${agent.id}`,
          payload
        );
      }

      await loadSuppliers(deps.businessId);
      deps.setStatusMessage(agent.id === null ? "Sales agent added" : "Sales agent updated");
    } catch (error) {
      deps.setStatusMessage(getErrorMessage(error));
    }
  }

  async function deleteSalesAgentCard(supplierId: string, salesAgentId: string) {
    if (deps.businessId === null) {
      return;
    }
    if (!window.confirm("Delete this sales agent? This cannot be undone.")) return;

    try {
      await deleteJson<{ deleted: true; salesAgentId: string }>(
        `/businesses/${deps.businessId}/suppliers/${supplierId}/sales-agents/${salesAgentId}`
      );
      await loadSuppliers(deps.businessId);
      deps.setStatusMessage("Sales agent deleted");
    } catch (error) {
      deps.setStatusMessage(getErrorMessage(error));
    }
  }

  async function searchSupplierContacts(query: string): Promise<NetworkNodeSummary[]> {
    if (deps.businessId === null) {
      return [];
    }

    try {
      return await getJson<NetworkNodeSummary[]>(
        `/businesses/${deps.businessId}/suppliers/phonebook/search?q=${encodeURIComponent(query)}`
      );
    } catch (error) {
      deps.setStatusMessage(getErrorMessage(error));
      return [];
    }
  }

  async function linkSupplierPhoneContact(supplierId: string, networkNodeId: string) {
    if (deps.businessId === null) {
      return;
    }

    try {
      await postJson<SupplierBusinessCardSummary>(
        `/businesses/${deps.businessId}/suppliers/${supplierId}/link-contact`,
        { networkNodeId }
      );
      await loadSuppliers(deps.businessId);
      deps.setStatusMessage("Supplier phone contact linked");
    } catch (error) {
      deps.setStatusMessage(getErrorMessage(error));
    }
  }

  async function createSupplierFromPhoneContact(networkNodeId: string) {
    if (deps.businessId === null) {
      return;
    }

    try {
      await postJson<SupplierBusinessCardSummary>(
        `/businesses/${deps.businessId}/suppliers/from-phonebook`,
        { networkNodeId }
      );
      await loadSuppliers(deps.businessId);
      deps.setStatusMessage("Supplier created from phone contact");
    } catch (error) {
      deps.setStatusMessage(getErrorMessage(error));
    }
  }

  async function linkSalesAgentPhoneContact(salesAgentId: string, networkNodeId: string) {
    if (deps.businessId === null) {
      return;
    }

    try {
      await postJson<SalesAgentSummary>(
        `/businesses/${deps.businessId}/sales-agents/${salesAgentId}/link-contact`,
        { networkNodeId }
      );
      await loadSuppliers(deps.businessId);
      deps.setStatusMessage("Sales agent phone contact linked");
    } catch (error) {
      deps.setStatusMessage(getErrorMessage(error));
    }
  }

  async function createSalesAgentFromPhoneContact(supplierId: string, networkNodeId: string) {
    if (deps.businessId === null) {
      return;
    }

    try {
      await postJson<SalesAgentSummary>(
        `/businesses/${deps.businessId}/suppliers/${supplierId}/sales-agents/from-phonebook`,
        { networkNodeId }
      );
      await loadSuppliers(deps.businessId);
      deps.setStatusMessage("Sales agent created from phone contact");
    } catch (error) {
      deps.setStatusMessage(getErrorMessage(error));
    }
  }

  async function readFileSignature(file: File): Promise<string> {
    const buffer = await file.slice(0, 16).arrayBuffer();
    return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function uploadSupplierReceipt(file: File): Promise<ReceiptOCRJobSummary | null> {
    if (deps.businessId === null) {
      return null;
    }

    try {
      const requiresOCR = file.type.startsWith("image/") || file.type === "application/pdf";
      const extractedText = requiresOCR ? "" : await file.text();
      const contentBase64 = requiresOCR ? dataUrlPayload(await readFileAsDataUrl(file)) : undefined;
      const job = await postJson<ReceiptOCRJobSummary>(
        `/businesses/${deps.businessId}/receipt-ocr/jobs`,
        {
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
          extractedText,
          ...(contentBase64 === undefined ? {} : { contentBase64 }),
          fileSizeBytes: file.size,
          fileSignature: await readFileSignature(file)
        }
      );
      deps.setStatusMessage(
        job.status === "failed" || job.status === "FAILED"
          ? "Receipt OCR failed. Retry or enter the receipt manually."
          : "Receipt OCR complete. Confirm matched supplier and agent."
      );
      return job;
    } catch (error) {
      deps.setStatusMessage(getErrorMessage(error));
      return null;
    }
  }

  async function confirmSupplierReceipt(job: ReceiptOCRJobSummary) {
    if (deps.businessId === null) {
      return;
    }

    try {
      await postJson<PurchaseReceiptSummary>(
        `/businesses/${deps.businessId}/receipt-ocr/jobs/${job.id}/confirm`,
        {
          supplierId: job.matchedSupplierId,
          salesAgentId: job.matchedSalesAgentId,
          createSupplier: job.matchedSupplierId === null,
          createSalesAgent: job.matchedSalesAgentId === null && job.salesAgentName !== null
        }
      );
      await loadSuppliers(deps.businessId);
      await deps.loadReports(deps.businessId);
      deps.setStatusMessage("Receipt saved. Uploaded image was deleted after processing.");
    } catch (error) {
      deps.setStatusMessage(getErrorMessage(error));
    }
  }

  deps.registerReset("suppliers", () => {
    setSuppliers([]);
    // purchaseReceipts was never included in resetClientToStartup's reset sweep before this
    // extraction - a pre-existing gap (same class of bug the backend domain-modularization
    // roadmap found and fixed for statusBroadcasts/buyOrders/etc), fixed here rather than carried
    // forward, since this hook's reset is the natural place to own it going forward.
    setPurchaseReceipts([]);
    setSupplierForm(emptySupplierForm);
  });
  deps.registerRefresh("suppliers", ["suppliers", "imports"], loadSuppliers);
  deps.registerRefresh("purchase-receipts", ["suppliers"], loadPurchaseReceipts);

  return {
    suppliers,
    purchaseReceipts,
    supplierForm,
    setSupplierForm,
    loadSuppliers,
    saveSupplier,
    deleteSupplierCard,
    saveSalesAgent,
    deleteSalesAgentCard,
    searchSupplierContacts,
    linkSupplierPhoneContact,
    createSupplierFromPhoneContact,
    linkSalesAgentPhoneContact,
    createSalesAgentFromPhoneContact,
    uploadSupplierReceipt,
    confirmSupplierReceipt
  };
}
