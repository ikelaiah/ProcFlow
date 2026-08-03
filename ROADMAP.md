# proc>flow Roadmap — Diagram Accuracy

This roadmap has one goal: **diagrams that accurately represent the logic flow
of the SQL they are given.** Because ProcFlow is a heuristic, browser-only
parser, accuracy is pursued on three fronts:

1. **Resolve more SQL correctly** — turn `Unresolved SQL` nodes, misplaced
   edges, and silently dropped branches into correct diagrams.
2. **Report what cannot be resolved** — confidence, coverage, and diagnostics
   granular enough that a reviewer always knows what is verified vs estimated.
3. **Export with fidelity** — Mermaid and draw.io represent the analysis
   identically, keep node→source traceability, and lay the graph out so the
   logic flow is never obscured.

## Guiding principles

- **No silent drops.** Unconsumed input must appear as an unresolved node plus
  a diagnostic, never vanish.
- **Every node is traceable.** Valid source spans on every node — and the
  traceability survives into exported files, not just the live diagram.
- **One analysis, one story.** Mermaid and draw.io are two renderings of one
  `Graph`; they must never disagree about nodes, edges, labels, or styles.
- **Failing-first fixtures.** Every parser/lineage change ships with a fixture
  that fails before and passes after the change.
- **Coverage is a measure, not a target.** Raising coverage only matters when
  consumed tokens map to *correct* structure; edge-fixture assertions beat
  percentage counts.
- **Conservative when uncertain.** Prefer the reading that cannot invent an
  edge.

## Where accuracy is lost today

```text
tokenizer.ts → dialects.ts → lineage.ts → ir.ts → exporters.ts
```

| Stage | Where accuracy is lost | Fixed by |
|---|---|---|
| Lexical & boundaries (`tokenizer.ts`, `dialects.ts`) | Parens-only balance checks; statement splits rely on newline + `HARD`/`SOFT` keywords (`newStatementHere`); narrow number lexing; keyword-count dialect detection; `findBody` edge cases | A |
| Procedural parsing (`dialects.ts`) | `IF` single-statement vs block ambiguity; label-scoped loop control (`BREAK`/`LEAVE`/`EXIT`/`GOTO`); cursor `FOR`/`DECLARE … CURSOR` sources unparsed; DB2 `ATOMIC` rollback not modelled; fixed `summarise` label set; fallback to `unknown` nodes | B |
| Query lineage (`lineage.ts`, `ir.ts`) | Comma-separated sources dropped; `APPLY`/`LATERAL`/tabular functions incomplete; `UPDATE…FROM`/`DELETE…USING`/`MERGE…USING` reads inconsistent; recursive CTEs unmarked; derived-table inner sources not plotted; object-level only | C |
| Graph & estate (`ir.ts`) | No temp-table data flow; lightweight synonym/linked-server/cross-db resolution; missing transaction edge cases (`XACT_ABORT` in `CATCH`, savepoint-only recovery) | D |
| Export (`exporters.ts`) | Traceability lost on export; style parity implicit and untested; no data-flow edge style; naive BFS layout; `\u0001` text sentinel | F |
| Confidence & diagnostics (`ir.ts`, `app.ts`) | Whole-document confidence number; token-count coverage; diagnostics not span-attached for every approximation | E |

## Workstreams

### A. Statement-boundary hardening (`tokenizer.ts`, `dialects.ts`)

**Goal:** statement splitting is robust without depending on newline position.

- Balance diagnostics for brackets and `BEGIN`/`END` pairing.
- Semicolon-authoritative statement boundaries, per dialect, replacing the
  newline+`SOFT` heuristic; preserve `newStatementHere` behaviour via fixtures
  (`p31` already covers the semicolon-free case).
- Number lexing: `0x` hex, PostgreSQL `1_000` separators, `1.`/`.5` forms.
- `dialect_ambiguous` guardrail on low-confidence detection ties.
- `findBody` hardening: `CREATE VIEW … WITH`, `ALTER` headers, multi-object
  scripts without `GO`.

**Acceptance:** all existing `tsql-fixtures.ts` cases pass unchanged; new
fixtures per item; `unconsumed_input` rate does not increase.

### B. Procedural parsing completeness (`dialects.ts`)

**Goal:** resolve more real-world control flow; label what stays unresolved.

- Mixed one-line and block `IF`/`WHILE` parse to one AST.
- Precise labelled loop control and `GOTO`; unresolved labels get a
  `goto_unresolved` diagnostic and an explicit "unresolved label" node.
