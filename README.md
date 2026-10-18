# NetZero

**The sustainability team a small supplier does not have.** A factory in Vietnam, Japan or Australia uploads its
electricity and fuel bills, and gets back its Scope 1 and 2 inventory, the customer's questionnaire filled in, and a
plan to cut the bill. Every number traces to a document the supplier gave us and a published emission factor. Nothing
is guessed.

- **Live app:** https://supplier-carbon-web--fir-testing-f96b1.asia-southeast1.hosted.app
- **Evaluator login:** email `evaluator1@siddhantxh.com`, password `evaluator1` (sign-up is off; all bills are synthetic)
- **The problem, with sources:** https://supplier-carbon-web--fir-testing-f96b1.asia-southeast1.hosted.app/problem

## Where to go next

| Read | When | What is in it |
|---|---|---|
| [EVALUATION.md](EVALUATION.md) | You want to **test** it | A ten-step walk with what to expect at each step; how an emission figure is calculated and the exact factor hierarchy; how the factors vary by country, with every source; the checks on a bill; the solar fallback logic (Google Solar API, then PVGIS, then ask for the roof area); how the four default questionnaires differ; measured results; what we do not claim |
| [TECHNICALS.md](TECHNICALS.md) | You want to know **how it works** | The Google stack service by service; what the model does and never does; how latency stays at a few seconds; how every number is grounded and cited, step by step through the code; self-checks; questionnaires without a model writing numbers; auth, delivery, limits |

## Built on Google, end to end

Every layer runs on a Google service, each doing one clear job:

- **Gemini 3.5 Flash-Lite on Vertex AI:** reads every bill (photo, scan, PDF, handwriting) into structured data, phrases the
  follow-up questions, and maps the wording of a customer's questionnaire to our fields.
- **Google ADK (Agent Development Kit):** runs the reconciler agent that records the supplier's answers.
- **google-genai SDK:** one client for all model calls, with strict response schemas, a rate limiter and a response cache.
- **Google Solar API:** measures the real roof and panel layouts to size rooftop solar to the site's use.
- **Google Geocoding API:** turns the site address into coordinates for the solar lookup.
- **Google Places API (New):** address suggestions as the supplier types.
- **Firebase App Hosting:** serves the Next.js web app.
- **Cloud Run:** runs the FastAPI agent, scaled to zero when idle.
- **Cloud Build and Artifact Registry:** build and store the agent image on every deploy.
- **Firebase Authentication:** email and password sign-in; the user id is the supplier id, so data is isolated by construction.
- **Cloud Firestore:** every line, issue, assumption and chat message, so any device resumes where another stopped.
- **Cloud Storage:** the uploaded bills and generated files, served through signed links.
- **Secret Manager:** API keys, never in code or in the browser.
- **IAM and Workload Identity Federation:** GitHub deploys to Google Cloud with no key files.
- **Cloud Logging:** request logs for checking a live deploy.

Outside Google, only one data source: PVGIS (EU Joint Research Centre), as the solar fallback where Google has no roof data.

## The core promise: it reads the bills you actually have

Real suppliers do not have clean exports. NetZero is built for the range, in the languages the suppliers work in:

- **Languages:** Japanese, Vietnamese and English bills, read natively (no translation step), with the supplier's chat
  and the questions in English, Vietnamese or Japanese.
- **Tested on:** 80 labelled sample bills in the style of the utilities and fuel dealers factories really buy from: 31
  Vietnamese (EVN electricity, Petrolimex LPG, local diesel and refrigerant slips), 42 Japanese (Chubu Electric Power
  Miraiz, Toho Gas, local fuel dealers, including a full 31-bill year for a Japanese manufacturer) and 7 Australian
  (SA Power Retail and others). The 31-bill Japanese year is read 31 of 31 correctly, and the golden set scores 100 %
  on core fields.
