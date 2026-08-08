# proc>flow v1.7.0 — Clear deterministic exports

**Release date:** 2026-08-08

ProcFlow v1.7.0 makes exports clear and deterministic. Draw.io exports now get
a layered, crossing-reducing, data-flow-aware layout instead of a naive
breadth-first placement: positions are deterministic, node boxes never overlap,
the control flow reads as a monotonic spine, and temporary-table data flow is
routed around it in its own lane with explicit waypoints. Both exporters share
one canonical style mapping and structured labels, and every export carries the
provenance needed to trace a node back to its source SQL or to a synthetic
origin.

The release remains local-first: SQL is analysed entirely in the browser and
is not uploaded, executed, or persisted.

## Highlights

- **Deterministic, readable layout.** `layoutDrawio` replaced by a layered
  Sugiyama-style layout: deterministic ranks, barycenter crossing reduction,
  disconnected components stacked cleanly, and zero box overlaps at documented
  class sizes. The same script always exports the same coordinates.
- **Data flow routed around the spine.** Temp-table producer→consumer edges
  leave the control-flow column and run in a dedicated lane with explicit
  waypoints, so `SELECT … INTO #t → UPDATE #t → SELECT #t` reads as data
  transformation instead of criss-crossing the diagram.
- **One canonical renderer contract.** Mermaid and draw.io derive every node
  fill, stroke, edge colour, dash, and width from the same registry — the two
  renderings can never disagree about a node class or an edge kind.
- **Structured labels.** Multi-line labels (grouped statement runs, object
  name + kind, recursive-CTE markers) export as real line breaks in both
  formats; the hidden `\u0001` sentinel is gone.
- **Provenance round-trips.** draw.io vertices carry source spans, class,
  object identity, and synthetic origins as metadata that survives opening and
  re-saving; synthetic nodes (BEGIN TRY markers, unresolved-label nodes,
  external source placeholders) declare their origin instead of a fabricated
  span.
- **Export-parity and layout budgets are tested.** Each graph construct is
  exported to Mermaid and draw.io, parsed back to a semantic manifest, and
  compared with the input Graph. Named layout classes meet overlap,
  monotonic-spine, label-bound, and crossing budgets at documented size limits;
  large or non-planar graphs degrade honestly and never claim zero crossings.
- **Metrics extended for exports.** The fixture-corpus snapshot now publishes
  export-parity, export-traceability, and layout-budget pass rates (all 100 %
  on the checked-in corpus) in `docs/metrics-v1.7.0.json`.

## Correctness baseline

- TypeScript type-checking and a clean generated build;
- 206 golden, graph, dependency, exporter, provenance, boundary, diagnostic,
  confidence, export-parity, and layout tests;
- 400 deterministic mutation cases;
- 16 browser interaction and local-runtime tests;
- export parity 20/20, layout budgets 11/11, export traceability 69/69; and
- the fixture-corpus metric snapshot (100 % attribution, 100 % semantic-edge
  coverage, 100 % provenance, 100 % region-span ratio, 100 % export-parity,
  100 % export-traceability, 100 % layout budgets).

GitHub Actions also checks that generated JavaScript is current, the vendored
Mermaid runtime remains pinned, runtime application files contain no external
HTTP URLs, and the metric snapshot is current.

## Compatibility and upgrade notes

- No data migration is required because ProcFlow does not persist SQL or
  workspace state.
- draw.io exports are now deterministic and re-routed; previously exported
  `.drawio` files will not match new exports of the same SQL. This is the
  intended v1.7.0 change — exports are now reproducible by construction.
- The local-only browser security model is unchanged.

## Known limitations

- Parsing is heuristic rather than compiler-grade.
- Dynamic SQL remains opaque.
- Temp-table data flow is shown within one object; cross-object temp flow,
  synonyms, linked servers, and cross-database references have lightweight
  resolution.
- Query lineage is object-level rather than column-level.
- Layout is deterministic and budget-tested for the documented graph classes at
  documented size limits; very large or non-planar graphs can exceed the
  crossing budget and are reported honestly rather than claimed planar.
- Persistence, catalogue resolution, and column lineage are scheduled for later
  releases.

Verify critical dependencies, execution paths, transaction behavior, and
security conclusions against the original SQL and target database.

See [README.md](../README.md) for usage and development guidance.
