# proc>flow v1.3.0 — Trust procedural control flow

**Release date:** 2026-08-06

This release delivers the **Trust procedural control flow** milestone from
[ROADMAP.md](../ROADMAP.md) (Workstream B in full). Procedural control flow is
now resolved and verified end to end: mixed `IF`/`WHILE` forms parse into a
single AST, labelled loop-control and `GOTO` are validated with source spans,
cursor queries join the query graphs, and DB2 `ATOMIC` blocks carry a rollback
scope. Workstream B ships complete, plus the E procedural diagnostics and the F
export-parity fixtures each construct requires.

## What's new

### Mixed one-line + block `IF`/`WHILE` (one AST)

A procedure may freely mix single-statement and block bodies for the same
control construct and still produce one consistent AST:

- `IF cond SELECT …;` and `IF cond BEGIN … END ELSE …` — including a one-line
  `IF` nested inside an `IF`-block branch.
- `WHILE cond SET @i = @i + 1;` and `WHILE cond BEGIN … IF … END`.
- DB2 `IF … THEN … ELSE BEGIN … END; END IF;` mixed forms.

Every condition branches `yes`/`no`, loop bodies wire back to the loop
condition, and block exits flow to the next statement.

### Labelled loop-control and `GOTO` hardening

- `GOTO`, `LEAVE`/`EXIT`/`CONTINUE`/`ITERATE` and bare labels now carry source
  spans, so a diagram node selects the exact keyword in the editor.
- Targets are validated against enclosing loop labels and declared labels
  (forward `GOTO` stays supported).
- An unresolved target raises a new **`goto_unresolved`** warning with correct
  **region scope** and a valid span, and draws an explicit **"Unresolved
  label"** node instead of silently dropping control flow.
- Resolved `GOTO` still produces a dotted `goto` edge to the label.

### Cursor queries in query graphs

- T-SQL `DECLARE … CURSOR FOR` and DB2 `FOR … CURSOR FOR` queries now appear in
  **Query structure** view: the source table behind the cursor is shown as a
  source node.
- The existing object-level cursor read extraction is preserved (and DB2 `FOR`
  cursor reads are now captured at object level too).

### DB2 `ATOMIC` block rollback scope

- `BEGIN ATOMIC` renders a `BEGIN ATOMIC · rollback scope` marker; unhandled or
  EXIT/UNDO-handler exits route to an `Implicit rollback · ATOMIC block`
  terminal rather than continuing to the next statement.
- The block scope survives the top-level body unwrap, so `CREATE PROCEDURE …
  BEGIN ATOMIC … END` is preserved.
- `BEGIN NOT ATOMIC` and `ATOMIC`/`NOT` stay ignored syntax for token
  attribution.

### Extended statement labels (`summarise`)

- `GRANT`/`REVOKE`/`DENY` now summarise to `GRANT … ON <object>`.
- `WAITFOR`, `KILL`, and cursor operations `OPEN`/`CLOSE`/`FETCH`/`DEALLOCATE`
  get concise labels (e.g. `FETCH FROM c`) instead of full statement text.

### E procedural diagnostics and F export parity

- `goto_unresolved` is region-scoped with a valid span (E).
- Every new construct (unresolved-label node, DB2 `ATOMIC` marker) is covered by
  `toMermaid` + `toDrawio` export-parity tests: well-formed draw.io XML with
  provenance/kind metadata, and a `flowchart` Mermaid definition (F).

### Attribution

- Loop-control, `GOTO`, and label tokens are now attributed as resolved, so the
  corpus's unresolved-token rate drops instead of rising with the new fixtures.

## What's unchanged

- Every pre-existing golden keeps its structure; the corpus only grew. The sole
  re-labelling is the DB2 `FETCH NEXT FROM c INTO …` window now reading
  `FETCH FROM c` under the cursor-ops `summarise` rule (edges untouched).
- Semicolon/boundary semantics, number lexing, and transaction modelling from
  1.1.0/1.2.0 are unchanged.
- The local-only, browser-only security model is unchanged.

## Files changed

- `src/types.d.ts` — `BlockNode.atomic`; `span`/`toks` on label, goto,
  loop-control nodes
- `src/dialects.ts` — `BEGIN ATOMIC` tracking; label/`GOTO`/loop-control
  spans + token capture
- `src/ir.ts` — atomic block rollback scope; unresolved-label nodes;
  `goto_unresolved` diagnostic; extended `summarise`; DB2 `FOR` cursor reads in
  `buildObjectIR`; attribution of control tokens
- `src/lineage.ts` — `queryTokensBehindCursor`; cursor queries collected into
  `buildObjectQueryGraph`
- `tests/dialects/{tsql,db2,plpgsql}.ts` — unresolved-target, span, and DB2
  `ATOMIC` graph fixtures
- `tests/tests.ts` — v1.3.0 assertion block (diagnostics, spans, cursor query
  graphs, `summarise`, export parity)
- `examples/dbo.v130_demo.sql` — full control-flow demo
- `docs/PR_NOTE_1.3.0.md`, `docs/RELEASE_NOTE_1.3.0.md`,
  `docs/RELEASE_NOTE_v1.3.0.md` — release notes
- `README.md`, `package.json` — v1.3.0 references and version
- `dist/` — generated artefacts rebuilt to match sources

## Verification

- `npm run typecheck` — passes
- `npm run build` — passes
- `npm run test:file` — passes
- Golden suite — 181/181
- Fuzz suite — 400 deterministic mutation cases
- UI suite — 13/13
- Mermaid checksum pinned; local-only URL check clean; `dist/` committed in sync

## Deferred (per roadmap)

- Query lineage accuracy (Workstream C) → v1.4.0
- Data flow and dependency accuracy (Workstream D) → v1.5.0
- Confidence re-score → v1.6.0; layout replacement → v1.7.0
- Catalogue, columns, and RDL → v1.9.0+

See [RELEASE_NOTE_v1.3.0.md](RELEASE_NOTE_v1.3.0.md) for the release summary
and [README.md](../README.md) for usage.
