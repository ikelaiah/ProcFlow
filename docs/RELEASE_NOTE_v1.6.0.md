# proc>flow v1.6.0 — Honest measurement

**Release date:** 2026-08-08

ProcFlow v1.6.0 makes the analysis honestly measured: a single confidence
headline is now computed by a versioned formula from per-region signals, so a
reviewer can always tell which part of a diagram is verified and which is
estimated. Fixture-corpus accuracy metrics are published as a checked-in,
deterministic snapshot — derived only from the anonymised test corpus, never
from your SQL.

The release remains local-first: SQL is analysed entirely in the browser and
is not uploaded, executed, or persisted.

## Highlights

- **One headline, one honest formula.** Confidence (v1.6.0) is now derived from
  per-region signals: dialect certainty × the token-weighted quality of each
  statement region (resolved / approximate / opaque / error) × a coverage
  factor. The health band (`high`/`medium`/`low`) comes from the same formula,
  so the colour can never contradict the percentage. Coverage alone can no
  longer inflate confidence — an object whose tokens all land in opaque
  dynamic-SQL regions stays capped at 40 % even at 100 % coverage.
- **Every approximation is called out where it happens.** Opaque table
  expressions (`UNNEST`, `XMLTABLE`, `JSON_TABLE`, `GENERATE_SERIES`, …) and
  partially resolved `APPLY` targets now carry their own region-scoped,
  span-attached warnings, alongside the existing dynamic-SQL, approximate
  recursion, and unresolved-label diagnostics.
- **Document-scoped findings are honest about where they don't point.**
  Dialect-ambiguity findings are document-scoped and carry no fabricated
  one-character span.
- **Informational annotations stay out of the way.** A correctly resolved
  recursive CTE is shown as an informational annotation and never inflates the
  Diagnostics count.
- **Fixture-corpus metrics shipping.** `scripts/metrics.mjs` runs the checked-in
  golden corpus headlessly and publishes the "Metrics that matter" —
  attribution, unresolved-token, tail-unconsumed, fallback, opaque-dynamic,
  semantic-edge coverage, provenance, and region-diagnostic-to-span ratios — to
  `docs/metrics-v1.6.0.json`. Generation is deterministic and fixture-only; CI
  refuses to merge when the snapshot is stale.

## Correctness baseline

- TypeScript type-checking and a clean generated build;
- 204 golden, graph, dependency, exporter, provenance, boundary, diagnostic,
  and confidence tests;
- 400 deterministic mutation cases;
- 16 browser interaction and local-runtime tests;
- the fixture-corpus metric snapshot (100 % attribution, 100 % semantic-edge
  coverage, 100 % provenance, 100 % region-span ratio); and
- the direct `file://` application smoke test.

GitHub Actions also checks that generated JavaScript is current, the vendored
Mermaid runtime remains pinned, runtime application files contain no external
HTTP URLs, and the metric snapshot is current.

## Compatibility and upgrade notes

- No data migration is required because ProcFlow does not persist SQL or
  workspace state.
- The confidence number is now produced by a documented, versioned formula;
  numbers may differ from earlier releases even when the diagram looks
  identical. The health band follows the same formula.
- New `source_opaque` and `apply_heuristic` warnings appear only where an
  opaque table expression or heuristic `APPLY` target is actually resolved.
- The local-only browser security model is unchanged.

## Known limitations

- Parsing is heuristic rather than compiler-grade.
- Dynamic SQL remains opaque.
- Temp-table data flow is shown within one object; cross-object temp flow,
  synonyms, linked servers, and cross-database references have lightweight
  resolution.
- Query lineage is object-level rather than column-level.
- Layout replacement, catalogue resolution, persistence, and column lineage are
  scheduled for later releases.
- Large draw.io exports can still require manual rearrangement.

Verify critical dependencies, execution paths, transaction behavior, and
security conclusions against the original SQL and target database.

See [README.md](../README.md) for usage and development guidance.
