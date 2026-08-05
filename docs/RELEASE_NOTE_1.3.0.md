# proc>flow v1.3.0 — Trust procedural control flow

**Release date:** 2026-08-06

This is the first slice of the **Trust procedural control flow** milestone from
[ROADMAP.md](../ROADMAP.md) (Workstream B). It makes mixed one-line and block
`IF`/`WHILE` forms parse into a single control-flow AST, so the diagram reflects
the true branching instead of treating single-statement and `BEGIN…END` bodies
as if they belonged to different shapes of control flow.

## What's new

### Mixed one-line + block `IF`/`WHILE`

A procedure may freely mix single-statement and block bodies for the same
control construct, and it now always produces one consistent AST:

- `IF cond SELECT …;` and `IF cond BEGIN … END ELSE …` — including a one-line
  `IF` nested inside an `IF`-block branch.
- `WHILE cond SET @i = @i + 1;` and `WHILE cond BEGIN … IF … END`.
- DB2 `IF … THEN … ELSE BEGIN … END; END IF;` mixed forms.

Each condition still branches `yes`/`no`, loop bodies wire back to the loop
condition, and block exits flow to the next statement.

### Fixtures and example

- New graph-edge fixtures for mixed `IF` and `WHILE` in `tests/dialects/tsql.ts`
  and `tests/dialects/db2.ts`, and exact-statement-range fixtures in
  `tests/boundary.ts` (the `tests/dialects/*.ts` assertion pattern the roadmap
  requires).
- `examples/dbo.v130_demo.sql` — a runnable procedure exercising all five mixed
  forms (opens cleanly, coverage 1.0, no diagnostics).

## What's unchanged

- Every existing golden fixture keeps its structure and assertions; the corpus
  only grew from 159 to 164.
- Labelled loop-control/`GOTO` hardening, cursor query graphs, DB2 `ATOMIC`
  scope, and the extended `summarise` set are still in progress and will land
  in later v1.3.0 slices (see `docs/v1.3.0-implementation-plan.md`).
- Workstreams C/D, confidence re-score, layout, catalogue, columns, and RDL
  remain deferred per the roadmap.
- The local-only, browser-only security model is unchanged.

## Files changed

- `examples/dbo.v130_demo.sql` — new mixed control-flow demo
- `tests/dialects/tsql.ts` — 2 mixed `IF`/`WHILE` graph fixtures
- `tests/dialects/db2.ts` — 1 DB2 mixed `IF` graph fixture
- `tests/boundary.ts` — 2 mixed `IF` statement-range fixtures
- `docs/v1.3.0-implementation-plan.md` — new; documents the remaining v1.3.0
  slices (labelled control/`GOTO`, cursor query graphs, DB2 `ATOMIC`,
  `summarise` set, E/F fixtures)
- `dist/tests/*` — generated artefacts rebuilt to match sources

## Verification

- `npm run typecheck` — passes
- `npm run build` — passes
- `npm run test:file` — passes
- Golden suite — 164/164
- Fuzz suite — 400 deterministic mutation cases
- UI suite — 13/13
- Corpus: mixed forms produce zero error diagnostics and coverage 1.0; no
  `unknown`-node fallback introduced.

See [RELEASE_NOTE_v1.0.0.md](RELEASE_NOTE_v1.0.0.md) for the baseline release
and [README.md](../README.md) for usage.
