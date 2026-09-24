# agent

FastAPI + ADK service. Reads bills with Gemini, reconciles them with deterministic
tools, looks up cited emission factors, computes Scope 1 and 2 with plain Python,
fills the buyer's questionnaire and renders a methodology note.

```bash
uv pip install --python .venv/bin/python -e ".[dev]"
.venv/bin/pytest
.venv/bin/uvicorn app.main:app --reload --port 8000
```

Configuration comes from the repo-root `.env` (see `.env.example`).
