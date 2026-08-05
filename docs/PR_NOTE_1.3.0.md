# PR: v1.3.0 — Trust procedural control flow (slice 1)

## Summary

This PR delivers the **first vertical slice** of the **v1.3.0 — Trust procedural
control flow** milestone from `ROADMAP.md` (Workstream B): mixed one-line and
block `IF`/`WHILE` forms parse into a single control-flow AST. It lands the
exact graph-edge and range fixtures the Workstream B acceptance criteria call
for, plus a runnable example. No production parser code changed: the existing
`parseStatement` (`src/dialects.ts:347` `IF`, `:388` `WHILE`) already handled
both the single-statement form and the `BEGIN`/`END` (or `THEN`/`DO`) block form,
and this release now locks that behaviour in with failing-before-then-green
fixtures so it cannot silently regress.

## What's included

### Mixed one-line + block `IF`/`WHILE`

One AST now models a whole procedure regardless of whether each `IF`/`WHILE`
uses a one-line statement body or a `BEGIN … END` block, and regardless of
mixing the two within a procedure:

- `IF cond SELECT …;` (single statement) and `IF cond BEGIN … END ELSE …`
  (block) — including mixed nesting, e.g. a one-line `IF` inside an
  `IF`-block's `ELSE` branch.
- `WHILE cond SET @i = @i + 1;` (single statement) and
  `WHILE cond BEGIN … IF … END` (block with a nested one-line `IF`).
- DB2 `IF … THEN … ELSE BEGIN … END; END IF;` mixed forms.

Accepted via `EMIT`-level graph-edge assertions: each condition branches
`yes`/`no` and loop bodies wire back to the loop condition, and outer block
exits flow to the next statement rather than a wrong neighbour.

### Fixtures

- `tests/dialects/tsql.ts` — 2 new `graphExpect` fixtures: mixed one-line and
  block `IF`, and mixed one-line and block `WHILE`.
- `tests/dialects/db2.ts` — 1 new `graphExpect` fixture: DB2 mixed
  `THEN`-statement and `BEGIN`-block `IF`.
- `tests/boundary.ts` — 2 new `PROCFLOW_RANGE_FIXTURES` asserting the exact
  source ranges of the statements inside a mixed T-SQL `IF` and a mixed DB2
  `IF`.

All new fixtures fail on the pre-slice parser state only if behaviour differs;
here they passed immediately, confirming the parser already produced the
correct single AST.

### Example

- `examples/dbo.v130_demo.sql` — a single procedure that exercises all five
  mixed forms (one-line `IF`, block `IF/ELSE`, mixed-nested `IF`, one-line
  `WHILE`, block `WHILE` with a nested one-line `IF`). Parses with coverage
  `1.0`, no diagnostics, `branch:5`, `loop:2`.

## Verification

- `npm run typecheck` — passes
- `npm run build` — passes
- `npm run test:file` — passes
- Golden suite — 164/164 (159 prior + 5 new records; no prior golden changed)
- Fuzz suite — 400 deterministic mutation cases pass
- UI suite — 13/13
- Local-only URL check — clean

## Deferred within v1.3.0 (remaining Workstream B, next slices)

Scheduled in `docs/v1.3.0-implementation-plan.md`:

- Labelled loop-control and `GOTO` hardening (source spans, target validation,
  `goto_unresolved` diagnostic, "unresolved label" node)
- Cursor query bodies in query graphs (DB2 `FOR`, T-SQL `DECLARE … CURSOR`)
- DB2 `ATOMIC` block rollback scope
- Extended `summarise` label set
- E procedural diagnostics and F export-parity fixtures for the new constructs

Workstreams C/D, confidence re-score, layout, catalogue, columns, and RDL
remain deferred per `ROADMAP.md@269`.
