# Changelog

All notable released ProcFlow changes are recorded here. Detailed verification
evidence belongs in the canonical release note under `docs/releases/`.

## v2.1.0 — Entity relationship diagrams

- Added the ERD page (`erd.html`): DDL parsing for declared tables, views,
  columns, primary/unique/foreign keys, and composite-key grouping across
  T-SQL, PostgreSQL, DB2, and SQLite, with raw type fidelity and source spans.
- Added deterministic Mermaid `erDiagram` export with declared cardinality,
  optionality, and provenance comments. Declared constraints only; unresolved
  references stay explicit.
- Added estate navigation: canvas panning, draggable tables, FK selection
  inspector, find/jump, compact boxes for large estates, and smooth wheel zoom
  with whole-estate Fit.
- Added a draggable editor/diagram divider on both pages and a clear
  Flowchart/ERD page switcher.
- Fixed view cards being hidden by a global class collision and Fit zooming
  out indefinitely on large estates.

## v2.0.0 — Trustworthy SQL Analysis Contract

- Added the cross-dialect adversarial semantic qualification matrix and its
  fixture-only `dialectAdversarialSemanticAssertionRate` metric.
- Reject newer and corrupt saved workspace schemas without coercion, mutation,
  or automatic deletion.
- Finalised the v2 accuracy and compatibility contract.

## v1.14.1 — Targeted correctness patch

- Preserved named PL/pgSQL `LATERAL` sources.
- Kept DB2 `PREPARE`/`EXECUTE` dynamic SQL opaque instead of asserting an
  object read or procedure call.
- Preserved unique sequential DB2 `SESSION.` temporary-table data flow.

See [the v1.14.1 release note](docs/releases/v1.14.1.md) and the
[accuracy audit](docs/ACCURACY_GAPS.md) for the reproductions and verification
record.
