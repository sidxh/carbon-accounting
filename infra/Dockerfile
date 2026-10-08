# Agent service for Cloud Run. Build context is the repo root:
#   docker build -f infra/Dockerfile -t supplier-carbon-agent .
FROM python:3.12-slim

# WeasyPrint's native deps. Cheap on Linux; the exporter falls back to
# xhtml2pdf if they are ever missing.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz0b libcairo2 libgdk-pixbuf-2.0-0 \
    fonts-noto-core fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv

WORKDIR /srv
COPY agent/pyproject.toml agent/README.md ./
COPY agent/app ./app
COPY data/factors ./data/factors
COPY data/price_bands ./data/price_bands
COPY data/levers ./data/levers
RUN uv pip install --system --no-cache ".[pdf]"

# Data paths are absolute: inside the image the package no longer sits two levels under the
# repo root, so the defaults in settings.py would point nowhere. Cloud Run's filesystem is
# read-only apart from /tmp, which is where the two response caches go. Both are best effort.
ENV PORT=8080 PYTHONUNBUFFERED=1 \
    FACTORS_DIR=/srv/data/factors PRICE_BANDS_DIR=/srv/data/price_bands LEVERS_DIR=/srv/data/levers \
    GEMINI_CACHE_DIR=/tmp/gemini SOLAR_CACHE_DIR=/tmp/solar LOCAL_STORAGE_DIR=/tmp/storage \
    STORAGE_BACKEND=gcs
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
