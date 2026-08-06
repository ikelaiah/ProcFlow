# proc>flow v1.5.0 — Data flow and internal resilience

**Release date:** 2026-08-07

ProcFlow v1.5.0 completes the **Data flow and internal resilience** milestone:
the control-flow diagram now shows how the steps of a procedure feed one
another through temporary tables, external references keep their complete
identity, transaction recovery models two more real-world edge cases, and the
analysis panel reports exactly how many constructs were detected, resolved, or
left opaque.

The release remains local-first: SQL is analysed entirely in the browser and
is not uploaded, executed, or persisted.

## Highlights

- **Temp-table data flow.** `SELECT … INTO #stage` wires a labelled data-flow
  edge to each later consumer on a provably linear path, so staging pipelines
  read as pipelines. Data edges are thicker and green in both Mermaid and
  draw.io exports, derived from the semantic `data` edge kind.
- **Conservative when ambiguous.** A temp table written inside a branch,
  loop, or `TRY` has no unique producer after the merge, so no edge is
  invented; an informational `temp_flow_ambiguous` annotation says why.
- **Honest external references.** In the dependency view, an unmatched
  three-/four-part name renders as
  `external: [server].[database].[schema].[object]` — never a bare last-part
  match that could be mistaken for a known object.
- **Transaction edge cases.** A savepoint declared in `TRY` stays visible in
  `CATCH`, so savepoint-only recovery reads as "roll back to savepoint …;
  depth unchanged", and `SET XACT_ABORT` inside a `CATCH` is annotated as
  catch-scoped.
- **Construct coverage in the UI.** A new **Constructs** signal reports
  resolved/detected constructs — branches, loops, handlers, CTEs, source
  references, and temp-flow links — with opaque counts broken out.

## Correctness baseline

- TypeScript type-checking and a clean generated build;
- 199 golden, graph, dependency, exporter, provenance, boundary, and
  diagnostic tests;
- 400 deterministic mutation cases;
- 14 browser interaction and local-runtime tests; and
- the direct `file://` application smoke test.

GitHub Actions also checks that generated JavaScript is current, the vendored
Mermaid runtime remains pinned, and runtime application files contain no
external HTTP URLs.

## Compatibility and upgrade notes

- No data migration is required because ProcFlow does not persist SQL or
  workspace state.
- Sequential control-flow edges are no longer misclassified as semantic data
  edges; only genuine producer→consumer and dependency-write edges carry the
  `data` kind and its distinct export style.
- The local-only browser security model is unchanged.

## Known limitations

- Parsing is heuristic rather than compiler-grade.
- Dynamic SQL remains opaque.
- Temp-table data flow is shown within one object; cross-object temp flow,
  synonyms, linked servers, and cross-database references have lightweight
  resolution.
- Query lineage is object-level rather than column-level.
- Exceptionally malformed batches can still produce imperfect statement
  splits.
- Large draw.io exports can still require manual rearrangement.

Verify critical dependencies, execution paths, transaction behavior, and
security conclusions against the original SQL and target database.

See [README.md](../README.md) for usage and development guidance.
