# Evaluation guide

How to walk the product in about fifteen minutes, what to expect at each step, and the exact logic, with sources,
behind what you see. Nothing here is hidden behind "the AI decided": where a model is involved the doc says so.

- **App:** https://supplier-carbon-web--fir-testing-f96b1.asia-southeast1.hosted.app
- **Accounts:** evaluator accounts are supplied with the submission. Sign-in is email and password; sign-up is off.
- **Sample data:** all bills are synthetic. The product offers its own sample pack and sample customer sheet.

## 1. The walk

| # | Do this | Expect |
|---|---|---|
| 1 | Sign in, set up: company, country **Japan**, fiscal year April 2025 to March 2026, one site | Lands on the dashboard. A request is one customer's questionnaire; a year can hold several requests, and a supplier can hold several years |
| 2 | **Bills** page: "Download sample bills to upload", then drop the zip on the page as it is | 31 files read four at a time, in tens of seconds. Each shows type, period, quantity and unit |
| 3 | Look at what the pack contains (its `README.txt` lists every file) | A duplicate photo counted once; a PDF; a sideways scan; a fax; hand-written slips (one dated 令和8年); a misprinted total; a missing January |
| 4 | **Questions** (the reconciler) | Asks only about the real gaps: the missing January and the misprinted November bill, one at a time, in your language. Answer in your own words |
| 5 | **Inventory** | Scope 1 and Scope 2 (location and market) by month and fuel. Open any row: the bill with the figure highlighted ("show bill"), the factor with its source and vintage, and `quantity x factor`. Edit a reading and the totals follow |
| 6 | **Questionnaire**: download "Sample questionnaire" (a Japanese buyer's sheet that matches the bills), upload it, fill | The customer's own Excel, answered in place with cell comments citing the source; targets and similar facts the bills cannot give are left highlighted for you |
| 7 | Same page, "No spreadsheet?": open the **CDP SME**, **EcoVadis**, **Higg FEM** packs and the **EU VSME** card | Four different shapes of the same numbers (section 5). VSME downloads EFRAG's official template, filled |
| 8 | **Reduce** | Rooftop solar sized to the site's own use, other levers with sources, tonnes avoided on both Scope 2 bases, payback; "Download recommendations" gives a PDF with a citation per recommendation |
| 9 | **Questionnaire** page, "Download methodology note" | A PDF: narrative, factor table with sources and vintages, the assumptions you gave in chat |
| 10 | Switch language (English, Tiếng Việt, 日本語) | Nav, questions and notes change language; no number changes |

Try Vietnam or Australia as the country on a second year to see the country logic below change the outcome.

## 1b. The range of bills to try

The product's core promise is reading the bills a supplier really has. The sample pack and the golden set cover it,
so feel free to upload your own photos too:

- **Languages:** Japanese, Vietnamese and English. 80 labelled synthetic bills (31 Vietnamese, 42 Japanese, 7 Australian)
  in the style of EVN, Chubu Electric Power Miraiz, Toho Gas, SA Power Retail and local fuel dealers.
- **Formats:** PNG, JPG, PDF, or a zip of them.
- **Paper and digital:** printed, phone photo at an angle, sideways scan, fax, hand-written slips (including Reiwa-era dates).
- **Shapes:** day and night meter registers, two-month city gas, fuels in litres, kilograms or cans, refrigerant certificates.
- **Trouble on purpose:** a misprinted total, a missing month, a duplicate photo, a month that does not fit the pattern.
  Each is caught by a deterministic check and turned into a question, never silently changed.

## 2. How an emission figure is calculated

Plain arithmetic in [`calculator.py`](agent/app/calculator.py), no model: `kgCO2e = quantity x factor`. Everything
interesting is in which factor.

### 2.1 Factor selection hierarchy

[`factor_library.select`](agent/app/factor_library.py) and
[`calculator._choose_with_conversion`](agent/app/calculator.py), in this order:

1. **Geography beats unit.** Try the country's own factors first (`allow_global=False`), in the line's unit and then
   in every other unit that fuel can be converted to (deterministic, in [`units.py`](agent/app/units.py) and
   [`data/factors/ncv/`](data/factors/ncv)). Only if the country has nothing for that fuel does it use the global
   DEFRA or IPCC factor, again in the line's unit first. A national factor in kilograms beats a generic one in the
   line's litres, because the conversion is exact and the geography is not.
2. **Within a country:** a sub-national (regional) factor if the site has a region, else the national one, else global.
3. **Within the chosen set, the vintage:** the same year; else the most recent year before it; else the earliest
   after it. A stale row is never taken when a closer one exists. If the year is not exact, the line says so
   ("2024 factor used as nearest available vintage for 2025").
4. **Electricity has two lines**, location-based and market-based (GHG Protocol Scope 2 Guidance), both shown.
   Market-based walks `supplier_specific`, then `residual_mix`, then falls back to the grid average, and the
   fallback is recorded on the line (`fell_back_to`) and shown.
5. **Refrigerants** need the blend (R-410A, R-32 and so on) and take its GWP; a missing blend is a question to the
   supplier, not a default.
6. A line that cannot be converted or has no factor is **skipped with a reason**, never estimated silently.

### 2.2 How it varies by country

| Country | Grid electricity (location) | Market-based | Fuels | Sub-national |
|---|---|---|---|---|
| **Japan** | MOE / METI national average factor, FY2022 to FY2024 | No residual mix shipped: falls back to the grid, disclosed | Japan MOE calculation factors: light oil, LPG, city gas 13A, gasoline, kerosene | No |
| **Australia** | DCCEEW National Greenhouse Accounts Factors 2024, national and NSW/ACT, VIC, QLD, SA, WA (SWIS), TAS | NGA residual mix factor | NGA 2024: diesel, LPG, natural gas | **Yes**, by the site's state |
| **Vietnam** | MONRE Department of Climate Change national grid factor, 2021 to 2025 | Falls back to the grid, disclosed | No national fuel table: DEFRA 2024, IPCC 2006 | No |
| **Singapore** | Energy Market Authority grid emission factor, 2021 to 2024 | Falls back to the grid | DEFRA, IPCC | No |
| **Thailand** | TGO grid emission factor, 2022 and 2023 | Falls back to the grid | DEFRA, IPCC | No |
| **Indonesia, India** | Indonesia MEMR national grid factor (2022); India CEA CO2 Baseline Database v19 (2022) | Falls back to the grid | DEFRA, IPCC | No |

Why the same kilowatt-hour differs: in the shipped factors, a kWh in South Australia is far cleaner than one in
Victoria or Vietnam. That is the point of picking the factor by country and region, and it is visible in the
inventory row.

Global fallbacks (DEFRA GHG Conversion Factors 2024, IPCC 2006 Guidelines Vol. 2 Ch. 2) carry the biogenic share of
wood and similar fuels separately, outside the scopes, as GHG Protocol requires.

### 2.3 Sources

Every row in [`data/factors/`](data/factors) carries `source_name`, `source_url`, `vintage`, geography and year.

| Factor set | Publisher | Link |
|---|---|---|
| Australia | DCCEEW, National Greenhouse Accounts Factors 2024 | https://www.dcceew.gov.au/climate-change/publications/national-greenhouse-accounts-factors |
| Japan | Ministry of the Environment, GHG emissions calculation, reporting and publication system | https://ghg-santeikohyo.env.go.jp/calc |
| Vietnam | MONRE Department of Climate Change | https://dcc.gov.vn/ |
| Singapore | Energy Market Authority | https://www.ema.gov.sg/resources/singapore-energy-statistics/chapter2 |
| Thailand | Thailand Greenhouse Gas Management Organization | http://thaicarbonlabel.tgo.or.th/ |
| Indonesia | Ministry of Energy and Mineral Resources | https://gatrik.esdm.go.id |
| India | Central Electricity Authority | https://cea.nic.in/cdm-co2-baseline-database/ |
| Global fuels and GWPs | UK Government GHG Conversion Factors 2024 (IPCC AR5 GWP-100) | https://www.gov.uk/government/collections/government-conversion-factors-for-company-reporting |
| Global fuels | IPCC 2006 Guidelines, Vol. 2 | https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol2.html |
| Energy content for fuels (kWh, MJ answers) | EFRAG VSME Digital Template 1.3.0, Fuel Conversion Parameters | https://xbrl.efrag.org/downloads/vsme/VSME-Digital-Template-1.3.0.xlsx |

Status, stated plainly: values were transcribed from these public sources for the demo. Rows whose `notes` say
`VERIFY` are flagged for a check against the source before a real disclosure.

## 3. Checks on the bills

A bill is tested against itself before any number is used ([`checks.py`](agent/app/checks.py)):

1. **Index**: meter readings times multiplier must reproduce the printed quantity within 0.5 % or one unit.
2. **Price**: amount divided by quantity must sit inside the country's plausibility band for that fuel
   ([`price_bands.csv`](data/price_bands/price_bands.csv): Vietnam, Japan and Australia; an analyst-set envelope,
   labelled so). Only applied to a bill with a single energy line.
3. **Season**: a month far from the carrier's own pattern.
4. **Gaps and duplicates**: a missing month in a periodic carrier (electricity, gas, LPG, steam, cooling), and the
   same bill photographed twice ([`reconcile_tools.py`](agent/app/reconcile_tools.py)).

A failure becomes a question, with a suggested corrected quantity; the supplier decides.

## 4. Reductions: the solar fallback hierarchy

[`services.build_advice`](agent/app/services.py), [`solar.py`](agent/app/solar.py), [`advisor.py`](agent/app/advisor.py).
Nothing is exported in the model: solar is **sized to what the site uses, never to what the roof could make**.

**Where the sunshine and roof figure comes from, in order:**

1. **Google Solar API, building insights** at the site's coordinates (address typed with Places suggestions, or pasted
   coordinates). It returns the roof area and panel layouts with yearly kWh. The layout whose AC output (DC x 0.85)
   still fits the site's use is chosen; if even the smallest layout exceeds use, generation is capped at use; if the
   roof is the limit, we say so. Labelled "Google Solar API".
