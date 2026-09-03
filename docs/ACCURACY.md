# Accuracy and analysis contract

ProcFlow v2.0.0 is the current released version. It is a deterministic
heuristic analyser, not a database compiler, and does not execute SQL.
Diagrams are investigation aids: verify material findings against the source
and the target database.

## What is measured

- **Attribution:** source tokens are classified as consumed, intentionally
  ignored, or unresolved.
- **Coverage:** the percentage of body tokens consumed by the parser.
- **Statement regions:** source spans used to connect diagnostics and diagram
  nodes back to the input.
- **Confidence:** a versioned headline derived from dialect certainty,
  token-weighted region quality, and coverage.
- **Diagnostics:** uncertainty is reported as document- or region-scoped
  errors, warnings, and informational annotations.

The v1.6 confidence formula remains the current policy. Region quality scores
resolved, approximate, opaque, and error regions as 1.00, 0.75, 0.40, and
0.15 respectively; the headline is dialect certainty × region quality ×
`(0.6 + 0.4 × coverage)`. A high coverage number cannot turn opaque dynamic
SQL into a resolved dependency.

## Conservative semantics

- Dynamic SQL is an explicit opaque node. Its generated reads and writes are
  not invented.
- Ambiguous column bindings stay ambiguous.
- Catalogue resolution requires an exact full-name match or an explicit
  synonym. Partial and conflicting matches stay external with diagnostics.
- Shared or unresolved report datasets remain visible rather than being
  guessed.
- Unsupported or malformed regions are retained as source spans and reported.

## Fixture evidence

The current snapshot is [metrics-v2.0.0.json](metrics-v2.0.0.json). It covers
the historical golden and fuzz corpus, browser interaction, parity, layout,
workspace, catalogue, column, column-flow, report, and report-graph suites.
The v1.14 scale suite exercises 100 KB and 500 KB inputs, 100-object estates,
graphs of 100/250/500 nodes, and 25 report datasets. The realistic corpus has
one anonymised fixture per supported dialect: T-SQL, DB2 SQL PL, PL/pgSQL, and
SQLite. The CI gate requires the deterministic suites and all tracked metric
rates to pass.

These are regression and invariant measures, not a claim of compiler-grade
semantic completeness. v2 adds 15 cross-dialect adversarial cases with 56
required and forbidden semantic assertions; the published
`dialectAdversarialSemanticAssertionRate` is `1.0`. This is stronger evidence
than attribution alone, but it is still not a universal SQL-correctness oracle.
Read the final [v2 accuracy contract](V2_ACCURACY_CONTRACT.md).
