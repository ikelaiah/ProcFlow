# PR: v1.4.0 — Report every object a query touches

## Summary

Implements the **v1.4.0 — Report every object a query touches** milestone from
`ROADMAP.md`: Workstream C in full, plus the E query diagnostics/annotations and
F export-parity fixtures each construct requires. Query lineage now reports
every object a statement reads, joins, or produces. The golden suite grows from
181 to 188; fuzz and UI suites stay green.

## What's included

### Comma-separated `FROM` sources

`refsIn` (`src/lineage.ts`) tracks a FROM/JOIN source list and its clause-end
keywords, so `FROM a, b, c` wires every source — previously only the first.
Commas in `SELECT` lists, `IN (…)`, function calls, `VALUES`, `GROUP BY`, and
`USING (col)` lists do not produce false references.

### `APPLY` / `LATERAL` / tabular functions

- `CROSS`/`OUTER APPLY fn(…)` adds the function as a structured `read` /
  `heuristic` reference.
- `UNNEST`, `XMLTABLE`, `JSON_TABLE`, `GENERATE_SERIES` are `read` / `opaque`
  (documented opaque) references.
- `LATERAL` subqueries keep their inner sources wired.

### Read extraction without `FROM`

- `MERGE … USING` and `DELETE … USING` now extract the `USING` source as a read
  (they previously produced none).
- `UPDATE … FROM` extraction is preserved unchanged.

### Recursive CTEs

- Recursive CTEs are detected by self-reference, marked **"recursive CTE"** on
  the node, and counted in `graph.stats.recursive`.
- A resolved recursion emits an `info` **`cte_recursive`** annotation; an opaque
  source inside the recursion cycle emits a `warning` **`cte_recursion_approx`**.
  a normal table reference stays resolved.

### Derived-table inner sources

`FROM (SELECT … FROM dbo.t) x` now plots `dbo.t` as a source node.

### E diagnostics + F export parity

- New `info` severity (`src/types.d.ts`); informational annotations are
  excluded from the findings count in `estateHealth` and `setAnalysisHealth`
  (`src/app.ts`), so they never inflate the diagnostics counter.
- `cte_recursive` and `cte_recursion_approx` are region-scoped with valid
  spans, asserted in `tests/tests.ts`.
- Query-graph constructs are covered by `toMermaid`/`toDrawio` export-parity
  tests (well-formed draw.io XML, provenance metadata, all new sources present).

### Other

- `examples/dbo.v140_demo.sql` demonstrates all headline outcomes in one
  T-SQL procedure.
- `NOT_TABLE` (now unused) removed from `src/lineage.ts`.

## Not changed

- Existing fixtures keep their structure; the corpus only grew. Query diagrams
  that now report comma/`APPLY`/`USING`/recursive-CTE/derived sources gain
  source nodes, which is the intended accuracy fix.
- 1.1.0–1.3.0 boundary, lexing, transaction, and procedural semantics are
  untouched.
- The local-only security model is unchanged.

## Fixtures

- `tests/tests.ts` — v1.4.0 block: comma refs, APPLY/tabular refs, MERGE/DELETE/
  UPDATE read extraction, recursive-CTE info + approx warning, derived-table and
  comma wiring, query-graph export parity.

## Verification

- `npm run typecheck` — passes
- `npm run build` — passes
- `npm run test:file` — passes
- Golden suite — 188/188 (was 181)
- Fuzz suite — 400 deterministic mutation cases
- UI suite — 13/13
- Local-only URL check clean; `dist/` committed in sync

## Deferred (per roadmap)

- Workstream D (data flow / dependency accuracy) → v1.5.0
- Confidence re-score → v1.6.0; layout replacement → v1.7.0
- Catalogue, columns, and RDL → v1.9.0+