2. **PVGIS (EU Joint Research Centre), ERA5 irradiance**, when Google has no roof data (a 404, which is the case for
   Vietnam). Yield is kWh per kWp per year, 14 % losses, optimal tilt. It needs a roof area, so:
3. **Ask for the roof area.** With it: usable kWp = roof area x 60 % usable x 0.2 kWp per m2, capped at what the site
   uses. Without it, no solar number is shown, only a prompt. Labelled "EU JRC PVGIS", with the assumption printed.
4. If neither source has data, solar is marked unavailable and the other levers still show.

The result always says which of 1 or 2 it used (`precision`), so a measured figure is never passed off as an estimate.

**Cost and payback:**

- **Tariff:** the supplier's own bills first (average price per kWh over bills with one electricity line, all-in,
  one currency); else the middle of the country price band, described as such.
- **Installed cost:** [`solar_costs.csv`](data/levers/solar_costs.csv) per kWp for Vietnam, Japan, Australia. These are
  analyst estimates, labelled so. No installed cost or no matching currency means no payback is shown, with a note.

**Other levers** ([`levers.csv`](data/levers/levers.csv)), each shown as a range, only when the inventory has
something for it to act on:

| Lever | Acts on | Source |
|---|---|---|
| LED lighting retrofit | Electricity | US DOE, LED lighting |
| Compressed-air leak repair | Electricity | US DOE, Compressed air systems |
| Refrigerant leak checks and repair | Refrigerant Scope 1 | US EPA, Stationary refrigeration leak repair |
| Switch LPG heating to electric | LPG Scope 1, **net of the extra electricity at your grid factor**; shown as not beneficial where the grid is too carbon-heavy | Analyst estimate, calculation shown |
| Renewable certificates | Market-based Scope 2 only | I-REC Standard |

