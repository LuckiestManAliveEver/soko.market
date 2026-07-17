#!/usr/bin/env python3
"""Self-hosted receipt OCR worker.

PaddleOCR is the primary engine. Tesseract is used only when PaddleOCR fails
and OCR_FALLBACK_ENABLED is not false. The worker emits structured JSON and is
safe to run as a queue consumer or one-shot CLI scanner.
"""

from __future__ import annotations

import argparse
import base64
import binascii
import io
import json
import os
import sys
import tempfile
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


def positive_integer_env(name: str, fallback: int) -> int:
    try:
        value = int(os.getenv(name, str(fallback)))
    except ValueError:
        return fallback
    return value if value > 0 else fallback


def ocr_profile() -> str:
    profile = os.getenv("OCR_PROFILE", "balanced").strip().lower()
    return profile if profile in {"mobile", "balanced", "accurate"} else "balanced"


def paddle_lang() -> str:
    hints = [hint.strip().lower() for hint in os.getenv("OCR_LANGUAGE_HINTS", "en,sw").split(",")]
    return "en" if "en" in hints else (hints[0] if hints else "en")


def scan_with_paddle(path: Path) -> dict[str, Any]:
    from paddleocr import PaddleOCR  # type: ignore

    ocr = PaddleOCR(use_angle_cls=True, lang=paddle_lang(), show_log=False)
    rows = ocr.ocr(str(path), cls=True)
    blocks: list[dict[str, Any]] = []

    for page_index, page in enumerate(rows or [], start=1):
        for index, row in enumerate(page or [], start=1):
            box, payload = row
            text, confidence = payload
            blocks.append(
                {
                    "id": f"p{page_index}-b{index}",
                    "page": page_index,
                    "text": str(text),
                    "confidence": float(confidence),
                    "boundingBox": [{"x": float(x), "y": float(y)} for x, y in box],
                }
            )

    return build_result(
        engine="paddleocr",
        engine_version="paddleocr-2.8.1",
        model_version=f"{ocr_profile()}-cpu",
        fallback_used=False,
        blocks=blocks,
        warnings=[],
    )


def scan_with_tesseract(path: Path, warnings: list[str]) -> dict[str, Any]:
    import pytesseract  # type: ignore
    from PIL import Image  # type: ignore

    text = pytesseract.image_to_string(Image.open(path))
    blocks = [
        {
            "id": "p1-b1",
            "page": 1,
            "text": text.strip(),
            "confidence": 0.5 if text.strip() else 0.0,
            "boundingBox": None,
        }
    ]
    return build_result(
        engine="tesseract",
        engine_version="tesseract-fallback",
        model_version="eng+swa",
        fallback_used=True,
        blocks=blocks if text.strip() else [],
        warnings=warnings,
    )


def build_result(
    *,
    engine: str,
    engine_version: str,
    model_version: str,
    fallback_used: bool,
    blocks: list[dict[str, Any]],
    warnings: list[str],
) -> dict[str, Any]:
    full_text = "\n".join(block["text"] for block in blocks if block["text"])
    average_confidence = (
        sum(float(block["confidence"]) for block in blocks) / len(blocks) if blocks else 0.0
    )
    return {
        "engine": engine,
        "engineVersion": engine_version,
        "modelVersion": model_version,
        "profile": ocr_profile(),
        "fallbackUsed": fallback_used,
        "blocks": blocks,
        "fullText": full_text,
        "averageConfidence": round(average_confidence, 4),
        "warnings": warnings,
    }


def scan(path: Path) -> dict[str, Any]:
    warnings: list[str] = []

    try:
        return scan_with_paddle(path)
    except Exception as exc:  # pragma: no cover - depends on native OCR libs
        warnings.append(f"PaddleOCR failed; fallback attempted: {type(exc).__name__}")

    if os.getenv("OCR_FALLBACK_ENABLED", "true").lower() == "false":
        raise RuntimeError("; ".join(warnings))

    return scan_with_tesseract(path, warnings)


def health() -> dict[str, Any]:
    return {
        "ok": True,
        "enginePrimary": os.getenv("OCR_ENGINE_PRIMARY", "paddleocr"),
        "engineFallback": os.getenv("OCR_ENGINE_FALLBACK", "tesseract"),
        "profile": ocr_profile(),
        "concurrency": positive_integer_env("OCR_CONCURRENCY", 1),
    }


def worker_loop() -> None:
    host = os.getenv("OCR_WORKER_HOST", "0.0.0.0")
    port = positive_integer_env("OCR_WORKER_PORT", 8090)
    server = ThreadingHTTPServer((host, port), ReceiptOCRRequestHandler)
    print(
        json.dumps(
            {
                "ok": True,
                "mode": "worker",
                "host": host,
                "port": port,
                **health(),
            }
        ),
        flush=True,
    )
    server.serve_forever()


