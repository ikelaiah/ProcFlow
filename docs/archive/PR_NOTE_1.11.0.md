# PR: v1.11.0 — Column lineage pipelines

## Summary

Implements the **v1.11.0 — Column lineage pipelines** milestone from
`ROADMAP.md` in full and nothing from v1.12.0 onwards: **column-flow edges
through CTEs, views, temporary tables, transformations, and
catalogue-resolved object boundaries** (README roadmap item 6 delivered);
**F column metadata and column-flow export styles**; **E
column-resolution signals**; and the layout engine's **documented column
graph class**. The golden suite grows from 209 to 210; fuzz (400) and UI (22)
stay green; 15 column-flow fixtures assert end-to-end traces and opaque
ambiguity, plus 2 column layout-budget fixtures. RDL / report import (v1.12.0)
remains deferred.

## What's included

### Column-flow module (`src/columnflow.ts`)

A new runtime module (loaded after `columns.js`, before `exporters.js`) that
walks an object's statements in source order and tracks the column-level
reaching definition of each column-carrying object:

- **Reaching definitions across statements.** `SELECT … INTO` (v1.10.0
  fixtures already bound the projection), `INSERT … SELECT` (including explicit
  column lists and positional mapping onto a `CREATE TABLE` schema), `CREATE
  TABLE` DDL column lists, and `UPDATE … SET` transformations each define or
  refine an object's columns. Sequential writes replace the reaching
  definition (most-recent-writer wins, mirroring the v1.5.0 flow graph);
  conditional writes inside a branch/loop/handler mark the object `multi` at
  merge time.
- **End-to-end traces.** Every produced column carries its ultimate origin
  object and column (flattened through temp chains, e.g. `SELECT … INTO #b
  FROM #a` reports the original source, not `#a`), as `{source, sourceColumn,
  sourceSpan, resolution}`.
- **Consumers stay conservative.** A consumer binds back through an object's
  known columns; an ambiguous reaching definition (`multi`) or a column the
  object's definition does not produce stays explicitly opaque with a
  region-scoped, span-attached `column_flow_opaque` diagnostic — no binding is
  ever invented. A T-SQL `SELECT col = expr` alias target is no longer mistaken
  for a source-column reference.
- **Object boundaries.** Views defined earlier in the same script (seeded
  through `analyseEstate` → `opts.define`) and catalogue-proven external
  objects resolve column identity by definition; CTE scopes act as provable
  origins. `analyseColumns` trims trailing semicolons and a depth-0 `GO` batch
  separator at its entry point so raw view bodies analyse cleanly.
- **Export graph** (`buildColumnGraph`): a plain `Graph` on its own documented
  `column` layout class — a step spine in statement order plus column-carrying
  object nodes routed as data lanes — that `toMermaid`/`toDrawio` render with
  the new `colstep`/`colobj` canonical styles and full provenance metadata.

### Analysis integration (`src/ir.ts`)

`analyse()` computes `result.columnFlow` (the `ColumnFlow` model) and
`result.columnFlowGraph`, merges the region-scoped `column_flow_opaque`
diagnostics into the findings panel, and feeds a `column_flow` construct into
the existing construct-coverage surface (E signals with no new UI).
`analyseEstate()` threads same-script object definitions into later objects so
view boundaries resolve by definition. Confidence, coverage, exports, and all
pre-existing fixtures are untouched: clean pipelines produce no new
diagnostics.

### Types, styles, layout

- `src/types.d.ts` — `ColumnFlowOutput`, `ColumnFlowObject`, `ColumnFlowStep`,
  `ColumnFlowConsume`, `ColumnFlowEdge`, `ColumnFlow`, `AnalysisResult.columnFlow`
  / `columnFlowGraph`, `AnalyseOptions.define`, `PROCFLOW_COLUMNFLOW_*` globals.
- `src/exporters.ts` — canonical `colstep` and `colobj` node styles shared by
  both exporters (the distinct data-flow edge style already derives from the
  `data` edge kind).
- `tests/parity.ts` — the `column` layout class is documented in
  `PROCFLOW_LAYOUT_CLASSES` (node limit 28, crossing budget 0); enforcement
  lives in the new suite.

## Fixtures and tests

- `tests/column-flow.ts` (+ `tests/index.html`, `tests/metrics.html`,
  `column-flow.js`, and `src/columnflow.js` wiring) — 15 fixture-corpus
  records plus 2 integration records, and 2 column layout-budget records:
  end-to-end temp pipelines (`SELECT … INTO`, `UPDATE`, `INSERT … SELECT`
  with a `CREATE TABLE` schema and an explicit column list, CTE-fed temps),
  two-hop temp chains that flatten to the source, ambiguous IF/ELSE, branch
  and loop writes that read opaque, sequential-producer non-multi replacement,
  same-script view boundaries, catalogue-proven boundaries, clean plain/dynamic
  invariants, and per-fixture Mermaid/draw.io export parity with provenance
  round-trip and data-edge routing. Gates the golden page via
  `PROCFLOW_COLUMNFLOW_PASS` + `PROCFLOW_COLUMNFLOW_RESULT`.
- `tests/tests.ts` — gates the golden page on the v1.11.0 column-flow suite.
- `tests/metrics.ts` → `docs/metrics-v1.11.0.json` — adds
  `columnFlowPassRate`, `columnLayoutPassRate`, and the `columnFlow` (15) /
  `columnLayout` (2) corpus counts; the v1.10.0 snapshot is renamed to
  v1.11.0 (old snapshot removed). All pre-existing corpus aggregates are
  byte-identical to v1.10.0.
- `examples/dbo.v1110_demo.sql` — a view + three procedures demonstrating
  end-to-end temp pipelines, ambiguous branch reaching definitions, and
  same-script view boundary resolution (with a catalogue to paste).

## Verification

- `npm run typecheck` — passes
- `npm run build` — passes
- `npm run test:file` — passes (with `CHROME_PATH` set)
- Golden suite — 210/210 (was 209)
- Fuzz suite — 400 deterministic mutation cases
- UI suite — 22/22 (construct coverage now also shows the `column_flow` row)
- `npm run metrics` — snapshot is current; `docs/metrics-v1.11.0.json`
  committed (v1.10.0 snapshot renamed), 100 % column-flow pass rate
- Local-only check clean; `dist/` committed in sync (adds `dist/src/columnflow.js`
  and `dist/tests/column-flow.js`)

## Not changed / deferred (per roadmap)

- Everything from v1.12.0 onwards — RDL/report import, report → dataset →
  object → column views, and report export — is out of scope. Interactive
  column views remain scheduled for v1.13.0.
- Existing v1.1.0–v1.10.0 semantics are untouched; the corpus aggregates in
  `docs/metrics-v1.11.0.json` are byte-identical to v1.10.0 for every
  pre-existing metric, confirming no parser regression, and the full golden
  suite stays green.
