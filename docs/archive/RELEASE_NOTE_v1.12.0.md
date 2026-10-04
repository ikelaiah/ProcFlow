# proc>flow v1.12.0 — Report import

**Release date:** 2026-08-17

ProcFlow v1.12.0 delivers README roadmap item 4 — **SSRS/RDL report import**:
the **Reports** menu parses an SSRS/RDL report definition, links the report to
its datasets, and links each embedded dataset to its SQL analysis. Embedded,
shared, and unresolved datasets are distinguished, XML source locations are
preserved where the element tags are locatable, and parser uncertainty is
region- or document-scoped as appropriate. Combined report dependency views and
report export remain scheduled for v1.13.0.

## Highlights

- **Report → dataset linking.** A pasted or imported RDL/XML definition is
  parsed into a report with its data sources and datasets; each dataset is
  classified as **embedded** (its query text is in the report and is analysed),
  **shared** (a reference to an external shared dataset definition), or
  **unresolved** (neither a command text nor a shared reference, so it cannot
  be linked).
- **Dataset SQL analysis.** Every embedded dataset's command text is run
  through the normal SQL pipeline and attached as `dataset.analysis`. The
  **Dataset** picker lists each dataset with its source kind; selecting an
  embedded dataset loads its query into the editor and runs the full analysis.
- **XML source locations.** Report, data-source, dataset, and command-text
  regions are preserved as byte spans over the raw report text wherever the
  element tags are locatable, so a reviewer can find exactly which part of the
  RDL a finding refers to.
- **Honest diagnostics (E).** Malformed XML or a missing `<Report>` root is a
  document-scoped diagnostic with no fabricated span; an unresolved dataset is
  a region-scoped diagnostic at its own element span. Report diagnostics are
  surfaced in the Diagnostics panel alongside the SQL analysis and never
  inflate the informational-annotation count.
- **Workspace round-trip.** The report definition is an analysis input, so a
  saved workspace captures it and Restore reproduces an identical analysis
  (schema version 2, optional field, no migration required).

## Correctness baseline

- TypeScript type-checking and a clean generated build;
- 211 golden, graph, dependency, exporter, provenance, boundary, diagnostic,
  confidence, export-parity, layout, workspace, catalogue, column, and report
  tests (up from 210);
- 400 deterministic mutation cases;
- 25 browser interaction and local-runtime tests (up from 22);
- catalogue fixtures 13/13, column-lineage fixtures 18/18, column-flow
  pipeline fixtures 15/15 + column layout budgets 2/2, workspace
  persistence/filtering fixtures 14/14, export parity 20/20, layout budgets
  11/11, export traceability 69/69, and report-import fixtures 12/12; and
- the fixture-corpus metric snapshot in `docs/metrics-v1.12.0.json`: 100 %
  attribution, 100 % semantic-edge coverage, 100 % provenance, 100 % region-span
  ratio, 100 % export-parity, 100 % export-traceability, 100 % layout budgets,
  100 % workspace pass rate, 100 % catalogue pass rate, 100 % column pass rate,
  100 % column-flow pass rate, and 100 % report pass rate. Every pre-existing
  corpus aggregate is byte-identical to v1.11.0.

GitHub Actions continues to check that generated JavaScript is current, the
vendored Mermaid runtime remains pinned, runtime application files contain no
external URLs or network-submission APIs, browser storage is confined to the
opt-in persistence module, the local-file smoke test passes, and the metric
snapshot is current.

## Compatibility and upgrade notes

- The v1.12.0 analysis is a strict superset: object-level graphs, exports,
  confidence, coverage, and diagnostics are unchanged. Report import adds a
  new input surface and findings; it never renames or rewires existing nodes
  and edges.
- Exported `.drawio` files from earlier releases remain valid.
- Saved workspaces are unchanged (schema v2 from v1.9.0; the optional report
  field round-trips and older snapshots migrate cleanly).
- The local-only browser security model is unchanged.

## Security and privacy (v1.12.0)

- Report parsing runs entirely in the browser tab on the pasted/imported RDL.
  Nothing is uploaded, executed, or sent to any API.
- No new network, storage, or telemetry paths were added; the only runtime that
  touches browser storage remains the opt-in workspace module, and the report
  module (`dist/src/report.js`) parses report definitions in memory only.

## Known limitations

- Parsing is heuristic rather than compiler-grade.
- Dynamic SQL remains opaque.
- Report dependency views and report export are scheduled for v1.13.0; this
  release reports on a report definition and its datasets without drawing a
  combined report graph.
- Shared dataset references name an external definition that is not present in
  the RDL; there is no SQL to analyse for them here.
- An unresolved dataset (no command text and no shared reference) is reported
  with a region-scoped diagnostic and is never guessed.

Verify critical dependencies and report findings against the original RDL and
the target report server.

See [README.md](../README.md) for usage and development guidance.