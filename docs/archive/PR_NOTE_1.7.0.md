# PR: v1.7.0 — Clear deterministic exports

## Summary

Implements the **v1.7.0 — Clear deterministic exports** milestone from
`ROADMAP.md` in full and nothing from v1.8.0 onwards: core Workstream F for the
existing object, control, and data graph classes — the `layoutDrawio`
replacement, explicit provenance metadata, the canonical renderer mapping,
structured labels, and deterministic routing information — plus export-parity
and layout-budget fixtures and v1.7.0 fixture-corpus metrics. The golden suite
grows from 204 to 206; fuzz (400) and UI (16) suites stay green. Persistence
(v1.8.0), catalogue, columns, and RDL remain deferred.

## What's included

### Structured labels replace the `\u0001` sentinel (F)

`GraphNode` gained a `lines?: string[]` field; multi-line labels — grouped
statement runs, object name + kind in dependency graphs, recursive-CTE markers,
and the DB2/PL-pgSQL rollback markers — are carried as structured line arrays
instead of an embedded `\u0001` control character. `src/ir.ts`, `src/lineage.ts`,
and `src/exporters.ts` were updated so Mermaid renders `<br/>` and draw.io
renders `&#xa;` from `lines`.

### Canonical renderer mapping (F)

One registry in `src/exporters.ts` (`CANONICAL_NODE_STYLE`, `CANONICAL_EDGE_*`)
drives both exporters: Mermaid class defs, draw.io fills/strokes/fonts, edge
colours, dashes, and widths all derive from the same source, so the two
renderings can never disagree about a node class or an edge kind. The duplicate
Mermaid `styles` map was removed.

### Deterministic layered, data-flow-aware layout (F)

The BFS in `layoutDrawio` was replaced by `layoutAnalysis`:

- backbone edges (control, exception, dependency, call, and dependency-graph
  write edges) drive layer assignment via deterministic longest-path layering
  with DFS cycle breaking and Kahn ordering;
- disconnected components are stacked into separate layer bands;
- barycenter sweeps reduce crossings deterministically;
- temp-table `data` edges ride on top of the ranks and are routed through a
  dedicated lane with explicit `mxPoint` waypoints (`edgeWaypoints`), so data
  flow never pierces a node box;
- the same input always yields the same positions, with no node overlaps and a
  monotonic control-flow spine.

`layoutAnalysis`, `edgeWaypoints`, `countLayerCrossings`, and
`countNodeOverlaps` are exported so layout fixtures assert the budgets.

### Provenance metadata completion (F)

- External dependency nodes keep their complete identity as `objectId`, so
  `server.database.schema.object` names round-trip through draw.io metadata.
- Every synthetic node now declares its origin via `reason` (diagram entry/exit,
  exception junctions, handler markers, unresolved labels, external source
  placeholders, temp-table placeholders, and the no-query fallback).
- draw.io vertices carry `cls=` explicitly so the class survives the round-trip
  even when classes share a fill colour; the Mermaid provenance block and
  draw.io meta support multi-span `sources`.

### Export-parity fixtures (F)

`tests/parity.ts` adds `exportManifest`, `mermaidManifest`, and `drawioManifest`
that parse each generated export back into a semantic manifest and compare it
with the input Graph — same nodes, edges, labels, and edge meaning — across 10
fixtures covering the control, query, data, and dependency graph classes, in
both TD and LR directions, with well-formed draw.io XML and a provenance
round-trip.

### Layout budget fixtures (F)

Named layout classes (`control`, `query`, `data`, `dependencies`, `nonplanar`)
are asserted at documented size limits: deterministic positions, zero overlaps,
a monotonic spine, finite label bounds, and per-class crossing budgets. A
large/non-planar graph asserts honest degradation: overlaps stay zero, output is
deterministic, and a crossing count above budget is reported with an explicit
warning rather than a zero-crossings claim.

### v1.7.0 metrics

`tests/metrics.ts` now publishes `exportParityPassRate`, `exportTraceabilityRate`,
and `layoutBudgetPassRate` alongside the existing rates, plus `parity`/`layout`
corpus counts. `scripts/metrics.mjs` verifies/writes
`docs/metrics-v1.7.0.json` (v1.6.0 snapshot removed).

## Fixtures and tests

- `tests/parity.ts` (+ `tests/index.html`, `tests/metrics.html` wiring) — the
  export-parity and layout suites, gating the golden page via
  `PROCFLOW_PARITY_PASS` / `PROCFLOW_LAYOUT_PASS`.
- `tests/tests.ts` — two v1.7.0 records gate the golden page on the suites.
- `tests/metrics.ts` → `docs/metrics-v1.7.0.json` — export parity 1, export
  traceability 1, layout budgets 1.
- `examples/dbo.v170_demo.sql` — release demo exercising deterministic layout,
  routed data edges, structured labels, the canonical renderer contract,
  provenance round-trip, and honest geometry.

## Verification

- `npm run typecheck` — passes
- `npm run build` — passes
- `npm run test:file` — passes (with `CHROME_PATH` set on this machine; Edge
  headless did not produce DOM output, Chrome did)
- Golden suite — 206/206 (was 204)
- Fuzz suite — 400 deterministic mutation cases
- UI suite — 16/16
- `npm run metrics` — snapshot is current; `docs/metrics-v1.7.0.json` committed
- Local-only URL check clean; `dist/` committed in sync

## Not changed / deferred (per roadmap)

- Everything from v1.8.0 onwards — persistence, dependency filtering, catalogue,
  column lineage, and RDL — is out of scope for this release.
- Existing v1.1.0–v1.6.0 semantics are untouched; all prior fixtures remain
  green.
