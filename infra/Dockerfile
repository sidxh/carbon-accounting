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
RUN uv pip install --system --no-cache ".[pdf]"

ENV PORT=8080 PYTHONUNBUFFERED=1 FACTORS_DIR=/srv/data/factors
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
