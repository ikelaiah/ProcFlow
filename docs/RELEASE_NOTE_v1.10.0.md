# proc>flow v1.10.0 — Column lineage foundations

**Release date:** 2026-08-09

ProcFlow v1.10.0 starts tracing **columns**, not just objects. Every
query-bearing `SELECT` statement is now analysed at column level: which input
columns each projected output derives from, with the exact source span. When a
column cannot be proven, ProcFlow says so explicitly instead of guessing — an
ambiguous reference never invents a binding, and an unsupported expression
becomes opaque with a region-scoped diagnostic.

This is the **foundations** release (ROADMAP v1.10.0): scopes and bindings
within one query statement. Column flow across temporary tables, views, and
object boundaries — and the column export contract — remain on the roadmap
(v1.11.0).

## Highlights

- **Column scopes and bindings.** Qualified references (`s.id`), aliases,
  unqualified references to a single source, `SELECT … INTO #temp`, and
  expression-level provenance (`s.a + s.b AS total` maps `total` back to both
  `s.a` and `s.b`) all bind to the exact input column with its span.
- **CTE and derived-table scopes.** A CTE's explicit column list (`WITH r(n) AS
  …`) or its computed projection, and a derived table's projection, become
  provable column sets; references are verified against them.
- **Catalogue-backed wildcard expansion.** With a catalogue loaded,
  `SELECT t.*` expands to the catalogue's provable columns, each bound exactly.
  Without catalogue evidence a wildcard stays unexpanded and never invents
  columns.
- **Ambiguity never invents a column edge.** An unqualified reference that
  matches several sources (for example `SELECT id FROM a JOIN b`) is left
  unresolved with a region-scoped `column_ambiguous` diagnostic at the exact
  reference.
- **Explicit opaque references.** Unresolvable references (an unknown qualifier,
  a column outside a provable scope, a scalar subquery) become opaque with a
  region-scoped `column_opaque` diagnostic.
- **Diagnostics flow into the findings panel.** Column findings appear in
  **Diagnostics** and never inflate informational counts; clean bindings
  produce no noise.

## Correctness baseline

- TypeScript type-checking and a clean generated build;
- 209 golden, graph, dependency, exporter, provenance, boundary, diagnostic,
  confidence, export-parity, layout, workspace, catalogue, and column tests
  (up from 208);
- 400 deterministic mutation cases;
- 22 browser interaction and local-runtime tests;
- catalogue fixtures 13/13, column-lineage fixtures 18/18, workspace
  persistence/filtering fixtures 13/13, export parity 20/20, layout budgets
  11/11, export traceability 69/69; and
- the fixture-corpus metric snapshot in `docs/metrics-v1.10.0.json`: 100 %
  attribution, 100 % semantic-edge coverage, 100 % provenance, 100 % region-span
  ratio, 100 % export-parity, 100 % export-traceability, 100 % layout budgets,
  100 % workspace pass rate, 100 % catalogue pass rate, and 100 % column pass
  rate.

GitHub Actions continues to check that generated JavaScript is current, the
vendored Mermaid runtime remains pinned, runtime application files contain no
external URLs or network-submission APIs, browser storage is confined to the
opt-in persistence module, the local-file smoke test passes, and the metric
snapshot is current.

## Compatibility and upgrade notes

- The v1.10.0 analysis is a strict superset: object-level graphs, exports,
  confidence, coverage, and diagnostics are unchanged for clean queries.
  Column lineage adds bindings and findings, never renames or rewires existing
  nodes and edges.
- Exported `.drawio` files from earlier releases remain valid; column exports
  arrive with v1.11.0.
- Saved workspaces are unchanged (schema v2 from v1.9.0).
- The local-only browser security model is unchanged.

## Security and privacy (v1.10.0)

- Column analysis runs entirely in the browser tab on the pasted/imported SQL.
  Nothing is uploaded, executed, or sent to any API.
- No new network, storage, or telemetry paths were added; the only runtime that
  touches browser storage remains the opt-in workspace module.

## Known limitations

- Parsing is heuristic rather than compiler-grade.
- Dynamic SQL remains opaque.
- Column lineage is single-statement only: temporary-table producer→consumer
  column flow, inter-object column flow through CTE/view boundaries, and the
  final column export contract remain scheduled for v1.11.0.
- RDL/report import remains scheduled for v1.12.0.

Verify critical column bindings and dependency conclusions against the original
SQL and the target database.

See [README.md](../README.md) for usage and development guidance.
