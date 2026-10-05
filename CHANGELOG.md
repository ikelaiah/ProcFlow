# Changelog

All notable released SQL Cartographer changes are recorded here. Detailed verification
evidence belongs in the canonical release note under `docs/releases/`.

## v3.0.0 — Rename to SQL Cartographer (breaking)

### Renamed: ProcFlow → SQL Cartographer

The project has been renamed. The GitHub repository is now
[`ikelaiah/sql-cartographer`](https://github.com/ikelaiah/sql-cartographer),
the npm package name is `sql-cartographer`, and the product name in prose is
**SQL Cartographer**. The old `ikelaiah/ProcFlow` URL redirects automatically.

### Breaking

User-data-facing identifiers were renamed in the same pass. **Anything saved
before this change will not load:**

| Kind | Old | New |
| --- | --- | --- |
| Browser storage keys | `procflow.workspace`, `procflow.erd.layout`, `procflow.erd.query` | `sql-cartographer.workspace`, `sql-cartographer.erd.layout`, `sql-cartographer.erd.query` |
| Saved-query file format | `procflow-erd-query` | `sql-cartographer-erd-query` |
| ERD-layout file format | `procflow-erd-layout` | `sql-cartographer-erd-layout` |
| draw.io XML attributes | `data-procflow`, `data-procflow-kind` | `data-sql-cartographer`, `data-sql-cartographer-kind` |
| draw.io diagram id | `procflow-page` | `sql-cartographer-page` |
| Default download names | `procflow-report`, `procflow-estate`, `procflow-workspace.json`, `procflow-query-<fp>` | `sql-cartographer-report`, `sql-cartographer-estate`, `sql-cartographer-workspace.json`, `sql-cartographer-query-<fp>` |
| Release archive | `procflow-vX.Y.Z.zip` | `sql-cartographer-vX.Y.Z.zip` |

No migration path is provided. Before upgrading, export any saved queries and
ERD layouts you want to keep and re-import them after the upgrade; workspace
exports must be created by the old version and are not readable by the new one.

Historical documents keep the old name on purpose: `docs/archive/`, the
canonical release notes for v1.14.0 through v2.6.0, and the `CHANGELOG.md`
entries for those releases describe what shipped under it.

### Testing

- `npm test` now prints each failing case by name and detail on suite
  failure, instead of only the pass count. All three suite payload shapes are
  handled: a bare case array (golden, ui, erd-ui) and a `{failures: [...]}`
  wrapper (fuzz, security).
- The five `erd-ui` polls that wait on requestAnimationFrame-driven overlay
  drawing now allow 10s instead of 3s, so slow CI runners do not drop cases
  that a desktop browser passes.

## v2.7.0 — Maintainability pass

- Extracted `src/token-utils.ts` (shared token/AST helpers) and
  `src/dialects-state.ts` (PL/pgSQL and T-SQL transaction rules) from
  `src/ir.ts`; the analysis modules now form a one-way dependency chain
  (`token-utils` ← `lineage` ← `columns` ← `columnflow`), with no cycles.
- Moved bundled demo SQL out of `src/app.ts` into `src/samples.ts`.
- Unified duplicated logic: one CTE splitter (`splitCTEs`, now carrying
  column lists and body spans) and one shared dependency/report filter kernel
  (`graphNarrowByFocus`, `graphFilteredClone`).
- `toMermaid` no longer mutates the input graph; added regression tests for
  the non-mutation guarantee and for Mermaid's `securityLevel:'strict'`.
- Deleted dead helpers (`workspaceExportText`, `defaultWorkspaceFilter`, a
  no-op branch in column flow).
- Added `npm test` (`scripts/test-all.mjs`) — runs golden, fuzz, ui, erd-ui,
  and security suites against a local static server with one command — and
  fixed a load-order race in the UI suites where the off-screen iframe could
  finish loading before the test script attached its listener.
- Adopted Biome (`npm run lint`) and wired it into CI alongside typecheck.
- Fixed `npm run metrics` on Windows: Chromium emits CRLF in `--dump-dom`, so
  the snapshot comparison now normalises line endings.
- UI: tablists support arrow-key navigation (ARIA tabs pattern) and the app
  follows `prefers-color-scheme: light` with a legible light palette.
- Docs: corrected the stale trust-model version and port, indexed ADR-003 and
  all canonical release notes, and moved 33 superseded `RELEASE_NOTE_*`,
  `PR_NOTE_*`, and historical planning documents to `docs/archive/` with an
  archive README. `ROADMAP.md`, `tasks/`, and `BENCHMARKS.md` are marked as
  historical where they are no longer current.

## v2.6.0 — Aggregates and grouping

- Added per-column aggregate selectors: **COUNT**, **COUNT DISTINCT**, **SUM**,
  **AVG**, **MIN**, and **MAX**. The remaining picked columns become the
  `GROUP BY` list in pick order; `GROUP BY` is omitted when every pick is
  aggregated.
- Aggregate expressions get deterministic aliases, sorting an aggregated
  column orders by the expression, and `DISTINCT` is disabled and explained
  while grouping because `GROUP BY` already collapses rows.
- Query files move to version 2; version-1 files migrate forward with empty
  aggregates, and aggregates are saved, exported, restored, and pruned with
  their picks. Newer file versions are rejected with a diagnostic.
- Added a plan tip for one-to-many multiplication with `SUM`/`AVG`.
- Documentation: ADR-003 and an aggregates section in `docs/QUERY_BUILDER.md`.

## v2.5.0 — Saved queries and file export

- Added query persistence: **Save to this browser**, **Restore saved**, and
  **Forget saved** store one query locally with explicit actions only.
- Added versioned query files: **Export query file** and **Import query file**
  use the `procflow-erd-query` format with a schema fingerprint. Foreign,
  future-version, and malformed files are rejected with diagnostics.
- Restores prune references that no longer exist (tables, columns, taught
  joins, sorts, cross/excluded ids, path choices) and report the drops and a
  changed schema instead of failing.
- Added **Download .sql**, which respects the Comments toggle; the optional
  name field drives export filenames and falls back to the schema fingerprint.
- Added `src/query-store.ts` (pure serialization, validation, and pruning);
  `schemaFingerprint` is now shared by ERD layout and query files.
- Documentation: ADR-002, a saving/exporting/restoring section in
  `docs/QUERY_BUILDER.md`, and ARCHITECTURE invariant 7.
- Test coverage: query-store golden records (round-trip, rejection, tolerance,
  pruning, fingerprint, storage) and the ERD UI suite extended to 62 checks
  (export/import/download, save/restore/forget, activation hint).

## v2.4.1 — Query builder hardening and release discipline

- Hardened the query engine: shortest-path enumeration is iterative, so long
  declared chains cannot exhaust the call stack; a 1,000-table scale fixture
  asserts 999 joins, 998 bridges, and deterministic output.
- Fixed plan-edge highlighting when the overlay redraw was starved by
  animation-frame scheduling; query-state changes now draw synchronously.
- Excluding a problem table now prunes its sorts; the dropdown teach flow
  explains the same-table self-join case; the clipboard fallback is shared.
- Moved pure DOM builders to `src/ui/erd-query-view.ts` (no behavior change).
- Accessibility: one concise status announcement replaces noisy live regions,
  the floating query window is a labelled dialog, **Q** toggles query mode,
  and Escape cancels teaching without clearing the diagram selection.
- Added `tests/erd-ui.html` (49 interaction checks) and registered it in CI;
  the Firefox smoke now loads `erd.html`.
- Release discipline: `package-lock.json` tracks `package.json`, and CI guards
  the changelog, README, release index, and lockfile version.
- Documentation: `docs/QUERY_BUILDER.md`, ADR-001, and the suite cookbook and
  header convention in `docs/DEVELOPMENT.md`.
- Updated CI actions (`actions/checkout`, `actions/setup-node`).

## v2.4.0 — Query builder on the ERD

- Added the ERD query builder: a toolbar toggle turns column rows into
  checkboxes and opens a draggable, resizable floating window with the
  generated SQL, the join plan, and explicit resolutions for tables the
  declared foreign keys cannot reach.
- Joins follow declared `PRIMARY KEY` / `UNIQUE` / `FOREIGN KEY` evidence only.
  Equal-cost paths are offered as a choice, bridges are tagged, and preserve or
  strict join policy controls INNER/LEFT with per-join overrides.
- Added teach-by-clicking joins, typed predicates, opt-in `CROSS JOIN`, column
  exclusion (named in the SQL header), and self joins with a second aliased
  copy and per-column copy routing.
- Added query ergonomics: `DISTINCT`, dialect-aware row caps (`TOP` / `LIMIT` /
  `FETCH FIRST`), per-column sort cycling, and a Distinct tip when a
  one-to-many join can repeat rows.
- Generated SQL is dialect-quoted (T-SQL, PostgreSQL, DB2, SQLite) and syntax
  highlighted with byte-identical Copy output.
- The diagram reacts to picks: plan edges stay lit while unrelated edges dim,
  unresolved tables carry a coral ring, join cards highlight their edge and
  endpoints on hover, Find matches columns, and Only used tables narrows the
  canvas.
- Release quality: `package-lock.json` version now tracks `package.json`, and
  the ERD query UI ships with a committed browser suite and release-doc CI
  guards.

## v2.3.0 — Readable estate layouts

- Auto-arranged a schema on first parse; Reset still returns to declaration
  order.
- Edges now anchor at the referenced foreign-key column row and route
  orthogonally through card-free layout gutters, with band corridors and an
  outer channel for long multi-band edges. Zero path/card intrusions verified
  on the DB2 sample, a 300-table chain, and a sampled 800-table chain.
- Crossing reduction now uses median sweeps plus a monotonic adjacent-transpose
  pass, counts crossings by inversion counting, and supports LR/TB/Auto
  direction; Auto keeps whichever direction fits a 16:9 viewport better.
- Added position pinning (per-card diamond, Unpin all) so Auto arrange keeps
  chosen positions, with deterministic de-overlap for the rest.
- Added spacing presets (Compact/Normal/Roomy) and moved isolated tables and
  sourceless views to a downstream band.

## v2.2.0 — Arrange and save the ERD

- Added deterministic Auto arrange: layered parent→child flow with bounded
  barycenter crossing reduction, cycle-safe ordering, and view placement
  downstream of the tables referenced in the view body (`FROM`/`JOIN`, used as
  a declared layout hint only).
- Added band wrapping so wide and tall estates (800-table chains, 799-leaf
  fans) become a readable grid instead of one extremely long line or column.
- Added layout saving: opt-in **Save/Restore/Forget** in this browser plus
  versioned **Export/Import** layout files keyed by a schema fingerprint, with
  unmatched entities appended rather than overlapped.
- Reworked the ERD canvas to absolute positions, so dragging is persistent
  across re-renders, re-parsing, and Compact mode; **Reset** returns to
  declaration order.

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
[accuracy audit](docs/archive/ACCURACY_GAPS.md) for the reproductions and verification
record.
