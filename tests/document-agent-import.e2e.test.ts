import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildApi } from "../services/api/src/app";
import { createCp2Store } from "../services/api/src/cp2/store";
import { createPostgresCp2Store } from "../services/api/src/cp2/postgres-store";
import type { Cp2Store } from "../services/api/src/cp2/store";

interface ImportJobResponse {
  id: string;
  status: "previewed" | "confirmed" | "failed";
  target: "product" | "supplier";
  source: {
    fileName: string;
    contentType: string;
    sizeBytes: number;
    checksum: string;
  };
  rows: Array<{
    rowNumber: number;
    selected: boolean;
    errors: string[];
    mapped: {
      name: string;
      sku: string | null;
      unit: string;
      quantity: number;
      buyingPrice: number | null;
      sellingPrice: number | null;
    };
  }>;
}

interface RuntimeTurnResponse {
  session: {
    id: string;
  };
  turn: {
    status: string;
    parserIntent: string;
    plan: {
      toolName: string;
      confirmationToken: string | null;
      executedAt: string | null;
    };
    toolResult: {
      job: ImportJobResponse;
      products: ProductResponse[];
    } | null;
  };
}

interface ProductResponse {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
  quantity: number;
  buyingPrice: number | null;
  sellingPrice: number | null;
}

interface DocumentExtractionResponse {
  text: string;
  format: "text" | "pdf" | "word" | "spreadsheet" | "ocr";
  engine?: "paddleocr" | "tesseract";
  averageConfidence?: number;
}

describe("binary document upload to agent-persisted records", () => {
  it("passes upload, Excel extraction, preview, agent confirmation, and database persistence", async () => {
    const databaseUrl = process.env.DOCUMENT_IMPORT_TEST_DATABASE_URL;
    const store =
      databaseUrl === undefined ? createCp2Store() : await createPostgresCp2Store({ databaseUrl });
    const app = buildApi({ cp2: { store } });
    const { businessId, sessionCookie } = await createOwnerBusiness(app);
    const workbook = readFileSync("tests/fixtures/mock-product-catalogue.xlsx");

    const preview = await postJson<ImportJobResponse>(
      app,
      `/businesses/${businessId}/imports/product-catalogue`,
      {
        fileName: "mock-product-catalogue.xlsx",
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        contentBase64: workbook.toString("base64")
      },
      sessionCookie
    );

    expect(preview).toMatchObject({
      status: "previewed",
      target: "product",
      source: {
        fileName: "mock-product-catalogue.xlsx",
        sizeBytes: workbook.byteLength
      }
    });
    expect(preview.source.checksum).toMatch(/^[a-f0-9]{64}$/u);
    expect(preview.rows).toEqual([
      expect.objectContaining({
        selected: true,
        errors: [],
        mapped: {
          name: "Mock Arabica Coffee",
          sku: "MOCK-COF-001",
          unit: "bag",
          quantity: 12,
          buyingPrice: 640,
          sellingPrice: 790
        }
      }),
      expect.objectContaining({
        selected: true,
        errors: [],
        mapped: {
          name: "Mock Green Tea",
          sku: "MOCK-TEA-002",
          unit: "box",
          quantity: 8,
          buyingPrice: 310,
          sellingPrice: 425
        }
      })
    ]);

    expect(await listProducts(app, businessId, sessionCookie)).toEqual([]);

    const proposed = await postJson<RuntimeTurnResponse>(
      app,
      `/businesses/${businessId}/runtime/turns`,
      {
        message: `Add the extracted catalogue records from import ${preview.id}`
      },
      sessionCookie
    );

    expect(proposed.turn).toMatchObject({
      status: "needs_confirmation",
      parserIntent: "confirm_document_import",
      plan: {
        toolName: "document_import.confirm",
        executedAt: null
      },
      toolResult: null
    });
    expect(proposed.turn.plan.confirmationToken).toBeTruthy();
    expect(await listProducts(app, businessId, sessionCookie)).toEqual([]);

    const confirmed = await postJson<RuntimeTurnResponse>(
      app,
      `/businesses/${businessId}/runtime/turns`,
      {
        runtimeSessionId: proposed.session.id,
        message: "confirm",
        confirmationToken: proposed.turn.plan.confirmationToken
      },
      sessionCookie
    );

    expect(confirmed.turn).toMatchObject({
      status: "completed",
      parserIntent: "confirm_document_import",
      plan: {
        toolName: "document_import.confirm"
      },
      toolResult: {
        job: {
          status: "confirmed",
          target: "product"
        }
      }
    });
    expect(confirmed.turn.plan.executedAt).toBeTruthy();
    expect(confirmed.turn.toolResult?.products).toHaveLength(2);

    const persistentStore = store as Cp2Store & {
      flush?: () => Promise<void>;
      close?: () => Promise<void>;
    };
    await persistentStore.flush?.();

    const products = await listProducts(app, businessId, sessionCookie);
    expect(products.map((product) => product.name)).toEqual([
      "Mock Arabica Coffee",
      "Mock Green Tea"
    ]);
    expect(products[0]).toMatchObject({
      sku: "MOCK-COF-001",
      quantity: 12,
      buyingPrice: 640,
      sellingPrice: 790
    });

    await app.close();
    await persistentStore.close?.();

    if (databaseUrl !== undefined) {
      const restoredStore = await createPostgresCp2Store({ databaseUrl });
      const restoredApp = buildApi({ cp2: { store: restoredStore } });
      const restoredProducts = await listProducts(restoredApp, businessId, sessionCookie);

      expect(restoredProducts.map((product) => product.name)).toEqual([
        "Mock Arabica Coffee",
        "Mock Green Tea"
      ]);

      await restoredApp.close();
      await restoredStore.close();
    }
  });

  it.each([
    ["PDF", "mock-product-catalogue.pdf", "application/pdf", "pdf"],
    [
      "Word",
      "mock-product-catalogue.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "word"
    ]
  ] as const)(
    "extracts readable catalogue text from a mock %s document",
    async (_label, fileName, contentType, format) => {
      const app = buildApi({ cp2: { store: createCp2Store() } });
      const { businessId, sessionCookie } = await createOwnerBusiness(app);
      const file = readFileSync(`tests/fixtures/${fileName}`);
      const extracted = await postJson<DocumentExtractionResponse>(
        app,
        `/businesses/${businessId}/documents/extract`,
        {
          fileName,
          contentType,
          contentBase64: file.toString("base64")
        },
        sessionCookie
      );

      expect(extracted.format).toBe(format);
      expect(extracted.text).toContain("Mock Arabica Coffee");
      expect(extracted.text).toContain("MOCK-TEA-002");
      await app.close();
    }
  );

  it("extracts readable text from a chat image through the OCR worker", async () => {
    const app = buildApi({
      cp2: {
        store: createCp2Store(),
        receiptOCRProcessor: {
          async process() {
            return {
              engine: "tesseract",
              engineVersion: "5.4.0",
              modelVersion: "eng",
              profile: "mobile",
              fallbackUsed: false,
              blocks: [
                {
                  id: "block-1",
                  page: 1,
                  text: "Invoice 1042 Total KES 1,250",
                  confidence: 0.94,
                  boundingBox: null
                }
              ],
              fullText: "Invoice 1042\nTotal KES 1,250",
              averageConfidence: 0.94,
              warnings: []
            };
          }
        }
      }
    });
    const { businessId, sessionCookie } = await createOwnerBusiness(app);
    const image = Buffer.concat([
      Buffer.from("89504e470d0a1a0a", "hex"),
      Buffer.from("mock image bytes")
    ]);

    const extracted = await postJson<DocumentExtractionResponse>(
      app,
      `/businesses/${businessId}/documents/ocr`,
      {
        fileName: "invoice.png",
        contentType: "image/png",
        contentBase64: image.toString("base64")
      },
      sessionCookie
    );

    expect(extracted).toMatchObject({
      format: "ocr",
      engine: "tesseract",
      averageConfidence: 0.94
    });
    expect(extracted.text).toContain("Invoice 1042");
    expect(extracted.text).toContain("KES 1,250");
    await app.close();
  });
});

