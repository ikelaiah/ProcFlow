# proc>flow v1.11.0 — Column lineage pipelines

**Release date:** 2026-08-10

ProcFlow v1.11.0 turns single-statement column tracing into **column-flow
pipelines**: columns now flow across statements — through temporary tables,
transformations, views, CTEs, and catalogue-resolved object boundaries — and
every produced column is traced end-to-end to its original source object. This
delivers README roadmap item 6 (column-level lineage) in full. When a reaching
definition cannot be proven, ProcFlow stays conservative: an ambiguous
conditional write or branch merge keeps its consumer explicitly opaque with a
region-scoped diagnostic, and no binding is ever invented.

## Highlights

- **End-to-end temp-table pipelines.** `SELECT col INTO #t`, `INSERT … SELECT`
  (including explicit column lists and positional mapping onto a `CREATE TABLE`
  schema), and `UPDATE … SET` transformations define an object's columns; a
  later `SELECT` binds back through them, and each output is traced all the way
  to its origin — `SELECT … INTO #b FROM #a` reports the original source, not
  `#a`.
- **Object boundaries resolve by definition.** A view defined earlier in the
  same script seeds its columns into later objects, and catalogue-proven
  external objects resolve their column identity by catalogue evidence, instead
  of staying external.
- **Ambiguous reaching definitions stay opaque.** A temp written by an
  `IF`/`ELSE`, inside a loop, or in a handler marks the object ambiguous
  (`multi`); its consumers resolve to opaque with a span-attached
  `column_flow_opaque` diagnostic and no producer→consumer edge is drawn. A
  later sequential producer becomes the unique reaching definition again.
- **Column export metadata and styles.** The column-flow graph exports to
  Mermaid and draw.io with the new `colstep`/`colobj` canonical styles and full
  provenance metadata; data-flow edges keep their distinct routing lane.
- **Column layout class.** The column graph has its own documented `column`
  layout class — a monotonic step spine with object nodes routed as data lanes
  — meeting its overlap-free, monotonic, and crossing-free fixture budgets.
- **Column-resolution signals (E).** Column-flow objects and edges feed the
  existing **Constructs** panel as a `column_flow` row (detected / resolved /
  opaque), with diagnostics surfaced in **Diagnostics**; no new UI surface, and
  clean pipelines produce no noise. Interactive column views remain scheduled
  for v1.13.0.

## Correctness baseline

- TypeScript type-checking and a clean generated build;
- 210 golden, graph, dependency, exporter, provenance, boundary, diagnostic,
  confidence, export-parity, layout, workspace, catalogue, and column tests
  (up from 209);
- 400 deterministic mutation cases;
- 22 browser interaction and local-runtime tests;
- catalogue fixtures 13/13, column-lineage fixtures 18/18, column-flow
  pipeline fixtures 15/15 + column layout budgets 2/2, workspace
  persistence/filtering fixtures 13/13, export parity 20/20, layout budgets
  11/11, export traceability 69/69; and
- the fixture-corpus metric snapshot in `docs/metrics-v1.11.0.json`: 100 %
  attribution, 100 % semantic-edge coverage, 100 % provenance, 100 % region-span
  ratio, 100 % export-parity, 100 % export-traceability, 100 % layout budgets,
  100 % workspace pass rate, 100 % catalogue pass rate, 100 % column pass rate,
  and 100 % column-flow pass rate. Every pre-existing corpus aggregate is
  byte-identical to v1.10.0.

GitHub Actions continues to check that generated JavaScript is current, the
vendored Mermaid runtime remains pinned, runtime application files contain no
external URLs or network-submission APIs, browser storage is confined to the
opt-in persistence module, the local-file smoke test passes, and the metric
snapshot is current.

## Compatibility and upgrade notes

- The v1.11.0 analysis is a strict superset: object-level graphs, exports,
  confidence, coverage, and diagnostics are unchanged for clean queries.
  Column flow adds cross-statement bindings and findings, never renames or
  rewires existing nodes and edges.
- Exported `.drawio` files from earlier releases remain valid. The column-flow
  graph is exported as its own `column` layout class with provenance metadata.
- Saved workspaces are unchanged (schema v2 from v1.9.0).
- The local-only browser security model is unchanged.

## Security and privacy (v1.11.0)

- Column-flow analysis runs entirely in the browser tab on the
  pasted/imported SQL. Nothing is uploaded, executed, or sent to any API.
- No new network, storage, or telemetry paths were added; the only runtime that
  touches browser storage remains the opt-in workspace module.

## Known limitations

- Parsing is heuristic rather than compiler-grade.
- Dynamic SQL remains opaque.
- Column flow resolves objects defined earlier in the same script and
  catalogue-proven external objects; cross-file/workspace object definitions
  outside the catalogue stay unresolved. Interactive column views in the app
  remain scheduled for v1.13.0.
- RDL/report import remains scheduled for v1.12.0.

Verify critical column bindings and dependency conclusions against the original
SQL and the target database.

See [README.md](../README.md) for usage and development guidance.
