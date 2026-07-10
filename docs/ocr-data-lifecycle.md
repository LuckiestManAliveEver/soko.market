# OCR data lifecycle

Receipt OCR follows a privacy-first data lifecycle.

## States

Receipt OCR jobs use these lifecycle states:

- `UPLOADED`
- `QUEUED`
- `VALIDATING`
- `PREPROCESSING`
- `OCR_RUNNING`
- `FIELDS_EXTRACTED`
- `CONTACT_MATCHING`
- `PARSING`
- `MATCHING`
- `REVIEW_REQUIRED`
- `CONFIRMED`
- `PURCHASE_RECORDED`
- `COMPLETED`
- `FAILED`
- `CANCELLED`
- `CLEANUP_PENDING`
- `IMAGE_DELETED`

Legacy lowercase states remain accepted for compatibility.

## Image storage rule

- Receipt images are temporary processing inputs.
- Images are not permanently stored by default.
- After successful confirmation, the uploaded image is deleted and only structured data remains.
- Failed uploads are not silently discarded. The user sees failed status and can retry or enter the receipt manually.

## Structured data retained

The system keeps:

- supplier and sales agent references
- receipt date and total
- line items
- OCR engine metadata
- raw OCR text blocks and full text
- confidence values
- field evidence and warnings
- image hash/storage key metadata, not the original image

## Cleanup

Temporary image retention is controlled by:

- `OCR_TEMP_IMAGE_TTL_HOURS`
- `OCR_FAILED_IMAGE_TTL_HOURS`
- `OCR_DELETE_AFTER_CONFIRM`

Confirmed jobs set:

- `imageRetained=false`
- `imageDeletedAt=<confirmation timestamp>`
- `cleanupPending=false`

Receipt processing can continue when contact matching fails. In that case the OCR job remains
reviewable, the user can manually select or create supplier/agent records, and image deletion still
occurs after confirmation or cancellation according to retention policy.

## Security and limits

Receipt upload handling validates:

- MIME type
- file signature where available
- upload size

Production deployments should also enforce request body limits at the reverse proxy/API gateway layer.
