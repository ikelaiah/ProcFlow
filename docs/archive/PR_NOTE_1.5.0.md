# PR: v1.5.0 — Data flow and internal resilience

## Summary

Implements the **v1.5.0 — Data flow and internal resilience** milestone from
`ROADMAP.md`: Workstream D in full, F data-flow rendering in both exporters,
and the E construct-coverage statistic surfaced in the UI. The golden suite
grows from 188 to 199; fuzz (400) and UI (13 → 14) suites stay green.

## What's included

### Temporary-table producer→consumer data edges (D)

`buildGraph` (`src/ir.ts`) now tracks temp-table (`#name`) writes as reaching
definitions while emitting the flow graph. A consumer wires to its unique
reaching definition — the most recent write on a provably linear path — with a
labelled semantic `data` edge:

- `SELECT … INTO #stage` → later `UPDATE #stage` / `SELECT … FROM #stage` /
  `INSERT … SELECT … FROM #stage` consumers form a visible pipeline.
- A write to an existing temp table (a read-modify write such as `UPDATE #t`)
  also consumes the current content, so chains stay connected.
- Conditional writes and branch/loop/try merges mark the definition ambiguous:
  no data edge is invented for its consumers, and a region-scoped
  informational `temp_flow_ambiguous` annotation explains why. Info
  annotations never inflate the findings count.
- Unreachable statements neither wire nor redefine temp tables.
- Resolved data edges are counted in `graph.stats.dataflow` and in construct
  coverage as `temp_flow`.

### Conservative external nodes (D)

In the estate dependency graph (`dependencyGraph`), an unmatched three- or
four-part name now renders with its complete identity —
`external: remotesrv.salesdb.dbo.pull_orders` — instead of a bare name that
could be mistaken for a known object. Unmatched non-temp targets carry
`provenance: 'external'` (previously misclassified `synthetic`); temp tables
are workspace-internal and remain synthetic.

### Transaction edge cases (D)

- **Savepoint-only recovery:** savepoints declared in a `TRY` body remain
  visible inside its `CATCH`, so `ROLLBACK TRANSACTION stage_save` is
  annotated "roll back to savepoint stage_save; depth unchanged" instead of
  "named target unresolved; full or savepoint rollback".
- **`SET XACT_ABORT` inside `CATCH`** is annotated "set inside CATCH; applies
  to later statements", distinguishing handler-scoped changes from
  procedure-level settings.

### Data-flow rendering in both exporters (F)

Data edges derive their presentation from the semantic `data` edge kind via
the canonical mapping:

- Mermaid emits a `linkStyle` entry (green, 2 px) covering every data edge.
- draw.io edges with `kind="data"` render with `strokeWidth=2` on top of the
  existing canonical stroke colour and `data-procflow-kind` metadata.

### Reviewed accuracy correction

v1.1.0 classified every sequential edge leaving an `io`/`src` node as a
semantic `data` edge, conflating control flow with data flow. With real
producer→consumer data edges shipping in v1.5.0, that mapping is removed:
sequential edges are `control`, and only explicit temp-table edges and
dependency-graph writes are `data`. The v1.1.0 semantic fixture in
`tests/tests.ts` now stages through `#work` so it still asserts a genuine
data edge. No other golden output changed.

### Construct coverage in the UI (E)

The analysis panel gains a **Constructs** signal next to Confidence, Coverage,
and Diagnostics: resolved/detected in the header strip, and a Details line
with the full detected/resolved/opaque counts plus the per-kind breakdown
(branches, loops, handlers, CTEs, source refs, temp flow). Estate scope
aggregates the statistic across all objects.

## Not changed

- Existing v1.1.0–v1.4.0 boundary, procedural, transaction, and query
  semantics are untouched; all prior fixtures remain green except the one
  documented correction above.
- Confidence formula, layout engine, catalogue resolution, and column
  lineage are deferred per the roadmap.
- The local-only security model is unchanged.

## Fixtures

- `tests/dialects/tsql.ts` — four v1.5.0 graph fixtures: linear temp-table
  pipeline (kind-asserted data edges), conservative branch merge
  (`temp_flow_ambiguous`, no invented edges), savepoint-only recovery in
  `CATCH`, and catch-scoped `SET XACT_ABORT`.
- `tests/tests.ts` — `matchingWire` can now assert edge `kind`; v1.5.0 blocks
  cover external-node labels/provenance, F data-edge rendering in both
  exporters, and construct-coverage counts.
- `tests/ui-tests.ts` — construct-coverage display assertion.

## Verification

- `npm run typecheck` — passes
- `npm run build` — passes
- `npm run test:file` — passes
- Golden suite — 199/199 (was 188)
- Fuzz suite — 400 deterministic mutation cases
- UI suite — 14/14 (was 13)
- Local-only URL check clean; `dist/` committed in sync

## Deferred (per roadmap)

- Confidence re-score → v1.6.0; layout replacement → v1.7.0
- Catalogue, columns, and RDL → v1.9.0+
