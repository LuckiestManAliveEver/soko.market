FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    OCR_ENGINE_PRIMARY=paddleocr \
    OCR_ENGINE_FALLBACK=tesseract \
    OCR_PROFILE=balanced \
    PADDLEOCR_HOME=/models

RUN apt-get update \
  && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng tesseract-ocr-swa libgomp1 libglib2.0-0 libgl1 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY worker.py .

HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD python worker.py health
CMD ["python", "worker.py", "worker"]