- Parse query behind DB2 `FOR` cursors and T-SQL `DECLARE … CURSOR` bodies so
  cursor sources appear in the read side.
- DB2 `ATOMIC` block rollback scope in the graph.
- Extended `summarise` label set (`GRANT`, `WAITFOR`, `KILL`, …).

**Acceptance:** new graph-edge fixtures per construct (the
`tests/dialects/*.ts` pattern); `unknown`-node fallback rate stays flat or
drops.

### C. Query lineage accuracy (`lineage.ts`, `ir.ts`)

**Goal:** the query diagram reports every object a query reads, joins, or
produces.

- Detect comma-separated sources in `refsIn` (`FROM a, b` wires both `a` + `b`).
- `APPLY`/`LATERAL`/tabular functions (`UNNEST`, `XMLTABLE`, `JSON_TABLE`,
  `GENERATE_SERIES`, …) as source objects or documented opaque nodes.
- Read extraction from `UPDATE…FROM`, `DELETE…USING`, `MERGE…USING`.
- Mark recursive CTEs in the graph and emit a `recursive_cte` diagnostic.
- Wire derived-table/subquery inner sources into the query graph.

**Acceptance:** new query fixtures assert exact source-node lists; existing
query fixtures (p24–p26, p37–p42, view/CTE cases) unchanged.

### D. Data-flow and dependency accuracy (`ir.ts`)

**Goal:** show how the steps of a procedure actually feed one another.

- Temporary-table producer→consumer edges (`SELECT … INTO #stage` → later
  `#stage` consumers) — the largest single readability win for procedures.
- Conservative, labelled external nodes: unknown three-/four-part names render
  as `external: [server].[db].[schema].[obj]`, not a bare last-part match.
- Transaction edge cases: `SET XACT_ABORT` inside `CATCH`, savepoint-only
  recovery, DB2 `ATOMIC` rollback scopes.

**Acceptance:** new temp-table and external-node fixtures; existing
transaction fixtures (XACT_STATE, @@TRANCOUNT, savepoints) byte-identical.

### E. Confidence and diagnostics granularity (`ir.ts`, `app.ts`)

**Goal:** the reviewer can always tell which part of the diagram is estimated.

- Span-attached diagnostics for every approximate resolution (dynamic SQL
  already does this; extend to comma sources, `APPLY`, recursive CTEs,
  unresolved labels).
- Construct-coverage statistic (branches, loops, handlers, CTEs, source refs)
  alongside token coverage.
- Documented confidence formula derived from the per-region signals, keeping a
  single headline number in the UI.

**Acceptance:** golden tests assert the new diagnostic codes; UI tests assert
the construct-coverage display; existing `coverage-val` UI assertions still
pass.

### F. Export fidelity (`exporters.ts`)

**Goal:** exports preserve analysis accuracy, traceability, and readable
layout.

- Preserve traceability: `node.source`/`objectId` as metadata on `.drawio`
  vertices; source-span map in a Mermaid `%%` comment block.
- Canonical node-class→shape/style and edge-type→style mapping shared by both
  exporters, with an export-parity fixture per construct (same nodes, edges,
  labels; draw.io XML well formed).
- Distinct data-flow edge style in both exporters.
- Replace naive `layoutDrawio` BFS with a layered, crossing-reducing,
  data-flow-aware layout (control-flow-first ordering; data-flow edges never
  cut the main flow; no overlaps; readable labels).
- Keep exporters in lockstep with every new node class/edge type from A–E.

**Acceptance:** export-parity fixture per construct; `.drawio` round-trips
with metadata intact; layout fixtures assert no data-flow/main-flow crossing.

## Release plan — v1.1.0 through v2.0.0

Each release is capability-based and shippable on its own. README post-v1.0.0
items are scheduled: **item 8 → v1.3.0, item 7 → v1.4.0, item 5 → v1.5.0,
item 6 → v1.6.0, item 4 → v1.7.0.**

| Release | Theme | Ships |
|---|---|---|
| v1.1.0 | Report every object a query touches | C; F traceability + parity; E diagnostics |
| v1.2.0 | Trust the boundaries | A + B; F parity; E diagnostics |
| v1.3.0 | Data flow and internal resilience | D; F data-flow style; README 8; E construct coverage |
| v1.4.0 | Honest measurement, clear exports, usable workspace | E confidence re-score; F layout; README 7 |
| v1.5.0 | Resolve by catalogue | README 5; E catalogue diagnostics |
| v1.6.0 | Column-level lineage | README 6; F column export; E column confidence; layout for columns |
| v1.7.0 | Report import | README 4 (import + dataset linking); E report diagnostics |
| v1.8.0 | Report intelligence | report → object → column views; F report export |
| v1.9.0 | Scale and convergence | layout completion; full regression; metrics finalization |
| v2.0.0 | Final convergence | accuracy contract; README + release notes; all fixtures green |

