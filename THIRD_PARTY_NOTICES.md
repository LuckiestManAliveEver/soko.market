# Third-party notices

## Receipt OCR

The receipt OCR worker is self-hosted and uses the following third-party components:

- PaddleOCR 2.8.1 — Apache 2.0 — primary OCR engine.
- PaddlePaddle 2.6.2 — Apache 2.0 — PaddleOCR runtime.
- Tesseract OCR — Apache 2.0 — fallback OCR engine.
- pytesseract 0.3.13 — Apache 2.0 package wrapper — Python integration for Tesseract.
- Pillow 10.4.0 — HPND-style Pillow license — image loading for fallback OCR.
- OpenCV Python headless 4.10.0.84 — Apache 2.0 — image processing dependency.
- redis-py 5.0.8 — MIT — queue/client support.

No required paid OCR API is used by the default production receipt OCR flow.
