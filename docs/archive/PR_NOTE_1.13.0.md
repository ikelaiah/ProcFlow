# PR: v1.13.0 — Report intelligence

## Summary

Implements the **v1.13.0 — Report intelligence** milestone from `ROADMAP.md`
in full and nothing from v1.14.0 onwards: **report → dataset → object → column
dependency views** built on the v1.9.0 catalogue and the v1.11.0 column
contract, plus **F export fidelity for report graphs**. The golden suite grows
from 211 to 212; fuzz (400) and UI (27) stay green; 9 report-graph fixtures
assert the complete dependency chain, export parity and `.drawio` round-trip
identity, and presentation-only filtering, plus 2 report layout-budget
fixtures. Large-graph convergence (v1.14.0) remains deferred.

## What's included

### Report intelligence (`src/report.ts`)

- **`buildReportGraph`** — a new report dependency graph on its own documented
  `report` layout class:
  - report nodes (`report`) link to dataset nodes by kind
    (`dsembedded`/`dsshared`/`dsunresolved`);
  - each embedded dataset's SQL analysis (attached in v1.12.0) contributes
    object facts via `buildObjectIR` — reads/writes/calls become
    dependency/data/call edges to `repobj` nodes, catalogue-verified to their
    canonical identity where the v1.9.0 catalogue proves them;
  - each object links (`data`) to the columns its query references, from the
    v1.11.0 column contract: known source columns (catalogue/CTE-backed
    wildcards) and exact output bindings (source key → column, resolved back
    to the object). Nothing is ever invented.
- **`filterReportGraph`** — presentation-only filtering mirroring
  `filterDependencyGraph`: hide the column layer, dataset kinds, or external
  objects; a focus keeps a report/dataset/object and its direct neighbours.
  Returns a fresh copy; the underlying graph (and the analysis) is never
  mutated.

### Export fidelity (F)

- `src/exporters.ts` — canonical `report`, `dsembedded`, `dsshared`,
  `dsunresolved`, `repobj`, `repcol` node styles shared by both exporters.
- `tests/parity.ts` — the `report` layout class is documented in
  `PROCFLOW_LAYOUT_CLASSES` (node limit 30, crossing budget 0); enforcement
  lives in the new suite.
- Report graphs round-trip through Mermaid and draw.io with provenance
  metadata (spans, object identity, reasons), verified per-fixture.

### App wiring (`src/app.ts`, `index.html`)

- A **Report dependencies** option in the **Scope** selector, shown when a
  report is loaded, rendering `buildReportGraph(currentReport, {catalogue})`
  with the report stats (reports / datasets / objects / columns / embedded /
  shared) and report diagnostics.
- A **Filter report** command menu (presentation-only toggles + focus) wired
  like the dependency filter; `run()` shows it only in report scope.
- `data-procflow-ready` now also requires `buildReportGraph` and
  `filterReportGraph`.

### Fixtures and tests

- `tests/report-graph.ts` (+ `tests/index.html`, `tests/metrics.html`, and
  `report-graph.js` wiring) — 9 fixture records plus 1 integration record, and
  2 report layout-budget records: complete report→dataset→object→column
  chains, read/write/call edge kinds, shared datasets without invented object
  edges, unresolved datasets staying explicit, catalogue-verified object
  identity, multi-dataset reports, per-fixture Mermaid/draw.io export parity
  with provenance round-trip, and presentation-only filtering that never
  mutates the graph. Gates the golden page via `PROCFLOW_REPORTGRAPH_PASS` +
  `PROCFLOW_REPORTGRAPH_RESULT`.
- `tests/ui-tests.ts` — 2 new browser tests: the Report dependencies scope
  renders the chain, and the report filter hides columns presentation-only in
  the UI (27/27).
- `tests/tests.ts` — gates the golden page on the v1.13.0 report-graph suite.
- `tests/metrics.ts` → `docs/metrics-v1.13.0.json` — adds
  `reportGraphPassRate`, `reportGraphLayoutPassRate`, and the `reportGraph` (9)
  / `reportGraphLayout` (2) corpus counts; the v1.12.0 snapshot is renamed to
  v1.13.0 (old snapshot removed). All pre-existing corpus aggregates are
  byte-identical to v1.12.0.
- `examples/dbo.v1130_demo.rdl` — a report with two embedded datasets, a
  shared dataset, and an unresolved dataset, plus a catalogue to paste,
  demonstrating the report dependency view.

## Verification

- `npm run typecheck` — passes
- `npm run build` — passes
- `npm run test:file` — passes (with `CHROME_PATH` set)
- Golden suite — 212/212 (was 211)
- Fuzz suite — 400 deterministic mutation cases
- UI suite — 27/27 (was 25; the report scope and report filter are exercised
  end to end)
- `npm run metrics` — snapshot is current; `docs/metrics-v1.13.0.json`
  committed (v1.12.0 snapshot renamed), 100 % report-graph pass rate
- Local-only check clean; `dist/` committed in sync (adds `dist/tests/report-graph.js`)

## Not changed / deferred (per roadmap)

- Everything from v1.14.0 onwards — large-graph report layout convergence — is
  out of scope, as are interactive column views in the app (future release).
- Existing v1.1.0–v1.12.0 semantics are untouched; the corpus aggregates in
  `docs/metrics-v1.13.0.json` are byte-identical to v1.12.0 for every
  pre-existing metric, confirming no parser regression, and the full golden
  suite stays green.