# Receipt OCR

Receipt OCR is implemented as a self-hosted flow for supplier purchase receipts.

## Engine strategy

- Primary OCR engine: PaddleOCR.
- Fallback OCR engine: Tesseract, only when PaddleOCR fails and `OCR_FALLBACK_ENABLED=true`.
- Default profile: `balanced`.
- Supported profiles: `mobile`, `balanced`, `accurate`.
- CPU execution is the default deployment target.

The worker service lives in `services/receipt-ocr-service`. It exposes HTTP health and scan
endpoints and can run from Docker Compose with:

```bash
docker compose --profile ocr up receipt-ocr-worker
```

The API connects through `OCR_WORKER_URL` (locally `http://127.0.0.1:8090`). Binary image and PDF
bytes are sent only after the API authenticates the business and the signed malware scanner returns
`clean`. Worker responses are schema-validated before entering parsing and contact matching.

## A shared OCR capability, not a receipt-only one

The bridge to the worker (`services/api/src/cp2/ocr-provider.ts`, exporting
`OcrExtractionProcessor`) is generic: it takes an image or PDF and returns raw OCR blocks, full
text, engine metadata, and confidence, with no receipt-specific parsing. `registerCp2Routes` builds
one processor instance from `OCR_WORKER_URL` and passes it into every domain that needs OCR, so
receipt parsing is a consumer on top of the same capability, not a separate integration:

| Consumer                                       | Route                                          | What it adds on top of raw OCR                                |
| ----------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------- |
| Receipt parsing (`domains/suppliers`)          | `POST /businesses/:businessId/receipt-ocr/jobs` | Supplier/receipt/line-item field parsing, contact matching     |
| Chat document extraction (`domains/document-imports`) | `POST /businesses/:businessId/documents/ocr`    | Returns extracted text for chat attachments, no field parsing  |
| Camera product capture (`domains/commerce`)    | `POST /businesses/:businessId/product-captures` | Product title/price extraction for the Camera → Catalogue flow |

A future extractor (identity documents, invoices, and so on) should be a new consumer of this same
`OcrExtractionProcessor`, not a new OCR worker integration.

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
- `OCR_WORKER_URL`

## User flow

1. User uploads or takes a photo of a purchase receipt from Suppliers, chat, or a receipt card.
2. The upload is validated.
3. The signed malware scanner must classify the upload as clean.
4. The API sends binary content to the bounded worker with configured timeout and retries.
5. OCR extracts raw text blocks, full text, engine metadata, confidence, and warnings.
6. The parser extracts supplier, sales agent, receipt, payment, and product fields.
7. The required `receipt_contact_matching` context script normalizes fields and ranks supplier/contact candidates.
8. User confirms or corrects the review card.
9. Structured purchase receipt and line items are saved.
10. Worker temporary files are deleted immediately after each scan.

Runtime sequence:

```text
receipt command context script
→ OCR extraction
→ receipt-contact-matching context script
→ deterministic supplier and sales-agent resolution
→ user confirmation
→ structured record creation
→ model fallback only when still unresolved
```

## Chat support

Receipt commands are protected by `receipt_ocr_commands` and contact matching is protected by
`receipt_contact_matching`. Both run before general model fallback.

Examples:

- “Show my suppliers”
- “Upload this receipt”
- “Show sales agents for Wholesale Depot”
- “Which supplier sold me maize last week?”
- “Show purchase receipts”
- “Match this receipt to a supplier”
- “Find this supplier in my phonebook”
- “match hii receipt na supplier”

## Receipt contact matching

`receipt_contact_matching` is required, runs after OCR extraction, and returns structured candidates.

Supplier priority:

1. Confirmed supplier-contact link.
2. Exact tax PIN or registration number.
3. Exact normalized phone.
4. Exact verified email.
5. Exact linked external contact ID.
6. Exact normalized supplier name.
7. Previous confirmed receipt pattern.
8. Conservative contact-name suggestion.

Sales-agent priority:

1. Confirmed sales-agent-contact link.
2. Exact normalized phone.
3. Exact normalized name within the matched supplier.
4. Previous confirmed receipt association.
5. Conservative contact-name suggestion.

Thresholds are configurable:

- `OCR_CONTACT_MATCH_AUTO_SELECT`
- `OCR_CONTACT_MATCH_CONFIRMATION_REQUIRED`
- `OCR_CONTACT_MATCH_REJECT_BELOW`

Medium-confidence, tied, or conflicting candidates require user confirmation. Exact phone,
email, tax PIN, registration number, and confirmed contact-link matches are not overridden by
model suggestions.

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
- contact matching result with confidence, sources, and matched-by explanation

The original receipt image is not permanently stored by this pipeline.

## Privacy

Only contact nodes from the current owner, active sync sources, direct visibility, and non-revoked
consent states are searched. OCR does not upload the owner’s full address book to an external OCR or
model provider, and unrelated contacts are not passed into model prompts.
