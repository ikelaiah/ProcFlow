# proc>flow v1.4.0 — Report every object a query touches

**Release date:** 2026-08-07

ProcFlow v1.4.0 completes the **Report every object a query touches**
milestone: the Query structure diagram now shows *every* object a statement
reads, joins, or produces — not just the first table after `FROM`.

The release remains local-first: SQL is analysed entirely in the browser and
is not uploaded, executed, or persisted.

## Highlights

- Comma-separated sources are all wired — `FROM a, b, c` renders three source
  nodes instead of only `a`.
- `CROSS`/`OUTER APPLY` and tabular functions (`UNNEST`, `XMLTABLE`,
  `JSON_TABLE`, `GENERATE_SERIES`) are reported as structured read references;
  plain tables resolve exactly, functions are marked heuristic or opaque.
- Read extraction now covers `MERGE … USING` and `DELETE … USING`, which have
  no `FROM` clause. `UPDATE … FROM` extraction is preserved.
- A recursive CTE is marked **"recursive CTE"** in the graph and carries an
  informational annotation (not a warning); only an opaque source inside the
  recursion cycle raises a `cte_recursion_approx` warning.
- Derived-table/subquery inner tables are wired into the diagram:
  `FROM (SELECT … FROM dbo.t) x` plots `dbo.t` as a source.
- Informational annotations no longer inflate the diagnostics count.

## Correctness baseline

- TypeScript type-checking and a clean generated build;
- 188 golden, graph, dependency, exporter, provenance, boundary, and
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
- Existing fixtures retain their structure; the corpus only grew. Query
  diagrams for statements with comma, `APPLY`, `USING`, recursive-CTE, or
  derived-table sources now rightly show additional source nodes.
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

See [README.md](../README.md) for usage and development guidance.
