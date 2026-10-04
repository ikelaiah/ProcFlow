# proc>flow v1.13.0 — Report intelligence

**Release date:** 2026-08-17

ProcFlow v1.13.0 turns an imported SSRS/RDL report into a **report →
dataset → object → column dependency view**, built on the v1.9.0 catalogue and
the v1.11.0 column contract. The **Report dependencies** scope draws the
complete chain, exports it with full provenance, and filters it
presentation-only — a filter never changes the analysis it is applied to.
Large-graph report layout convergence stays scheduled for v1.14.0.

## Highlights

- **Report → dataset → object → column chain.** Each report links to its
  datasets (embedded, shared, unresolved); each embedded dataset's SQL analysis
  links to the objects it reads/writes/calls — catalogue-verified to their
  canonical identity where the v1.9.0 catalogue proves them — and each object
  links to the columns its query actually references, from the v1.11.0 column
  contract. No column is ever invented.
- **Shared and unresolved datasets stay explicit.** A shared dataset keeps its
  external shared-dataset identity (no object edges); an unresolved dataset has
  neither a command text nor a shared reference and is drawn with an explicit
  unresolved node rather than guessed.
- **F export fidelity for report graphs.** The report graph exports to Mermaid
  and draw.io with full provenance metadata (`report`/`dsembedded`/`dsshared`/
  `dsunresolved`/`repobj`/`repcol` canonical styles), on its own documented
  `report` layout class, and `.drawio` round-trips preserve report/dataset
  source identity (spans, object identity, provenance, reasons).
- **Presentation-only filtering.** The **Filter report** menu hides datasets by
  kind, the column layer, or external objects, and focuses on a report,
  dataset, or object and its direct neighbours — all at render time, never
  mutating the underlying graph.

## Correctness baseline

- TypeScript type-checking and a clean generated build;
- 212 golden, graph, dependency, exporter, provenance, boundary, diagnostic,
  confidence, export-parity, layout, workspace, catalogue, column, report, and
  report-graph tests (up from 211);
- 400 deterministic mutation cases;
- 27 browser interaction and local-runtime tests (up from 25);
- catalogue fixtures 13/13, column-lineage fixtures 18/18, column-flow
  pipeline fixtures 15/15 + column layout budgets 2/2, workspace
  persistence/filtering fixtures 14/14, export parity 20/20, layout budgets
  11/11, export traceability 69/69, report-import fixtures 12/12, report-graph
  fixtures 9/9 + report layout budgets 2/2; and
- the fixture-corpus metric snapshot in `docs/metrics-v1.13.0.json`: 100 %
  attribution, 100 % semantic-edge coverage, 100 % provenance, 100 % region-span
  ratio, 100 % export-parity, 100 % export-traceability, 100 % layout budgets,
  100 % workspace pass rate, 100 % catalogue pass rate, 100 % column pass rate,
  100 % column-flow pass rate, 100 % report pass rate, and 100 % report-graph
  pass rate. Every pre-existing corpus aggregate is byte-identical to v1.12.0.

GitHub Actions continues to check that generated JavaScript is current, the
vendored Mermaid runtime remains pinned, runtime application files contain no
external URLs or network-submission APIs, browser storage is confined to the
opt-in persistence module, the local-file smoke test passes, and the metric
snapshot is current.

## Compatibility and upgrade notes

- The v1.13.0 analysis is a strict superset: object-level graphs, exports,
  confidence, coverage, and diagnostics are unchanged. Report intelligence adds
  a new scope and findings surface; it never renames or rewires existing nodes
  and edges.
- Exported `.drawio` files from earlier releases remain valid. The report graph
  is exported as its own `report` layout class with provenance metadata.
- Saved workspaces are unchanged (schema v2 from v1.9.0).
- The local-only browser security model is unchanged.

## Security and privacy (v1.13.0)

- Report dependency analysis runs entirely in the browser tab on the
  pasted/imported RDL and SQL. Nothing is uploaded, executed, or sent to any
  API.
- No new network, storage, or telemetry paths were added; the only runtime that
  touches browser storage remains the opt-in workspace module, and the report
  module (`dist/src/report.js`) parses report definitions in memory only.

## Known limitations

- Parsing is heuristic rather than compiler-grade.
- Dynamic SQL remains opaque.
- The object→column layer shows columns a dataset query references when the
  column contract or catalogue proves them; unproven columns are never invented.
- Large-graph report layout convergence remains scheduled for v1.14.0.
- Interactive column views in the app remain scheduled for a future release.

Verify critical dependencies and report findings against the original RDL and
the target report server.

See [README.md](../README.md) for usage and development guidance.