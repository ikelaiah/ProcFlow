# proc>flow v1.3.0 — Trust procedural control flow

**Release date:** 2026-08-06

ProcFlow v1.3.0 begins hardening how procedural control flow is resolved, so
the diagram's branches and loops match the SQL it is given even when a
procedure mixes statement styles.

The release remains local-first: SQL is analysed entirely in the browser and
is not uploaded, executed, or persisted.

## Highlights

- Mixed one-line and block `IF`/`WHILE` forms parse into one control-flow
  AST. A procedure may freely combine single-statement bodies
  (`IF @x = 1 SELECT …;`) with `BEGIN`/`END` block bodies, and DB2 may mix
  `THEN` statements with `BEGIN`/`END` blocks; conditions still branch
  `yes`/`no` and loop bodies wire back to the loop condition.
- New graph-edge fixtures lock in the mixed forms for T-SQL and DB2, and new
  statement-range fixtures assert the exact source spans inside mixed `IF`
  constructs.
- `examples/dbo.v130_demo.sql` demonstrates all five mixed forms in one
  procedure (coverage 1.0, no diagnostics).

## Correctness baseline

The v1.3.0 baseline passes:

- TypeScript type-checking and a clean generated build;
- 164 golden, graph, dependency, exporter, provenance, boundary, and
  diagnostic tests;
- 400 deterministic mutation cases;
- 13 browser interaction and local-runtime tests; and
- the direct `file://` application smoke test.

GitHub Actions also checks that generated JavaScript is current, the vendored
Mermaid runtime remains pinned, and runtime application files contain no
external HTTP URLs.

## Compatibility and upgrade notes

- No data migration is required because ProcFlow does not persist SQL or
  workspace state.
- Replace the previous extracted release with the complete v1.3.0 archive;
  keep `index.html`, `styles.css`, `dist/`, and `vendor/` together.
- Existing v1.0.0, v1.1.0, and v1.2.0 fixtures retain their structure; the
  fixture corpus only grew.
- The local-only browser security model is unchanged.

## Known limitations

- Parsing is heuristic rather than compiler-grade.
- Dynamic SQL remains opaque.
- Query lineage is object-level rather than column-level.
- Some vendor-specific table expressions, temporary objects, synonyms, linked
  servers, and cross-database references have lightweight resolution.
- Labelled loop-control/`GOTO` hardening, cursor query graphs, DB2 `ATOMIC`
  rollback scope, and the extended statement-label set are scheduled for
  later v1.3.0 slices (see `docs/v1.3.0-implementation-plan.md`).
- Large draw.io exports can still require manual rearrangement.

Verify critical dependencies, execution paths, transaction behavior, and
security conclusions against the original SQL and target database.

See [README.md](../README.md) for usage and development guidance, and
[RELEASE_NOTE_1.3.0.md](RELEASE_NOTE_1.3.0.md) for the detailed
control-flow changes.