async function createOwnerBusiness(app: ReturnType<typeof buildApi>) {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 10_000)}`.slice(-10);
  const otp = await postJson<{ challengeId: string; devOtp: string }>(app, "/auth/otp/request", {
    channel: "phone",
    destination: `2547${suffix}`
  });
  const verified = await app.inject({
    method: "POST",
    url: "/auth/otp/verify",
    headers: jsonHeaders(),
    payload: JSON.stringify({
      challengeId: otp.challengeId,
      code: otp.devOtp
    })
  });
  expect(verified.statusCode).toBe(200);
  const sessionCookie = extractSessionCookie(verified.headers["set-cookie"]);
  const business = await postJson<{ business: { id: string } }>(
    app,
    "/businesses",
    {
      name: `Mock Document Shop ${suffix}`,
      language: "en"
    },
    sessionCookie
  );

  return {
    businessId: business.business.id,
    sessionCookie
  };
}

async function listProducts(
  app: ReturnType<typeof buildApi>,
  businessId: string,
  sessionCookie: string
): Promise<ProductResponse[]> {
  const response = await app.inject({
    method: "GET",
    url: `/businesses/${businessId}/products`,
    headers: {
      cookie: sessionCookie
    }
  });
  expect(response.statusCode).toBe(200);
  return response.json<ProductResponse[]>();
}

async function postJson<TResponse>(
  app: ReturnType<typeof buildApi>,
  url: string,
  payload: Record<string, unknown>,
  cookie?: string
): Promise<TResponse> {
  const response = await app.inject({
    method: "POST",
    url,
    headers: cookie === undefined ? jsonHeaders() : { ...jsonHeaders(), cookie },
    payload: JSON.stringify(payload)
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<TResponse>();
}

function jsonHeaders() {
  return {
    "content-type": "application/json"
  };
}

function extractSessionCookie(setCookie: string | string[] | undefined): string {
  const serialized = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const cookie = serialized?.split(";")[0];
  if (cookie === undefined) throw new Error("Session cookie missing");
  return cookie;
}