class ReceiptOCRRequestHandler(BaseHTTPRequestHandler):
    semaphore = threading.BoundedSemaphore(positive_integer_env("OCR_CONCURRENCY", 1))

    def do_GET(self) -> None:
        if self.path != "/health":
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "Route not found."})
            return
        self.send_json(HTTPStatus.OK, health())

    def do_POST(self) -> None:
        if self.path != "/scan":
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "Route not found."})
            return

        try:
            payload = self.read_json_body()
            content = decode_upload(payload)
            suffix = safe_suffix(payload.get("fileName"))
            validate_upload(content, str(payload.get("contentType", "")))

            with self.semaphore:
                with tempfile.NamedTemporaryFile(suffix=suffix) as upload:
                    upload.write(content)
                    upload.flush()
                    result = scan(Path(upload.name))

            self.send_json(HTTPStatus.OK, result)
        except UploadError as exc:
            self.send_json(exc.status, {"error": str(exc)})
        except Exception as exc:  # pragma: no cover - native OCR failures are environment-specific
            self.send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": f"Receipt OCR failed: {type(exc).__name__}"},
            )

    def read_json_body(self) -> dict[str, Any]:
        try:
            content_length = int(self.headers.get("content-length", "0"))
        except ValueError as exc:
            raise UploadError(HTTPStatus.BAD_REQUEST, "Content-Length is invalid.") from exc

        max_encoded_bytes = positive_integer_env("OCR_MAX_UPLOAD_MB", 10) * 1024 * 1024 * 2
        if content_length <= 0 or content_length > max_encoded_bytes:
            raise UploadError(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "Receipt upload is too large.")

        try:
            value = json.loads(self.rfile.read(content_length))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise UploadError(HTTPStatus.BAD_REQUEST, "Request body must be valid JSON.") from exc

        if not isinstance(value, dict):
            raise UploadError(HTTPStatus.BAD_REQUEST, "Request body must be an object.")
        return value

    def send_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(int(status))
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, message_format: str, *args: Any) -> None:
        print(
            json.dumps(
                {
                    "level": "info",
                    "client": self.client_address[0],
                    "message": message_format % args,
                }
            ),
            flush=True,
        )


class UploadError(Exception):
    def __init__(self, status: HTTPStatus, message: str):
        super().__init__(message)
        self.status = status


def decode_upload(payload: dict[str, Any]) -> bytes:
    value = payload.get("contentBase64")
    if not isinstance(value, str) or not value:
        raise UploadError(HTTPStatus.BAD_REQUEST, "contentBase64 is required.")

    try:
        content = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise UploadError(HTTPStatus.BAD_REQUEST, "contentBase64 is invalid.") from exc

    max_bytes = positive_integer_env("OCR_MAX_UPLOAD_MB", 10) * 1024 * 1024
    if not content:
        raise UploadError(HTTPStatus.BAD_REQUEST, "Receipt upload is empty.")
    if len(content) > max_bytes:
        raise UploadError(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "Receipt upload is too large.")
    return content


def validate_upload(content: bytes, content_type: str) -> None:
    normalized_type = content_type.split(";", maxsplit=1)[0].strip().lower()
    if normalized_type.startswith("image/"):
        from PIL import Image  # type: ignore

        try:
            with Image.open(io.BytesIO(content)) as image:
                max_edge = positive_integer_env("OCR_MAX_IMAGE_EDGE", 3000)
                if image.width > max_edge or image.height > max_edge:
                    raise UploadError(
                        HTTPStatus.UNPROCESSABLE_ENTITY,
                        f"Receipt image dimensions must not exceed {max_edge}px.",
                    )
                image.verify()
        except UploadError:
            raise
        except Exception as exc:
            raise UploadError(
                HTTPStatus.UNPROCESSABLE_ENTITY, "Receipt image is unreadable."
            ) from exc

    if normalized_type == "application/pdf":
        page_count = content.count(b"/Type /Page") - content.count(b"/Type /Pages")
        max_pages = positive_integer_env("OCR_MAX_PDF_PAGES", 5)
        if page_count > max_pages:
            raise UploadError(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                f"Receipt PDF must contain at most {max_pages} pages.",
            )


def safe_suffix(file_name: Any) -> str:
    if not isinstance(file_name, str):
        return ""
    suffix = Path(file_name).suffix.lower()
    return suffix if suffix in {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".pdf"} else ""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["health", "scan", "worker"])
    parser.add_argument("--input", type=Path)
    args = parser.parse_args()

    if args.command == "health":
        print(json.dumps(health()))
        return 0

    if args.command == "scan":
        if args.input is None:
            parser.error("--input is required for scan")
        print(json.dumps(scan(args.input)))
        return 0

    worker_loop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
