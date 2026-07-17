import { describe, expect, it, vi } from "vitest";
import { createHttpReceiptOCRProcessor } from "../services/api/src/cp2/receipt-ocr-provider";

describe("receipt OCR provider", () => {
  it("retries transient worker errors and validates the extraction response", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "worker warming up" }), {
          status: 503,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            engine: "paddleocr",
            engineVersion: "2.8.1",
            modelVersion: "balanced-cpu",
            profile: "balanced",
            fallbackUsed: false,
            blocks: [
              {
                id: "p1-b1",
                page: 1,
                text: "Receipt 100",
                confidence: 0.96,
                boundingBox: null
              }
            ],
            fullText: "Receipt 100",
            averageConfidence: 0.96,
            warnings: []
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );
    const processor = createHttpReceiptOCRProcessor({
      endpoint: "http://ocr.internal/",
      fetcher,
      maxRetries: 1,
      timeoutMs: 5_000
    });

    await expect(
      processor.process({
        fileName: "receipt.png",
        contentType: "image/png",
        contentBase64: "iVBORw0KGgo="
      })
    ).resolves.toMatchObject({
      engine: "paddleocr",
      fullText: "Receipt 100",
      averageConfidence: 0.96
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed successful worker responses", async () => {
    const processor = createHttpReceiptOCRProcessor({
      endpoint: "http://ocr.internal",
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      ),
      maxRetries: 0
    });

    await expect(
      processor.process({
        fileName: "receipt.png",
        contentType: "image/png",
        contentBase64: "iVBORw0KGgo="
      })
    ).rejects.toMatchObject({
      code: "receipt_ocr_worker_response_invalid",
      statusCode: 502
    });
  });
});
