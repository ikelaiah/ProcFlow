# proc>flow v1.3.0 — Trust procedural control flow

**Release date:** 2026-08-06

ProcFlow v1.3.0 completes the **Trust procedural control flow** milestone:
mixed `IF`/`WHILE` forms parse into one AST, labelled loop-control and `GOTO`
are validated with source spans, cursor queries join the query graphs, and DB2
`BEGIN ATOMIC` blocks carry a rollback scope.

The release remains local-first: SQL is analysed entirely in the browser and
is not uploaded, executed, or persisted.

## Highlights

- Mixed one-line and block `IF`/`WHILE` forms parse into one control-flow AST,
  for T-SQL and DB2, with correct `yes`/`no` branches and loop back-edges.
- Labelled loop-control and `GOTO` are hardened: targets are validated, labels
  and `GOTO`s carry source spans, and an unresolved target raises a
  `goto_unresolved` warning plus an explicit "Unresolved label" node instead of
  a silent drop.
- Cursor queries appear in the Query structure view: the source table behind a
  T-SQL `DECLARE … CURSOR FOR` or DB2 `FOR … CURSOR FOR` is shown as a source
  node, and object-level cursor reads are preserved.
- DB2 `BEGIN ATOMIC` blocks render a rollback-scope marker that routes
  unhandled or EXIT/UNDO exits to an implicit rollback terminal.
- `GRANT`, `WAITFOR`, `KILL`, and cursor operations now get concise node
  labels instead of full statement text.
- New procedural constructs are covered by graph-edge, diagnostic-scope, and
  `toMermaid`/`toDrawio` export-parity fixtures (E/F).

## Correctness baseline

The v1.3.0 baseline passes:

- TypeScript type-checking and a clean generated build;
- 181 golden, graph, dependency, exporter, provenance, boundary, and
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
- Existing v1.0.0–v1.2.0 fixtures retain their structure; the corpus only grew.
  One node label changed deliberately: DB2 `FETCH NEXT FROM c …` now reads
  `FETCH FROM c` under the cursor-ops `summarise` rule.
- The local-only browser security model is unchanged.

## Known limitations

- Parsing is heuristic rather than compiler-grade.
- Dynamic SQL remains opaque.
- Query lineage is object-level rather than column-level.
- Some vendor-specific table expressions, temporary objects, synonyms, linked
  servers, and cross-database references have lightweight resolution.
- Exceptionally malformed batches can still produce imperfect statement
  splits.
- Large draw.io exports can still require manual rearrangement.

Verify critical dependencies, execution paths, transaction behavior, and
security conclusions against the original SQL and target database.

See [README.md](../README.md) for usage and development guidance, and
[RELEASE_NOTE_1.3.0.md](RELEASE_NOTE_1.3.0.md) for the detailed
control-flow changes.
