# PR: v1.9.0 — Resolve by catalogue

## Summary

Implements the **v1.9.0 — Resolve by catalogue** milestone from `ROADMAP.md`
in full and nothing from v1.10.0 onwards: README post-v1.0.0 item 5 —
**catalogue metadata import** (paste/import table/view/column catalogues) with
**exact synonym, linked-server, and cross-database resolution** replacing
v1.5.0's conservative external label where catalogue evidence exists, plus
**E diagnostics for partial or conflicting catalogue data**. The golden suite
grows from 207 to 208; fuzz (400) stays green; the UI suite grows from 20 to
22; catalogue fixtures (13) cover import parsing (JSON + line format), exact
and synonym verification in the estate and query graphs, conservative conflict
and cross-database partial handling, draw.io metadata, and the workspace
round-trip. Column lineage (v1.10.0+) and RDL (v1.12.0) remain deferred.

## What's included

### Catalogue model and import (`src/catalogue.ts`)

A new runtime module (loaded after `tokenizer.js`, before the analysis stages):

- `parseCatalogue(text, format?)` auto-detects **JSON** (`{objects:[{name,
  kind, synonyms[]}], columns:[{table, name}]}` or a bare array) and a
  forgiving **one-object-per-line** format (`# comment`, `name KIND syn1, syn2`,
  `COL table.column`) and returns `{catalogue, diagnostics, format,
  objectCount, columnCount}`.
- `buildCatalogueIndex` normalizes names (case-insensitive, bracket/quote
  stripping) into `byName`/`bySynonym` lookup maps and records **conflicts**
  (duplicate object names, or a synonym colliding with an object name) so
  ambiguous evidence is never invented into a verification.
- `resolveCatalogue(cat, name)` returns `verified` (exact full-name or
  explicit-synonym match with the resolved canonical name), `conflict`
  (conservative), or `external` (unproven).
- `suffixCatalogueMatches(cat, name)` lists near-miss candidates (the reference
  carries extra leading server/database parts over a catalogued object) used
  for conservative reporting.
- Diagnostics: `catalogue_parse_error`, `catalogue_empty`,
  `catalogue_conflict` (document-scoped), plus the region-scoped
  `catalogue_partial`/`catalogue_conflict` raised against a reference.

### Resolution wired into both views

- `src/ir.ts` `dependencyGraph(objects, opts)` now accepts the catalogue:
  unmatched leaves that the catalogue proves render as their canonical name
  with `provenance: external`, `resolution: verified`, and the original
  `objectId` preserved; conflicts stay conservative with a marker and reason;
  unmatched names keep the exact v1.5.0 behaviour (byte-identical without a
  catalogue).
- `src/lineage.ts` `buildQueryGraph`/`buildObjectQueryGraph` resolve query
  source nodes the same way whenever `opts.catalogue` is present; the
  catalogue-absent path is unchanged (regression-guarded by a fixture).
- `src/ir.ts` `analyse()` merges document-scoped catalogue parse diagnostics
  and attaches region-scoped `catalogue_conflict` / `catalogue_partial`
  diagnostics to each reference (span-attached, conservative).
- `src/exporters.ts` carries `resolution=` and `resolved=` provenance metadata
  on draw.io vertices so verification survives the round-trip.

### UI (`index.html`, `src/app.ts`)

A **Catalogue** command menu with a paste textarea, **Import file**,
**Apply catalogue**, and **Clear**, plus a status line that reports the parsed
object/column/conflict counts. Applying re-runs the current analysis so
verified resolution appears immediately; the catalogue is an analysis input and
clearing it re-runs without it.

### Workspace persistence (schema v2)

`src/workspace.ts` bumps `WORKSPACE_SCHEMA_VERSION` to 2 and carries the raw
catalogue text as an optional top-level snapshot field; v1 snapshots migrate
forward with `catalogue: null`, so **save → reload reproduces an identical
analysis** even when a catalogue was applied. `app.ts` saves/restores the
catalogue text and re-parses it on restore.

## Fixtures and tests

- `tests/catalogue.ts` (+ `tests/index.html`, `tests/metrics.html`, and
  `catalogue.js` wiring) — 13 fixture-corpus records covering JSON and line
  parsing, malformed/empty input diagnostics, duplicate-name and synonym
  collision conflicts, estate verification (exact + synonym + linked server),
  query-source verification, conservative cross-database partials with
  region-scoped diagnostics, the catalogue-absent regression guard, draw.io
  metadata survival, and the workspace catalogue round-trip + v1 migration.
  Gates the golden page via `PROCFLOW_CATALOGUE_PASS`.
- `tests/ui-tests.ts` — 2 new browser tests: catalogue verification in the
  dependency view and clearing the catalogue resetting its status.
- `tests/metrics.ts` → `docs/metrics-v1.9.0.json` — adds `cataloguePassRate`
  and the `catalogue` corpus count (13/13); the v1.8.0 snapshot is renamed to
  v1.9.0.
- `examples/dbo.v190_demo.sql` — a multi-object demo with a matching catalogue
  you can paste to see verification, a catalogued synonym, and an unmatched
  external name.

## Verification

- `npm run typecheck` — passes
- `npm run build` — passes
- `npm run test:file` — passes (with `CHROME_PATH` set)
- Golden suite — 208/208 (was 207)
- Fuzz suite — 400 deterministic mutation cases
- UI suite — 22/22 (was 20)
- `npm run metrics` — snapshot is current; `docs/metrics-v1.9.0.json` committed
  (v1.8.0 snapshot renamed)
- Local-only check clean; `dist/` committed in sync

## Not changed / deferred (per roadmap)

- Everything from v1.10.0 onwards — column lineage (scopes, bindings,
  projections) and RDL/report import — is out of scope for this release.
- Existing v1.1.0–v1.8.0 semantics are untouched; all prior fixtures remain
  green (verified by the unchanged catalogue-absent byte-identical paths and
  the full golden suite).