### v1.1.0 — Report every object a query touches

- **Ships:** Workstream C in full; the traceability/parity parts of F
  (draw.io + Mermaid source metadata, canonical style mapping, export-parity
  suite); E diagnostics for the new constructs.
- **Deferred:** A, B, D, layout rewrite (F), construct-coverage and confidence
  re-score (E).
- **Exit criteria:** new query fixtures assert exact source-node lists for
  comma, `APPLY`, `USING`, `MERGE`, recursive-CTE, and derived-table cases;
  existing query fixtures unchanged; export-parity fixture per new construct
  and `.drawio` round-trips with metadata; new diagnostics carry source spans;
  full CI gate green.

### v1.2.0 — Trust the boundaries

- **Ships:** Workstreams A and B in full (the boundary and procedural
  foundation); F export parity for every new A/B construct; E diagnostics
  (`goto_unresolved`, `dialect_ambiguous`, block balance) with source spans.
- **Deferred:** D, layout (F), catalogue/columns.
- **Exit criteria:** all v1.0.0–v1.1.0 fixtures unchanged; graph-edge fixtures
  for mixed `IF`/`WHILE`, labelled loops, cursor sources, `ATOMIC`;
  `unknown`-node fallback rate drops; export parity for all new constructs;
  full CI gate green.

### v1.3.0 — Data flow and internal resilience

- **Ships:** Workstream D in full; the F data-flow edge style in both
  exporters; README item 8 (internal refactor: separate graph, transaction,
  estate internals with zero golden-test changes — the enabler for v1.4.0
  workspace and v1.6.0 lineage); E construct-coverage statistic + UI.
- **Deferred:** confidence re-score and layout (v1.4.0); catalogue/columns.
- **Exit criteria:** temp-table producer→consumer and external-node fixtures;
  existing transaction fixtures byte-identical; data-flow style identical in
  both exporters; refactor with zero golden-test changes; construct-coverage
  panel UI-tested; full CI gate green.

### v1.4.0 — Honest measurement, clear exports, usable workspace

- **Ships:** E confidence re-score in full (per-region signals, documented
  formula, headline number + `data-band` from the same formula); F
  `layoutDrawio` replacement (lifts the README's manual-rearrangement
  limitation for analysable graph sizes); README item 7 (workspace
  persistence + dependency filtering — security/privacy section updated and
  CI local-only check extended in the same change); metrics publishing begins.
- **Deferred:** catalogue (v1.5.0), columns (v1.6.0), RDL (v1.7.0).
- **Exit criteria:** golden fixtures assert the confidence formula; layout
  fixtures assert no data-flow/main-flow crossings and no overlaps;
  persistence round-trips (save → reload → identical analysis); dependency
  filtering fixtures; full CI gate green including the extended local-only
  check.

### v1.5.0 — Resolve by catalogue

- **Ships:** README item 5 — catalogue metadata import (paste/import
  table/view/column catalogues); exact synonym, linked-server, and
  cross-database resolution replacing v1.3.0's "external" labels with verified
  objects; E diagnostics for catalogue-informed resolution.
- **Deferred:** column lineage (v1.6.0), RDL (v1.7.0).
- **Exit criteria:** catalogue fixtures assert exact resolution; v1.3.0
  external-node fixtures update to verified objects where the catalogue
  covers them; new span diagnostics; full CI gate green.

### v1.6.0 — Column-level lineage

- **Ships:** README item 6 — column-flow edges end-to-end (`SELECT col INTO
  #t` through transformations to output columns); F column metadata +
  column-flow export styles with parity fixtures; E column-resolution
  confidence diagnostics; layout engine extended to column graphs.
  Enabled by C's object-level accuracy (v1.1.0), the refactor (v1.3.0), the
  layout (v1.4.0), and the catalogue (v1.5.0).
- **Deferred:** RDL (v1.7.0).
- **Exit criteria:** column-flow fixtures end-to-end; all object-level fixtures
  from v1.0.0–v1.5.0 unchanged; column export parity and `.drawio` round-trip
  with column metadata; column-graph layout fixtures; full CI gate green.

### v1.7.0 — Report import

