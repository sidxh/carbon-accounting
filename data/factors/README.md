# Emission factor library

One CSV per source. Every row carries the publishing body, a URL, the dataset
vintage and the geography and year it applies to, so the agent can cite the
factor it used rather than ask to be trusted.

Columns: `id,country,region,year,energy_type,method,value,unit,source_name,source_url,vintage,gas,notes`

- `value` is kgCO2e per `unit` (for `method=biogenic`, biogenic kgCO2 reported outside the scopes).
- `method`: `location` / `market` / `residual_mix` / `supplier_specific` for Scope 2 electricity;
  `fuel` for combustion; `gwp` for refrigerant global-warming potentials (unit `kg`); `biogenic`.
- `country` is ISO 3166-1 alpha-2, or `GLOBAL` for IPCC / DEFRA defaults used as fallback.

**Status.** Values were transcribed from the cited public sources for the demo.
Rows whose `notes` contain `VERIFY` should be re-checked against the source PDF
before this library is used for a real disclosure. The golden-set bills are
synthetic, so nothing here has been applied to real supplier data.

`build.py` validates every row against `app.models.Factor` and, with
`--firestore`, loads the library into the `factors` collection.
