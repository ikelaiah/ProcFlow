# PR: v1.3.0 — Trust procedural control flow

## Summary

This PR implements the **v1.3.0 — Trust procedural control flow** milestone from
`ROADMAP.md`: Workstream B in full, plus the E procedural diagnostics and F
export-parity fixtures each construct requires. Procedural control flow is now
resolved, validated, and exported consistently across T-SQL, DB2, and PL/pgSQL.
The golden suite grows from 164 to 181; fuzz and UI suites stay green.

## What's included

### Mixed one-line + block `IF`/`WHILE` (one AST)

Single-statement bodies and `BEGIN`/`END` (or `THEN`/`DO`) block bodies mix
freely in one procedure and parse into a single control-flow AST. Conditions
branch `yes`/`no`; loop bodies wire back to the loop condition. Locked in by
graph-edge fixtures in `tests/dialects/tsql.ts`, `tests/dialects/db2.ts`, and
`tests/boundary.ts` (`src/dialects.ts:347` `IF`, `:388` `WHILE`).

### Labelled loop-control + `GOTO` hardening

- Labels, `GOTO`, and loop-control statements now carry source spans and token
  attribution (`src/types.d.ts`, `src/dialects.ts`).
- Targets are validated against enclosing loop labels and declared labels
  (forward `GOTO` supported). Unresolved targets raise `goto_unresolved`
  (region scope, valid span) and render an explicit **"Unresolved label"** node
  instead of a silent drop (`src/ir.ts` `buildGraph`, `analyse`,
  `unresolvedControlTargets`).

### Cursor queries in query graphs

`queryTokensBehindCursor` (`src/lineage.ts`) extracts the query after a
T-SQL `DECLARE … CURSOR FOR` or DB2 `FOR … CURSOR FOR`; `buildObjectQueryGraph`
collects those query bodies so their source tables appear in Query structure
view. Object-level cursor reads are preserved, and DB2 `FOR` cursor reads are
now captured in `buildObjectIR` (`src/ir.ts`).

### DB2 `ATOMIC` rollback scope

`BEGIN ATOMIC` is tracked in `parseStatement` and rendered as
`BEGIN ATOMIC · rollback scope`; EXIT/UNDO-handler exits route to an
`Implicit rollback · ATOMIC block` terminal. The scope survives the body unwrap
so `CREATE PROCEDURE … BEGIN ATOMIC … END` is preserved. `NOT`/`ATOMIC` remain
ignored syntax for attribution.

### Extended `summarise` label set

`GRANT`/`REVOKE`/`DENY` (`GRANT … ON <object>`), `WAITFOR`, `KILL`, and cursor
operations `OPEN`/`CLOSE`/`FETCH`/`DEALLOCATE` (`FETCH FROM c`) now produce
concise node labels (`src/ir.ts` `summarise`).

### E diagnostics + F export parity

- `goto_unresolved` is region-scoped with a valid span; asserted in
  `tests/tests.ts`.
- Each new construct (unresolved-label node, DB2 `ATOMIC` marker) is covered by
  `toMermaid`/`toDrawio` export-parity tests (well-formed XML, provenance/kind
  metadata), plus the existing draw.io/Mermaid golden checks.
- Cursor query graphs and the extended label set are asserted directly in the
  new v1.3.0 block of `tests/tests.ts`.

### Other

- `examples/dbo.v130_demo.sql` demonstrates all four headline outcomes.
- README and `package.json` bumped to v1.3.0.

## Not changed

- Existing golden structure is preserved. The only re-labelling is the DB2
  `FETCH NEXT FROM c …` window reading `FETCH FROM c` under the new cursor-ops
  `summarise` rule; its graph edges are unchanged.
- 1.1.0/1.2.0 boundary, lexing, and transaction semantics are untouched.
- The local-only security model is unchanged.

## Fixtures

- `tests/dialects/tsql.ts` — resolved/unresolved `GOTO`, label-sourced ranges
- `tests/dialects/db2.ts` — unresolved `LEAVE`; DB2 `ATOMIC` scope; updated
  cursor-ops label
- `tests/dialects/plpgsql.ts` — unresolved `EXIT` loop target
- `tests/tests.ts` — v1.3.0 assertion block (diagnostics, spans, cursor query
  graphs, `summarise`, export parity)

## Verification

- `npm run typecheck` — passes
- `npm run build` — passes
- `npm run test:file` — passes
- Golden suite — 181/181 (was 164)
- Fuzz suite — 400 deterministic mutation cases
- UI suite — 13/13
- Local-only URL check clean; `dist/` committed in sync

## Deferred (per roadmap)

- Workstream C (query lineage accuracy) → v1.4.0
- Workstream D (data flow / dependency accuracy) → v1.5.0
- Confidence re-score → v1.6.0; layout replacement → v1.7.0
- Catalogue, columns, and RDL → v1.9.0+