- **Formats:** PNG, JPG and PDF, one at a time or a whole zip dropped on the page; four read in parallel.
- **Digital or paper:** printed and digital bills, phone photos taken at an angle, a flatbed scan fed in sideways, a fax
  with streaks, and hand-written slips, including Japanese Reiwa-era dates.
- **Shapes of bill:** electricity with day and night meter registers; city gas in m3 over two months; diesel, petrol,
  kerosene and LPG deliveries in litres, kilograms or cans; refrigerant fill certificates; bills that straddle two
  reporting years.
- **Surges and odd months:** an unusual month is checked against the supplier's own pattern, and the price on the bill
  against a cited range, then confirmed with the supplier, not silently accepted.
- **Printing mistakes and misreads:** the meter readings must reproduce the printed total; a stray digit is caught and
  turned into a question with a suggested fix.
- **Duplicates and gaps:** the same bill photographed twice is counted once; a missing month is asked about.

Everything the product says about a number can be opened: the bill with the figure highlighted, the factor with its
source and vintage, and the arithmetic.

## What it does

| Step | What the supplier sees | Where it lives |
|---|---|---|
| Set up | Company, country, reporting year, sites (one per customer request, many years) | `web/src/app/setup`, `web/src/app/home` |
| Upload | Photos, PDFs and zips of bills, in any language, read four at a time | `web/src/app/r/[rid]/documents`, `agent/app/agents/extractor.py` |
| Fill the gaps | Questions only about the exact month or bill that is missing or looks wrong | `agent/app/reconcile_tools.py`, `agent/app/agents/reconciler.py` |
| Inventory | Scope 1, Scope 2 (location and market) by month and fuel; open any number; fix a reading in place | `agent/app/calculator.py`, `web/src/app/r/[rid]/inventory` |
| Answer the customer | Their own Excel filled in place, or an answer pack for CDP SME, EcoVadis and Higg FEM, or EFRAG's official VSME template | `agent/app/agents/filler.py`, `packs.py`, `vsme.py` |
| Cut | Rooftop solar sized from Google Solar API (PVGIS fallback), other levers with citations, a downloadable PDF | `agent/app/advisor.py`, `solar.py` |
| Prove | A methodology note: narrative, factor table with sources and vintages, assumptions | `agent/app/exporters/methodology.py` |

## Run it locally

You need Node 22, pnpm, Python 3.12+ with `uv`, and Java 21+ (for the Firebase emulators). Copy `.env.example` to
`.env` and fill it in; the file is gitignored.

```bash
scripts/dev.sh emulators   # Firebase Auth + Firestore emulators, UI on :4000
scripts/dev.sh agent       # FastAPI on :8000
scripts/dev.sh web         # Next.js on :3000
scripts/dev.sh seed        # create the evaluator accounts in the emulator
```

Tests and checks:

```bash
cd agent && .venv/bin/pytest                                   # 213 tests, no network, no model
cd agent && PYTHONPATH=. .venv/bin/python -m scripts.eval_extraction            # reader accuracy on the golden set
cd agent && PYTHONPATH=. .venv/bin/python -m scripts.eval_questionnaires        # questionnaire fill accuracy
cd web && npx tsc --noEmit && pnpm lint
```

## Repo map

```
agent/        FastAPI service: extraction, checks, calculator, advisor, questionnaires, exports (+ tests, evals)
web/          Next.js app (pages under src/app, copy under messages/)
data/         factors, price bands, levers, questionnaire banks, templates, golden set (every row cited)
infra/        Cloud Run, Cloud Build, Firestore and Storage rules, deploy.sh
```

## Data and honesty

The sample bills are synthetic, drawn in the languages, formats and issuers' styles above; no real supplier's data has
gone through the system. Emission factors are transcribed from the cited public sources; rows marked `VERIFY`
in `data/factors/` and `data/levers/` should be re-checked against the source before a real disclosure. Solar
installed-cost and tariff bands are analyst estimates and are labelled that way in the product.
