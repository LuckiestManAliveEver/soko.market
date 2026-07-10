# OCR licensing

This project uses self-hosted open-source OCR by default. No paid OCR API is required for production receipt processing.

## Packages and licenses

| Component              |    Version | Purpose                        | License status             | Commercial use |
| ---------------------- | ---------: | ------------------------------ | -------------------------- | -------------- |
| PaddleOCR              |      2.8.1 | Primary OCR engine             | Apache 2.0                 | Allowed        |
| PaddlePaddle           |      2.6.2 | PaddleOCR runtime              | Apache 2.0                 | Allowed        |
| Tesseract OCR          | OS package | Fallback OCR engine            | Apache 2.0                 | Allowed        |
| pytesseract            |     0.3.13 | Python wrapper for Tesseract   | Apache 2.0 package wrapper | Allowed        |
| Pillow                 |     10.4.0 | Image loading for fallback OCR | HPND-style Pillow license  | Allowed        |
| OpenCV Python headless |  4.10.0.84 | Image processing dependency    | Apache 2.0                 | Allowed        |
| redis-py               |      5.0.8 | Queue/client support           | MIT                        | Allowed        |

## Model policy

Use PaddleOCR models distributed for the selected PaddleOCR release/profile. Record the model source, model version, and license in this document whenever the deployed model set changes.

Current configured model marker:

- `OCR_MODEL_VERSION=balanced-cpu`
- `OCR_ENGINE_VERSION=paddleocr-2.8.1`

## Operational rules

- Do not add paid OCR APIs as required production dependencies.
- Keep OCR package versions pinned in `services/receipt-ocr-service/requirements.txt`.
- Update `THIRD_PARTY_NOTICES.md` whenever OCR dependencies change.
- Record fallback usage in each OCR job with `fallbackUsed=true`.
