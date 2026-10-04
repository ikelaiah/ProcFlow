# PR: v1.12.0 — Report import

## Summary

Implements the **v1.12.0 — Report import** milestone from `ROADMAP.md` in full
and nothing from v1.13.0 onwards: **SSRS/RDL import** — parse report
definitions and link reports to datasets and each dataset to its SQL analysis
(README roadmap item 4 delivered); **E diagnostics** for report- and
dataset-parsing uncertainty. The golden suite grows from 210 to 211; fuzz (400)
and UI (25) stay green; 12 report-import fixtures assert report→dataset
linking, embedded/shared/unresolved dataset distinction, XML source locations,
and region/document-scoped diagnostics. Combined report dependency views and
report export (v1.13.0) remain deferred.

## What's included

### Report module (`src/report.ts`)

A new runtime module (loaded after `exporters.js`, before `workspace.js`) that
parses an SSRS/RDL report definition (XML) and links it to its datasets:

- **Report → dataset linking.** `parseReport(text)` finds every `<Report>`
  root (namespace-agnostic, so default-namespaced RDL parses), its data sources
  (embedded `ConnectionProperties` vs shared `DataSourceReference`), and its
  datasets. Each dataset is classified as **embedded** (its `<Query>` carries a
  `<CommandText>`), **shared** (a `<SharedDataSetReference>`), or
  **unresolved** (neither) — the exact distinction the v1.12.0 exit criteria
  require.
- **Dataset SQL analysis.** An embedded dataset's command text is run through
  the existing `analyse()` pipeline and attached as `dataset.analysis`, so each
  dataset links to its SQL analysis directly. Selecting an embedded dataset in
  the app loads its query and runs the full analysis.
- **XML source locations.** Report, data-source, dataset, and command-text
  regions are preserved as byte spans over the raw report text
  (`rdlOpenTags`/`rdlSpanForName`/`rdlInnerSpan`), so findings point at the
  exact RDL region that caused them.
- **E diagnostics with correct scope.** Malformed XML (`report_parse_error`),
  a missing `<Report>` root (`report_not_report`), and empty input
  (`report_empty`) are document-scoped with no fabricated span; an unresolved
  dataset (`report_dataset_unresolved`) is region-scoped at its own element
  span. `analyse()` merges these diagnostics into the findings panel and
  attaches the parsed report via `result.reportParse` / `result.reportDiagnostics`.

### Analysis integration (`src/ir.ts`, `src/types.d.ts`)

- `AnalyseOptions.reports` carries a parsed report definition; `analyse()`
  merges its diagnostics and attaches `AnalysisResult.reportParse` and
  `AnalysisResult.reportDiagnostics`.
- New v1.12.0 types: `ReportDatasetSource`, `ReportDataSource`, `ReportDataset`,
  `ReportDefinition`, `ReportParseResult`, plus the `PROCFLOW_REPORT_*` window
  globals. Confidence, coverage, exports, and all pre-existing fixtures are
  untouched: a clean report produces no new diagnostics.

### App wiring (`src/app.ts`, `index.html`)

- A **Reports** command menu mirrors the Catalogue menu: paste RDL or import a
  `.rdl`/`.xml` file, **Apply report**, **Clear**, a status line, and a
  **Dataset** picker listing every dataset with its source kind. Selecting an
  embedded dataset loads and analyses its query; shared/unresolved datasets
  stay listed for provenance.
- The report definition is captured in saved workspaces (optional field, schema
  v2 unchanged) so Save → Restore reproduces an identical analysis.
- `data-procflow-ready` now also requires `parseReport`.

### Fixtures and tests

- `tests/report.ts` (+ `tests/index.html`, `tests/metrics.html`, `report.js`,
  and `src/report.js` wiring) — 12 fixture records plus 3 integration/E records:
  embedded datasets link to their SQL analysis with XML source locations; data
  sources distinguish embedded/shared by reference; shared datasets have no SQL
  to analyse; unresolved datasets stay explicit with region-scoped diagnostics;
  mixed reports link all three kinds; multiple reports in one document link
  their own datasets; malformed XML, a missing `<Report>` root, and empty input
  are document-scoped with no fabricated span; a dataset-less report is an
  informational annotation, not a finding. Gates the golden page via
  `PROCFLOW_REPORT_PASS` + `PROCFLOW_REPORT_RESULT`.
- `tests/workspace.ts` — a new record asserts the report definition round-trips
  in a saved workspace and older snapshots migrate cleanly (14/14).
- `tests/ui-tests.ts` — 3 new browser tests: the Reports menu distinguishes
  embedded/shared/unresolved datasets, selecting an embedded dataset loads and
  analyses its SQL, and clearing the report resets the status and picker (25/25).
- `tests/tests.ts` — gates the golden page on the v1.12.0 report suite.
- `tests/metrics.ts` → `docs/metrics-v1.12.0.json` — adds `reportPassRate` and
  the `report` (12) corpus count; the v1.11.0 snapshot is renamed to v1.12.0
  (old snapshot removed). All pre-existing corpus aggregates are byte-identical
  to v1.11.0.
- `examples/dbo.v1120_demo.rdl` — a report definition with two embedded
  datasets, a shared dataset, and an unresolved dataset, plus a catalogue to
  paste, demonstrating the v1.12.0 territory.

## Verification

- `npm run typecheck` — passes
- `npm run build` — passes
- `npm run test:file` — passes (with `CHROME_PATH` set)
- Golden suite — 211/211 (was 210)
- Fuzz suite — 400 deterministic mutation cases
- UI suite — 25/25 (was 22; the report menu is exercised end to end)
- `npm run metrics` — snapshot is current; `docs/metrics-v1.12.0.json`
  committed (v1.11.0 snapshot renamed), 100 % report pass rate
- Local-only check clean; `dist/` committed in sync (adds `dist/src/report.js`
  and `dist/tests/report.js`)

## Not changed / deferred (per roadmap)

- Everything from v1.13.0 onwards — combined report dependency views and report
  export — is out of scope, as are interactive column views (v1.13.0).
- Existing v1.1.0–v1.11.0 semantics are untouched; the corpus aggregates in
  `docs/metrics-v1.12.0.json` are byte-identical to v1.11.0 for every
  pre-existing metric, confirming no parser regression, and the full golden
  suite stays green.