# PR: v1.1.0 — Trustworthy semantic foundation

## Summary

This PR implements the **v1.1.0 — Trustworthy semantic foundation** milestone
from `ROADMAP.md`. It ships Workstream P in full, README item 8, and the
metadata + canonical rendering contract from Workstream F.

## What's included

### Semantic model (`src/types.d.ts`)

- Added `EdgeKind` (`control` | `exception` | `data` | `dependency` | `call`)
- Added `NodeProvenance` (`source` | `external` | `synthetic`)
- Added `DiagnosticScope` (`document` | `region`)
- Added `StructuredQueryReference` with name, span, role, and resolution
- Added `TokenAttribution` and `ConstructCoverage` result types
- Extended `GraphNode` with `provenance`, `reason`, and `sources`
- Extended `GraphEdge` with `kind`
- Extended `AnalysisResult` with `attribution` and `constructCoverage`

### Graph builder (`src/ir.ts`)

- Every edge now carries a recognised semantic `kind`
- Every node now declares `source` / `external` / `synthetic` provenance
- `analyse()` computes token attribution (resolved / ignored / unresolved /
  opaque) and construct coverage (branches, loops, handlers, CTEs, source refs)
- Diagnostics for `unconsumed_input`, `dynamic_sql`, and `dialect_low_confidence`
  now carry explicit `region` / `document` scope
- Dependency graph edges carry `call` / `data` / `dependency` kinds

### Query lineage (`src/lineage.ts`)

- `refsIn()` now returns structured references with name, span, role, and
  resolution
- Query graph nodes carry provenance
- Query graph edges carry `dependency` kind

### Exporters (`src/exporters.ts`)

- Added canonical node-style and edge-style/color mappings shared by both
  exporters
- Mermaid output includes a `%% proc>flow provenance` comment block
- draw.io vertices carry `data-procflow` provenance attributes
- draw.io edges carry `data-procflow-kind` attributes and use canonical
  edge-kind colors

### Tests (`tests/tests.ts`)

New v1.1.0 fixtures verify:

- Semantic edge kinds and node provenance
- Token attribution and construct coverage
- Structured query references with spans and roles
- Export provenance metadata (Mermaid + draw.io)
- Diagnostic document/region scope

### Docs

- `docs/RELEASE_NOTE_1.1.0.md` — release notes
- `docs/PR_NOTE_1.1.0.md` — this PR note
- `README.md` — updated for v1.1.0
- `package.json` — version bumped to 1.1.0

## Verification

- `npm run typecheck` — passes
- `npm run build` — passes
- `npm run test:file` — passes
- Golden, fuzz, and UI browser suites — green

## Deferred (per roadmap)

- Parser/lineage expansion (Workstreams A–D)
- Confidence re-score (Workstream E)
- Layout replacement (Workstream F)
- Catalogue, columns, and RDL (v1.9.0+)