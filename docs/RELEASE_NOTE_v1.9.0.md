# proc>flow v1.9.0 — Resolve by catalogue

**Release date:** 2026-08-08

ProcFlow v1.9.0 accepts database catalogue metadata so the diagram can resolve
object references to their **exact identity** instead of guessing. Where the
catalogue proves a match, an unqualified synonym, a linked-server name, or a
cross-database reference becomes a **verified** object; where the evidence is
partial or conflicting, ProcFlow stays conservative and tells the reviewer
which reference could not be proven and why.

Everything is local: the catalogue is pasted or imported into the current tab,
stays in the browser, and is never uploaded. Column metadata is accepted and
validated now; column lineage uses it in a later release.

## Highlights

- **Catalogue metadata import.** The new **Catalogue** menu accepts a pasted or
  imported catalogue in either a JSON schema or a forgiving one-object-per-line
  text format (`# comment`, `name KIND synonym1, synonym2 …`, and `COL
  table.column` lines). Object kind, synonyms, and columns all parse.
- **Verified resolution replaces external labels.** In **Object dependencies**
  scope and the **Query structure** view, a reference that the catalogue proves
  (an exact full-name match, or an explicit synonym) renders as its canonical
  object identity instead of a conservative `external: …` label. The resolution
  survives as metadata on draw.io exports.
- **Conservative when uncertain.** Only exact and synonym matches count as
  "verified". A reference that only partially matches (for example a server
  prefix over a catalogued object) stays external and attaches a region-scoped
  `catalogue_partial` diagnostic naming the unproven candidate. Duplicate or
  colliding catalogue entries yield a `catalogue_conflict` diagnostic and never
  invent a verification.
- **E diagnostics for catalogue data.** Parse errors, empty input, conflicts,
  and partial matches are reported with the correct document/region scope.
- **Workspace integration.** The saved workspace now carries the catalogue
  text (schema v2, migrating v1 snapshots), so **save → reload** still
  reproduces an identical analysis even when a catalogue was in use.

## Correctness baseline

- TypeScript type-checking and a clean generated build;
- 208 golden, graph, dependency, exporter, provenance, boundary, diagnostic,
  confidence, export-parity, layout, workspace, and catalogue tests;
- 400 deterministic mutation cases;
- 22 browser interaction and local-runtime tests (up from 20);
- catalogue fixtures 13/13, workspace persistence/filtering fixtures 13/13,
  export parity 20/20, layout budgets 11/11, export traceability 69/69; and
- the fixture-corpus metric snapshot in `docs/metrics-v1.9.0.json`: 100 %
  attribution, 100 % semantic-edge coverage, 100 % provenance, 100 % region-span
  ratio, 100 % export-parity, 100 % export-traceability, 100 % layout budgets,
  100 % workspace pass rate, and 100 % catalogue pass rate.

GitHub Actions continues to check that generated JavaScript is current, the
vendored Mermaid runtime remains pinned, runtime application files contain no
external URLs or network-submission APIs, browser storage is confined to the
opt-in persistence module, the local-file smoke test passes, and the metric
snapshot is current.

## Compatibility and upgrade notes

- **Saved workspaces migrate forward.** The workspace schema is now v2 with an
  optional `catalogue` field; v1 snapshots restore with no catalogue and keep
  every prior option default. Existing saved workspaces are not lost.
- Exported `.drawio` files from v1.7.0/v1.8.0 remain valid; catalogue
  resolution is an additional metadata field on vertices, not a format change.
- The local-only browser security model is unchanged.

## Security and privacy (v1.9.0)

- The catalogue is pasted or imported into the current tab only and is never
  uploaded, executed, or sent to any API.
- A saved workspace may include catalogue text; as before, persistence is
  opt-in (`Save to this browser`), local-only, versioned, exportable, and
  removed by **Forget saved workspace**.
- No new network, storage, or telemetry paths were added.

## Known limitations

- Parsing is heuristic rather than compiler-grade.
- Dynamic SQL remains opaque.
- Verification is deliberately conservative: suffix-only matches and
  unqualified names without a catalogue synonym stay external until the
  catalogue proves them.
- Columns are parsed and validated but not yet used; column lineage remains
  scheduled for v1.10.0+.
- RDL/report import remains scheduled for v1.12.0.

Verify critical dependencies and resolution conclusions against the original
SQL, the target database, and the actual catalogue of the audited environment.

See [README.md](../README.md) for usage and development guidance.
