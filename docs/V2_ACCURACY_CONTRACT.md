# ProcFlow v2 accuracy contract

ProcFlow v2.0.0 is a local-first, deterministic heuristic static analyser. It
does not compile or execute SQL, connect to databases, or prove runtime
behaviour. Its diagrams are review evidence: validate material conclusions
against source and the target database.

## Analysis guarantees

1. **No silent drops.** Analysed body tokens are attributed to resolved,
   intentionally ignored, opaque, or unresolved regions. Unsupported or
   malformed regions remain visible and diagnostic-bearing.
2. **No invented semantic facts.** An object identity, call, dependency,
   column binding, control path, or data-flow edge is asserted only with static
   evidence. Otherwise ProcFlow represents an external, ambiguous, opaque, or
   unresolved result.
3. **Traceability.** Source-derived nodes and region diagnostics retain valid
   source spans. Synthetic nodes declare their origin; external identities keep
   the complete referenced name.
4. **Conservative degradation.** Dynamic, ambiguous, malformed, unsupported,
   and branch/loop-unsafe inputs must not be upgraded into certain facts.

## Stable graph semantics

| Kind | ProcFlow asserts | It does not assert |
| --- | --- | --- |
| `control` | a statically modelled possible execution order | that every runtime path takes it |
| `exception` | transfer to a compatible statically modelled handler | every database runtime error outcome |
| `call` | a statically identified procedure/function invocation | a dynamic statement name or prepared statement |
| `dependency` | a statically identified object read/reference | an unverified external identity |
| `data` | a unique, conservatively proven producer → consumer definition | data flow across ambiguous branch/loop definitions |
| column/data flow | an explicit scope/projection/source binding | a binding for ambiguous names, stars, or opaque expressions |

## Diagnostics and confidence

Diagnostic codes are stable identifiers. Severity is `error`, `warning`, or
`info`; informational resolved constructs do not inflate reviewer findings.
Region diagnostics carry valid half-open spans. Document diagnostics use
document scope with no fabricated span. Code removals or semantic changes need
a compatibility mapping or major-version notice, except an urgent correction
that prevents a false assertion.

The confidence formula is version `1.6.0`: dialect certainty × token-weighted
region quality × `(0.6 + 0.4 × coverage)`. Resolved, approximate, opaque, and
error regions score 1.00, 0.75, 0.40, and 0.15. Token consumption cannot turn
an opaque or ambiguous region into a resolved fact.

## Workspaces

Workspace schema 2 round-trips current inputs exactly and deterministically
migrates supported older snapshots while preserving source text and supported
settings. A future schema version is rejected with
`future_workspace_version`; it is neither coerced nor persisted as an older
workspace. Rejected saved-workspace bytes, including corrupt data, remain until
the user explicitly chooses **Forget**. Imported data is not applied or changed
when rejected.

## Export, privacy, and compatibility

The live graph, Mermaid, SVG, and draw.io exports preserve node identities,
semantic edge kinds, labels, object identities, source provenance, and
synthetic-node origin. Layout/style differences must not change meaning.

ProcFlow has no required backend, automatic SQL transmission, telemetry,
database connection, SQL execution, or cloud persistence. Browser storage is
opt-in; imports, exports, and clipboard operations are explicit. Export text
is treated as hostile and escaped at Mermaid/XML boundaries.

## Qualification evidence

`tests/adversarial-matrix.ts` contains checked-in synthetic cases for T-SQL,
PL/pgSQL, DB2 SQL PL, and SQLite. It tests required and forbidden graph,
estate, diagnostic, provenance, opacity, and column semantics, including the
v1.14.1 LATERAL, DB2 PREPARE/EXECUTE, and SESSION temporary-table regressions.
The fixture-only [v2 metric snapshot](metrics-v2.0.0.json) records 15 cases,
56 assertions (41 required, 15 forbidden), and
`dialectAdversarialSemanticAssertionRate: 1.0`.

This is stronger evidence than attribution or edge-kind coverage, but it is not
a universal SQL-correctness oracle.
