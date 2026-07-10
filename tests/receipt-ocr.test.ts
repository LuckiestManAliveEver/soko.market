import { describe, expect, it } from "vitest";
import {
  createRuntimeToolProposalFromReceiptContextScript,
  parseReceiptContextScriptCommand
} from "../packages/tool-core/src";
import { buildApi } from "../services/api/src/app";
import { createCp2Store } from "../services/api/src/cp2/store";

interface OtpRequestResponse {
  challengeId: string;
  devOtp: string;
}

interface VerifyOtpResponse {
  session: {
    id: string;
  };
}

interface CreateBusinessResponse {
  business: {
    id: string;
  };
}

interface SupplierResponse {
  id: string;
  name: string;
}

interface ReceiptOCRJobResponse {
  id: string;
  status: string;
  engine: string;
  profile: string;
  fallbackUsed: boolean;
  blocks: Array<{ text: string; confidence: number }>;
  fieldEvidence: Array<{ field: string; value: string | number | null }>;
  supplierCandidates: Array<{ id: string; name: string; confidence: number }>;
  matchedSupplierId: string | null;
  imageRetained: boolean;
  imageDeletedAt: string | null;
  cleanupPending: boolean;
  warnings: string[];
  items: Array<{ name: string; quantity: number; unitPrice: number; total: number }>;
}

interface PurchaseReceiptResponse {
  id: string;
  supplierName: string;
  imageStored: boolean;
  lineItems: Array<{ name: string; quantity: number; unitPrice: number; total: number }>;
}

interface RuntimeTurnResponse {
  turn: {
    plan: {
      toolName: string;
    };
    telemetry: Array<{
      state: string;
      metadata: Record<string, unknown>;
    }>;
  };
}

describe("Receipt OCR", () => {
  it("uses PaddleOCR metadata, matches suppliers, saves structured data, and deletes image metadata", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });
    const { businessId, sessionCookie } = await createOwnerBusiness(app);
    const supplier = await postJson<SupplierResponse>(
      app,
      `/businesses/${businessId}/suppliers`,
      {
        name: "Wholesale Depot",
        phone: "+254700000010",
        email: null,
        notes: null
      },
      sessionCookie
    );

    const job = await postJson<ReceiptOCRJobResponse>(
      app,
      `/businesses/${businessId}/receipt-ocr/jobs`,
      {
        fileName: "receipt.jpg",
        contentType: "image/jpeg",
        fileSizeBytes: 4096,
        fileSignature: "ffd8ffe000104a464946",
        extractedText:
          "Supplier: Wholesale Depot\nAgent: Mary Wanjiku\nPhone: +254700000010\nDate: 2026-07-09\nMaize,2,100,200\nTotal: 200"
      },
      sessionCookie
    );

    expect(job).toMatchObject({
      status: "MATCHING",
      engine: "paddleocr",
      profile: "balanced",
      fallbackUsed: false,
      matchedSupplierId: supplier.id,
      imageRetained: true,
      cleanupPending: true
    });
    expect(job.blocks.length).toBeGreaterThan(0);
    expect(job.fieldEvidence).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "supplierName" })])
    );
    expect(job.supplierCandidates[0]).toMatchObject({
      name: "Wholesale Depot"
    });
    expect(job.items[0]).toMatchObject({
      name: "Maize",
      quantity: 2,
      unitPrice: 100,
      total: 200
    });

    const receipt = await postJson<PurchaseReceiptResponse>(
      app,
      `/businesses/${businessId}/receipt-ocr/jobs/${job.id}/confirm`,
      {
        supplierId: job.matchedSupplierId,
        createSupplier: false
      },
      sessionCookie
    );

    expect(receipt).toMatchObject({
      supplierName: "Wholesale Depot",
      imageStored: false
    });
    expect(receipt.lineItems).toHaveLength(1);

    const savedReceipts = await getJson<PurchaseReceiptResponse[]>(
      app,
      `/businesses/${businessId}/purchase-receipts`,
      sessionCookie
    );
    expect(savedReceipts[0]).toMatchObject({
      id: receipt.id,
      imageStored: false
    });
    expect(store.snapshot().receiptOCRJobs[0]).toMatchObject({
      status: "COMPLETED",
      imageRetained: false,
      cleanupPending: false
    });
    expect(store.snapshot().receiptOCRJobs[0]?.imageDeletedAt).not.toBeNull();

    await app.close();
  });

  it("rejects unsupported or spoofed receipt uploads before OCR", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });
    const { businessId, sessionCookie } = await createOwnerBusiness(app);

    const response = await app.inject({
      method: "POST",
      url: `/businesses/${businessId}/receipt-ocr/jobs`,
      headers: {
        ...jsonHeaders(),
        cookie: sessionCookie
      },
      payload: JSON.stringify({
        fileName: "receipt.jpg",
        contentType: "image/jpeg",
        fileSizeBytes: 100,
        fileSignature: "25504446",
        extractedText: "Supplier: Wholesale Depot"
      })
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: "receipt_ocr_signature_mismatch"
    });

    await app.close();
  });

  it("routes receipt chat commands through protected context scripts before model fallback", async () => {
    const match = parseReceiptContextScriptCommand({
      message: "Which supplier sold me maize last week?"
    });

    expect(match).toMatchObject({
      scriptId: "receipt_ocr_commands",
      intent: "RECEIPT_LOOKUP",
      entities: {
        itemName: "maize",
        dateRange: "last_week"
      }
    });
    expect(createRuntimeToolProposalFromReceiptContextScript(match!)).toMatchObject({
      toolName: "receipt.lookup",
      validation: {
        ok: true
      }
    });

    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });
    const { businessId, sessionCookie } = await createOwnerBusiness(app);
    const turn = await postJson<RuntimeTurnResponse>(
      app,
      `/businesses/${businessId}/runtime/turns`,
      {
        message: "Show purchase receipts"
      },
      sessionCookie
    );

    expect(turn.turn.plan.toolName).toBe("receipt.list");
    expect(turn.turn.telemetry).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: "intent.routed",
          metadata: expect.objectContaining({
            source: "context_script",
            scriptId: "receipt_ocr_commands"
          })
        })
      ])
    );

    await app.close();
  });
});

