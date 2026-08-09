# PR: v1.10.0 — Column lineage foundations

## Summary

Implements the **v1.10.0 — Column lineage foundations** milestone from
`ROADMAP.md` in full and nothing from v1.11.0 onwards: column **scopes and
bindings** for qualified references, aliases, projections, CTEs, derived
tables, and catalogue-backed wildcard expansion; **expression-level
provenance** within one query statement; and **explicit ambiguous and opaque
column references**. The golden suite grows from 208 to 209; fuzz (400) and UI
(22) stay green; 18 column fixtures assert exact input→output mappings and
spans, that ambiguity never invents a column binding, and that unsupported
expressions become opaque with region-scoped diagnostics. Multi-statement
temporary-table column flow, inter-object column flow, the column export
contract (all v1.11.0), and RDL (v1.12.0) remain deferred.

## What's included

### Column-lineage module (`src/columns.ts`)

A new runtime module (loaded after `ir.js`) that analyses one query statement
down to column level:

- **Scope builder** (`colParseSources` / `colRegionsOf` / `colSplitArms`):
  parses the projection and FROM regions of each `SELECT` arm, splitting
  comma-separated sources and `JOIN`/`APPLY` items, and records each source's
  alias, underlying name, kind (`table` / `cte` / `derived` / `tabfunc` /
  `opaque`), provable columns, and span.
- **Provable scopes**: a CTE's explicit column list (`WITH r(n) AS …`) or
  computed projection, a derived table's projection, a tabular function's
  column-alias list, and catalogue columns (`catalogueColumnsFor` via
  `resolveCatalogue`) turn into `columnsKnown` scope entries. Plain tables
  without catalogue evidence stay `columnsKnown: false` (conservative).
- **Binding** (`colBind`): qualified references bind to the exact scope key;
  unqualified references bind only when exactly one candidate exists. Multiple
  candidates → `column_ambiguous` (region-scoped, span-attached, **no binding
  invented**); zero candidates, unknown qualifiers, missing columns in a
  provable scope, and scalar subqueries → `column_opaque`.
- **Projection items** (`colParseItems` / `colScanRefs`): aliases (`AS` and
  bare trailing), expression-level provenance (`s.a + s.b AS total` maps
  `total` to both inputs), `COUNT(*)` row aggregates (no invented column), and
  predicate references (WHERE / GROUP BY / HAVING / ORDER BY / JOIN ON /
  USING) all bind with spans.
- **Wildcards**: `*` / `t.*` expand only when the catalogue (or a provable
  scope) proves every contributing source's columns; otherwise they are
  recorded unexpanded and never invent columns.
- `analyseColumns(toks, opts)` is the public entry point; every region-scoped
  diagnostic carries a valid source span.

### Analysis integration (`src/ir.ts`)

`analyse()` now walks the AST and column-analyses every query-bearing `SELECT`
statement (including inside control flow), attaches the results as
`result.columns: ColumnLineage[]`, and merges the region-scoped
`column_ambiguous` / `column_opaque` diagnostics into the findings panel.
Confidence, coverage, graphs, exports, and construct coverage are untouched:
clean queries produce no new diagnostics, so all existing object-level
fixtures remain green.

### Types (`src/types.d.ts`)

`ColumnSource`, `ColumnOutput`, `ColumnBinding`, `ColumnWildcard`,
`ColumnReference`, `ColumnLineage`, `ColumnResolution`, `ColumnSourceKind`;
`AnalysisResult.columns`; `PROCFLOW_COLUMN_PASS` / `_RESULT` / `_DETAIL`
globals.

## Fixtures and tests

- `tests/columns.ts` (+ `tests/index.html`, `tests/metrics.html`, and
  `columns.js` wiring) — 18 fixture-corpus records plus 3 integration records
  covering qualified/unqualified bindings, aliases, JOIN predicates,
  expression provenance, CTE scopes (explicit + computed), derived tables,
  catalogue-backed wildcard expansion (qualified and bare `*`), unexpanded
  wildcards without catalogue, scalar-subquery opacity, out-of-scope
  references, WHERE predicates, recursive-CTE bindings, `DISTINCT TOP`, and
  `SELECT … INTO`, plus the `analyse()` integration (attach + findings) and
  the clean-binding/no-noise guard. Gates the golden page via
  `PROCFLOW_COLUMN_PASS`.
- `tests/tests.ts` — gates the golden page on the column suite.
- `tests/metrics.ts` → `docs/metrics-v1.10.0.json` — adds `columnPassRate` and
  the `columns` corpus count (18/18); the v1.9.0 snapshot is renamed to
  v1.10.0 (old snapshot removed).
- `examples/dbo.v1100_demo.sql` — a view + procedure + audit demo showing CTE
  scopes, qualified/alias bindings, expression provenance, derived tables, the
  ambiguous reference diagnostic, the opaque subquery diagnostic, and
  catalogue-backed wildcard expansion (with a catalogue to paste).

## Verification

- `npm run typecheck` — passes
- `npm run build` — passes
- `npm run test:file` — passes (with `CHROME_PATH` set)
- Golden suite — 209/209 (was 208)
- Fuzz suite — 400 deterministic mutation cases
- UI suite — 22/22
- `npm run metrics` — snapshot is current; `docs/metrics-v1.10.0.json`
  committed (v1.9.0 snapshot renamed), 100 % column pass rate
- Local-only check clean; `dist/` committed in sync (adds
  `dist/src/columns.js` and `dist/tests/columns.js`)

## Not changed / deferred (per roadmap)

- Everything from v1.11.0 onwards — multi-statement temporary-table column
  flow, inter-object column flow through CTE/view boundaries, column export
  parity/round-trip and layout, and RDL/report import — is out of scope.
- Existing v1.1.0–v1.9.0 semantics are untouched; the corpus aggregates in
  `docs/metrics-v1.10.0.json` are byte-identical to v1.9.0's for every
  pre-existing metric, confirming no parser regression, and the full golden
  suite stays green.