- **Ships:** README item 4 — SSRS/RDL import: parse report definitions and
  link each report's datasets to their SQL; E diagnostics for report/dataset
  parsing uncertainty.
- **Deferred:** report → object → column views and report export (v1.8.0);
  layout completion (v1.9.0).
- **Exit criteria:** RDL fixtures link reports to datasets; new span
  diagnostics for report parsing; full CI gate green.

### v1.8.0 — Report intelligence

- **Ships:** report → dataset → object → column dependency views (built on the
  catalogue from v1.5.0 and column lineage from v1.6.0); F export fidelity for
  report graphs (report metadata + parity fixtures).
- **Deferred:** layout completion (v1.9.0).
- **Exit criteria:** report dependency fixtures assert the full chain to
  objects and columns; report export parity and `.drawio` round-trip; full CI
  gate green.

### v1.9.0 — Scale and convergence

- **Ships:** layout-engine completion for column-level and large dependency
  graphs; full regression of all v1.0.0–v1.8.0 fixtures; metrics finalization
  (all metrics in ["Metrics that matter"](#metrics-that-matter) published and
  trended).
- **Deferred:** final accuracy contract (v2.0.0).
- **Exit criteria:** large-graph layout fixtures pass; full regression green;
  metrics published; full CI gate green.

### v2.0.0 — Final convergence

- **Ships:** the v2.0.0 accuracy contract; README and release notes updated to
  the contract; final verification that every workstream A–F and every README
  post-v1.0.0 item is delivered.
- **Deferred:** nothing — this is the convergence release.
- **Exit criteria:** all v1.0.0–v1.9.0 fixtures pass unchanged; every roadmap
  item is delivered and documented; full CI gate green.

## Test and verification strategy

The v1.0.0 baseline is 131 golden tests, 400 fuzz cases, and 12 UI tests.
Every release preserves or extends it:

- **Golden fixtures:** each new construct asserts counts, exact graph edges
  (`required`/`forbidden`), and source spans (`sourced`).
- **Export-parity fixtures (new):** for each construct, `toMermaid` and
  `toDrawio` are structurally equivalent and the draw.io XML is well formed —
  mirroring the existing `draw.io XML remains well formed` test.
- **Fuzz invariants:** keep no-crash, determinism, source-span, and
  well-formed-output checks; add a **no-silent-drop invariant** (unconsumed
  token ranges appear as unresolved nodes or span-carrying diagnostics) and a
  draw.io vertex-metadata check.
- **UI tests:** findings-panel count matches the diagnostics list on a
  deliberately half-parsed input.
- **Release gate:** typecheck, build, `test:file`, the three served browser
  suites, `dist` currency, and the local-only HTTP check run on every push and
  must stay green.

## Metrics that matter

| Metric | Meaning |
|---|---|
| Fallback rate | `unknown`/`dynamic` nodes ÷ statements on the fixture corpus |
| Edge-fixture pass rate | required/forbidden wire assertions passing |
| Unconsumed-token rate | `remaining / totalTokens` across the corpus |
| Diagnostic-to-span ratio | share of diagnostics carrying a source span (target 100 %) |
| Export-parity pass rate | graph fixtures whose Mermaid and draw.io outputs agree and are well formed |
| Export traceability rate | exported draw.io vertices carrying source-span metadata |
| Fixture corpus size | golden, fuzz, and UI counts |

A release that raises coverage but lowers the edge-fixture pass rate has
reduced accuracy and does not ship — the same applies on the export side when
a construct ships without an export-parity fixture.

## Non-goals

- **Compiler-grade parsing.** ProcFlow is heuristic; full grammar compliance is
  out of scope. The roadmap closes the highest-impact gaps and reports the
  rest.
- **Dynamic SQL resolution.** `EXEC(@sql)`, `sp_executesql`, and PL/pgSQL
  `EXECUTE` stay opaque by design — guesses are worse than an explicit opaque
  node.
- **Executing SQL or connecting to a database.** The browser-only, local-only
  security model is unchanged.
- **Cosmetic layout polish.** Purely aesthetic work is out of scope; layout
  work that *prevents the logic flow from being misread* is in scope (F).

## How to contribute

- Add a failing-before/passing-after fixture per item; prefer graph-edge
  assertions over counts.
- Add the matching export-parity fixture for any new node class or edge type.
- Run typecheck, build, `test:file`, and the relevant served suites before
  opening a pull request.
- Commit the generated `dist/` files; keep the Mermaid checksum, the local-only
  check, and the `dist` currency check green.