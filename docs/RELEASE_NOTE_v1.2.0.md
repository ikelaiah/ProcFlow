# proc>flow v1.2.0 — Trust statement boundaries

**Release date:** 2026-08-05

ProcFlow v1.2.0 hardens how statements and dialect boundaries are decided, so
the diagram's structure matches the SQL it is given even when semicolons are
omitted.

The release remains local-first: SQL is analysed entirely in the browser and
is not uploaded, executed, or persisted.

## Highlights

- Statement splitting no longer depends on newline position. Semicolons are
  authoritative, and omitted semicolons are split by dialect-aware control
  keywords and statement grammar.
- One-line semicolon-free T-SQL, DB2, and PL/pgSQL sequences now parse into
  distinct statements.
- Numbers are lexed more completely: `0x` hex, `1_000` separators, and `1.`/
  `.5` forms.
- New `dialect_ambiguous` guardrail reports automatic-mode detection ties at
  low confidence.
- New `unexpected_end` boundary diagnostic reports a block terminator with no
  matching opener, alongside the existing bracket/balance diagnostics.
- Token attribution is now exact: every body token is accounted for, and the
  fuzz suite enforces it along with recognised edge kinds and node provenance.

## Reliability fixes

- `SELECT RAISE(...)` in SQLite stays a single expression statement; it is no
  longer split into two statements.
- Token attribution no longer hides filtered semicolons inside unresolved
  regions, so resolved + ignored + unresolved + opaque always equals the
  body-token total.

## Correctness baseline

The v1.2.0 baseline passes:

- TypeScript type-checking and a clean generated build;
- 156 golden, graph, dependency, exporter, provenance, boundary, and
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
- Replace the previous extracted release with the complete v1.2.0 archive;
  keep `index.html`, `styles.css`, `dist/`, and `vendor/` together.
- Existing v1.0.0 and v1.1.0 fixtures retain their structure; the fixture
  corpus only grew.
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
[RELEASE_NOTE_1.2.0.md](RELEASE_NOTE_1.2.0.md) for the detailed
boundary-handling changes.