Electricity-side options draw on the same kWh, so together they cannot cut more than Scope 2 itself; the screen and
the PDF use the same rule ([`advisor.scenario`](agent/app/advisor.py)).

## 5. The four default questionnaires

Every bank in [`data/questionnaires/`](data/questionnaires) lists the publisher's numbering and wording, a version
and source URL, and for each question the field in our data that answers it (or `null`, meaning "answer in the portal").
All four read the same facts ([`facts.py`](agent/app/facts.py)), so the numbers agree across them.

| | **CDP SME** | **EcoVadis** | **Higg FEM** | **EU VSME** |
|---|---|---|---|---|
| Publisher | CDP | EcoVadis | Cascale (Higg Index), answered on Worldly | EFRAG |
| Scope | Climate module 20 plus identification questions | Carbon metrics in Environment (Energy Consumption and GHGs) | Energy Use and GHG section, 2025 | Modules B1 (basis for preparation) and B3 (energy and GHG) |
| Delivery | Portal: we give an **answer pack** | Portal: **answer pack** | Portal: **answer pack** | **Excel**: we fill EFRAG's official template |
| Wording | Verbatim from CDP's guidance PDF | Metric names as EcoVadis prints them, never as numbered questions; the rest labelled as topics | Verbatim, with Cascale's Ref IDs | Verbatim labels from the template, filled through its named ranges |
| Questions in our bank | 20 (14 answerable from bills, 6 for the portal) | 8 | 13 (8 answerable, 5 for the portal) | 13 (12 filled, 1 left for you) |
| What differs | Scope 1, Scope 2 on both bases, verification status, year-on-year, allocation to the requesting customer | Scope 2 as **two** metrics since 7 May 2026; scored on the **evidence behind** the answer, so the pack lists the document to attach | Wants **quantities by source** (it computes emissions itself, converts to MJ and uses IPCC AR6 GWPs, so its result differs slightly from ours, and the pack says so); verified on site, so the pack lists invoices to bring | The template computes its own validation; we keep its dropdowns, protection and formulas and set recalculate-on-open |
| Version and source | 2024 SME Questionnaire and Reporting Guidance, v1.0 (30 April 2024) <https://cdn.cdp.net/cdp-production/comfy/cms/files/files/000/009/090/original/CDP_2024_SME_Questionnaire_-_PDF_export.pdf> | Methodology Updates Q1 2026, release 32.9 <https://support.ecovadis.com/hc/en-us/articles/34621845310994-Methodology-Updates-Q1-2026> | Higg FEM 2025 Question by Question Guidance <https://howtohigg.cascale.org/higg-index-tools/higg-fem/higg-fem-2025-question-by-question-guidance/energy-use-ghg-2025/> | VSME Digital Template 1.3.0 (MIT licence) <https://xbrl.efrag.org/downloads/vsme/VSME-Digital-Template-1.3.0.xlsx> |

