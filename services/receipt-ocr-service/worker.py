#!/usr/bin/env python3
"""Self-hosted receipt OCR worker.

PaddleOCR is the primary engine. Tesseract is used only when PaddleOCR fails
and OCR_FALLBACK_ENABLED is not false. The worker emits structured JSON and is
safe to run as a queue consumer or one-shot CLI scanner.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any


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
    }


def worker_loop() -> None:
    print(json.dumps({"ok": True, "mode": "worker", **health()}), flush=True)
    while True:
        time.sleep(30)


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