async function createOwnerBusiness(app: ReturnType<typeof buildApi>) {
  const otp = await postJson<OtpRequestResponse>(
    app,
    "/auth/otp/request",
    {
      channel: "phone",
      destination: "+254700000099"
    },
    null
  );
  const verified = await postJson<VerifyOtpResponse>(
    app,
    "/auth/otp/verify",
    {
      challengeId: otp.challengeId,
      code: otp.devOtp
    },
    null
  );
  const sessionCookie = `soko_session=${verified.session.id}`;
  const created = await postJson<CreateBusinessResponse>(
    app,
    "/businesses",
    {
      name: "OCR Shop",
      language: "en"
    },
    sessionCookie
  );

  return {
    businessId: created.business.id,
    sessionCookie
  };
}

async function postJson<TResponse>(
  app: ReturnType<typeof buildApi>,
  url: string,
  payload: unknown,
  sessionCookie: string | null
): Promise<TResponse> {
  const response = await app.inject({
    method: "POST",
    url,
    headers: sessionCookie === null ? jsonHeaders() : { ...jsonHeaders(), cookie: sessionCookie },
    payload: JSON.stringify(payload)
  });

  expect(response.statusCode).toBeGreaterThanOrEqual(200);
  expect(response.statusCode).toBeLessThan(300);
  return response.json() as TResponse;
}

async function getJson<TResponse>(
  app: ReturnType<typeof buildApi>,
  url: string,
  sessionCookie: string
): Promise<TResponse> {
  const response = await app.inject({
    method: "GET",
    url,
    headers: {
      ...jsonHeaders(),
      cookie: sessionCookie
    }
  });

  expect(response.statusCode).toBeGreaterThanOrEqual(200);
  expect(response.statusCode).toBeLessThan(300);
  return response.json() as TResponse;
}

function jsonHeaders() {
  return {
    "content-type": "application/json"
  };
}