A third mode covers a customer's **own spreadsheet**: its shape is read per row, a model maps only the wording to a
field, and code writes the number, a source comment and a highlight on anything left to the supplier
([`agents/harvest.py`](agent/app/agents/harvest.py), [`agents/filler.py`](agent/app/agents/filler.py)). The
"sample customer questionnaire" on the page is a bilingual Japanese and English one.

Three rules visible in all of them: a **wrong number** (a cell holding a figure different from the arithmetic) and an
**unsafe fill** (a cell that should have been left to the supplier but was answered) must both be zero; a question we
cannot answer from bills is never answered; a figure that needs the supplier's confirmation is marked yellow.

## 6. Measured results

All reproducible from the repo (commands in [README.md](README.md)); figures from the last run.

| Measure | Result |
|---|---|
| Automated tests | 211, none need a network or a model |
| Pack bills read correctly (the 31 Japanese sample files) | 31 of 31 |
| Golden-set core field accuracy (energy type, quantity, unit, period) | 100 % (target at least 90 %) |
| Quantity box overlap with the labelled box | IoU of 0.5 or better on 86.7 % of images, mean 0.71 |
| Self-checks on clean bills | No false alarm on 30 of 30; the planted misread is caught |
| Questionnaire cells filled | 41 of 41 correct offline and with the live model; 0 wrong numbers, 0 unsafe fills |
| End-to-end run of 41 bills | About 26 s |
| One Vertex AI call | About 2.6 s |

The golden set is synthetic and drawn by [`data/golden/render.py`](data/golden/render.py), with its ground truth in
`labels.json`; the Japanese pack has its own, in `labels_pack.json`, kept apart so the accuracy gate is not held to the hard
cases. The extractor is scored by [`scripts/eval_extraction.py`](agent/scripts/eval_extraction.py), the
questionnaire filler by [`scripts/eval_questionnaires.py`](agent/scripts/eval_questionnaires.py).

## 7. What we do not claim

- The bills are synthetic, so no real supplier's data has gone through this.
- Factors are transcribed from public sources; `VERIFY` rows need a source check before a real disclosure.
- Price bands and solar installed costs are analyst estimates.
- Scope 3 is out of scope. Product footprints (PACT, Catena-X) are out of scope.
- Buyer portals (Secaro, Project Gigaton and similar) are not integrated; the answer pack carries the same numbers.
