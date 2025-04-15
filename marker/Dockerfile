FROM python:3.10-slim

RUN apt-get update && apt-get install -y \
    poppler-utils \
    tesseract-ocr \
    libgl1 \
    && rm -rf /var/lib/apt/lists/*

RUN pip install marker-pdf[full] fastapi uvicorn python-multipart

COPY marker_api.py .
CMD ["uvicorn", "marker_api:app", "--host", "0.0.0.0", "--port", "8000"]