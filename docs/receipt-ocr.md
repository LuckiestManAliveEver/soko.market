# Receipt OCR

Receipt OCR is implemented as a self-hosted flow for supplier purchase receipts.

## Engine strategy

- Primary OCR engine: PaddleOCR.
- Fallback OCR engine: Tesseract, only when PaddleOCR fails and `OCR_FALLBACK_ENABLED=true`.
- Default profile: `balanced`.
- Supported profiles: `mobile`, `balanced`, `accurate`.
- CPU execution is the default deployment target.

The worker scaffold lives in `services/receipt-ocr-service`. It can run from Docker Compose with:

```bash
docker compose --profile ocr up receipt-ocr-worker
```

## Supported inputs

The API validates the declared MIME type, file size, and file signature where the browser can provide one.

Supported upload types:

- JPEG
- PNG
- WebP
- HEIC/HEIF
- PDF
- text or CSV for manual retry/development receipts

Important limits are configured through:

- `OCR_MAX_UPLOAD_MB`
- `OCR_MAX_IMAGE_EDGE`
- `OCR_MAX_PDF_PAGES`
- `OCR_JOB_TIMEOUT_SECONDS`
- `OCR_MAX_RETRIES`
- `OCR_CONCURRENCY`

## User flow

1. User uploads or takes a photo of a purchase receipt from Suppliers, chat, or a receipt card.
2. The upload is validated.
3. OCR extracts raw text blocks, full text, engine metadata, confidence, and warnings.
4. The parser extracts supplier, sales agent, phone, date, total, and line items.
5. Matching suggests existing suppliers and sales agents where possible.
6. User confirms or corrects the review card.
7. Structured purchase receipt and line items are saved.
8. The temporary image is deleted after successful confirmation.

## Chat support

Receipt commands are protected by the `receipt_ocr_commands` context script and run before model fallback.

Examples:

- “Show my suppliers”
- “Upload this receipt”
- “Show sales agents for Wholesale Depot”
- “Which supplier sold me maize last week?”
- “Show purchase receipts”

## API endpoints

- `POST /businesses/:businessId/receipt-ocr/jobs`
- `POST /businesses/:businessId/receipt-ocr/jobs/:ocrJobId/confirm`
- `GET /businesses/:businessId/purchase-receipts`
- `GET /businesses/:businessId/purchase-receipts/:receiptId`

## Saved OCR metadata

Receipt OCR jobs save:

- engine
- engine version
- model version
- profile
- fallback flag
- raw OCR blocks
- full text
- average confidence
- warnings
- field evidence
- supplier and sales agent match candidates

The original receipt image is not permanently stored by default.
