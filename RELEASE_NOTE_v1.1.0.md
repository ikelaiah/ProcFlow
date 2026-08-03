# proc>flow v1.1.0 — Trustworthy semantic foundation

**Release date:** 2026-08-04

ProcFlow v1.1.0 strengthens the semantic model behind its diagrams so source
provenance, uncertainty, diagnostic scope, and exported meaning are explicit
and testable.

The release remains local-first: SQL is analysed entirely in the browser and
is not uploaded, executed, or persisted.

## Highlights

- Every graph edge now has a semantic kind: `control`, `exception`, `data`,
  `dependency`, or `call`.
- Graph nodes identify whether they come from source SQL, an external object,
  or a synthetic analysis construct.
- Query references include source spans, roles, and resolution quality.
- Token attribution and construct coverage make unresolved or opaque input
  visible instead of silently omitting it.
- Diagnostics explicitly distinguish document-wide findings from findings
  attached to a source region.
- Mermaid and draw.io exports share one canonical rendering contract and carry
  provenance metadata.

## Reliability fixes

- Fixed pasted `CREATE OR ALTER` and `CREATE OR REPLACE` SQL being split into
  two source-picker entries. A modified object declaration now creates one
  clean entry containing the complete pasted source.
- Fixed the v1.1.0 diagnostic-scope golden test. Diagnostics produced by the
  existing tokenizer and parser now receive the required `region` scope,
  while document-level findings such as dialect ambiguity retain `document`
  scope.
- Added golden and browser UI regressions covering modified object declarations
  and clean single-source paste handling.

## Correctness baseline

The v1.1.0 baseline passes:

- TypeScript type-checking and a clean generated build;
- 137 focused golden parser, graph, dependency, exporter, provenance, and
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
- Replace the previous extracted release with the complete v1.1.0 archive;
  keep `index.html`, `styles.css`, `dist/`, and `vendor/` together.
- Existing v1.0.0 SQL fixtures retain their structure. The new semantic
  metadata is additive.
- The local-only browser security model is unchanged.

## Known limitations

- Parsing is heuristic rather than compiler-grade.
- Dynamic SQL remains opaque.
- Query lineage is object-level rather than column-level.
- Some vendor-specific table expressions, temporary objects, synonyms, linked
  servers, and cross-database references have lightweight resolution.
- Large draw.io exports can still require manual rearrangement.

Verify critical dependencies, execution paths, transaction behavior, and
security conclusions against the original SQL and target database.

See [README.md](README.md) for usage and development guidance, and
[docs/RELEASE_NOTE_1.1.0.md](docs/RELEASE_NOTE_1.1.0.md) for the detailed
semantic-model changes.
