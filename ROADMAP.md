# proc>flow Roadmap — Diagram Accuracy

This roadmap has one goal: **diagrams that accurately represent the logic flow
of the SQL they are given.** Because ProcFlow is a heuristic, browser-only
parser, accuracy is pursued on three fronts:

1. **Resolve more SQL correctly** — turn `Unresolved SQL` nodes, misplaced
   edges, and silently dropped branches into correct diagrams.
2. **Report what cannot be resolved** — confidence, coverage, and diagnostics
   granular enough that a reviewer always knows what is verified vs estimated.
3. **Export with fidelity** — Mermaid and draw.io represent the analysis
   identically, keep node→source traceability, and use predictable layout so
   the logic flow remains readable within documented graph limits.

## Guiding principles

- **No silent drops.** Every token range must be attributed to a resolved
  construct, intentionally ignored syntax, or an unresolved/opaque region.
  Unattributed input becomes an unresolved node plus a diagnostic.
- **Every source-derived node is traceable.** Source-derived nodes carry one or
  more valid spans. Generated nodes are explicitly marked as synthetic, and
  external nodes retain their complete object identity and reference spans.
  This provenance survives in exported files, not just the live diagram.
- **One analysis, one story.** Mermaid and draw.io are two renderings of one
  semantic `Graph`; they must never disagree about nodes, edges, labels, or
  edge meaning. Renderer-specific styles come from one canonical mapping.
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
       └── token attribution ──┘        └─ semantic Graph ─┘
```

| Stage | Where accuracy is lost | Fixed by |
|---|---|---|
| Semantic foundation (`types.d.ts`, all analysis stages) | Query references lose spans; edge meaning is encoded as presentation style; synthetic and source-derived nodes are not distinguished; coverage cannot detect internally ignored tokens | P |
| Lexical & boundaries (`tokenizer.ts`, `dialects.ts`) | Parens-only balance checks; statement splits rely on newline + `HARD`/`SOFT` keywords (`newStatementHere`); narrow number lexing; keyword-count dialect detection; `findBody` edge cases | A |
| Procedural parsing (`dialects.ts`) | `IF` single-statement vs block ambiguity; existing label-scoped loop control lacks complete invalid/unresolved-target reporting and source provenance; cursor queries are not represented consistently in query graphs; DB2 `ATOMIC` rollback is not modelled; fixed `summarise` label set; fallback to `unknown` nodes | B |
| Query lineage (`lineage.ts`, `ir.ts`) | Comma-separated sources dropped; `APPLY`/`LATERAL`/tabular functions incomplete; `UPDATE…FROM`/`DELETE…USING`/`MERGE…USING` reads inconsistent; recursive CTEs unmarked; derived-table inner sources not plotted; object-level only | C; v1.10–v1.11 for columns |
| Graph & estate (`ir.ts`) | No temp-table data flow; lightweight synonym/linked-server/cross-db resolution; missing transaction edge cases (`XACT_ABORT` in `CATCH`, savepoint-only recovery) | D; v1.9 for catalogue resolution |
| Export (`exporters.ts`) | Traceability lost on export; style parity implicit and untested; no data-flow edge style; naive BFS layout; `\u0001` text sentinel | F |
| Confidence & diagnostics (`ir.ts`, `app.ts`) | Whole-document confidence number; token-count coverage; diagnostics not span-attached for every approximation | E |

## Workstreams

### P. Semantic and provenance foundation (`types.d.ts`, analysis stages)

**Goal:** make accuracy, uncertainty, and export parity explicit in the model
before expanding parser coverage.

- Replace string-only query references with structured references containing
  object name, source span, role (`read`/`write`/`call`/`produce`), and
  resolution (`exact`/`heuristic`/`opaque`).
- Add semantic edge kinds (`control`, `exception`, `data`, `dependency`,
  `call`) to `GraphEdge`; exporters derive presentation style from the kind.
- Add node provenance (`source`, `external`, or `synthetic`) and require one or
  more valid spans on source-derived and external nodes. Synthetic nodes carry
  a reason; external nodes keep their complete identifier and later their
  catalogue identity. Aggregated nodes retain every contributing reference
  span rather than an arbitrary first occurrence.
- Record token attribution through tokenization and parsing. Each body token
  belongs to a resolved construct, deliberately ignored syntax, or an
  unresolved/opaque region. Ignored attribution names an allowlisted syntax
  category; it is never a generic escape hatch.
- Separate reviewer-facing diagnostics (`error`/`warning`) from informational
  construct annotations. Give diagnostics an explicit `document` or `region`
  scope.

**Acceptance:** existing diagrams remain structurally unchanged except for
new semantic metadata; every edge has a recognised kind; every source-derived
or external node has valid spans; every synthetic node declares its origin;
curated fixtures account for every body token; deliberately unattributed input
creates an unresolved node and a region-scoped diagnostic.

### A. Statement-boundary hardening (`tokenizer.ts`, `dialects.ts`)

**Goal:** statement splitting is robust without depending on newline position.

- Balance diagnostics for brackets and `BEGIN`/`END` pairing.
- Semicolons are authoritative boundaries when present. When a dialect permits
  omitted semicolons, use dialect-aware statement grammar and control
  keywords; newline is only a low-priority recovery hint. Preserve the valid
  semicolon-free behaviour covered by `p31`.
- Number lexing: `0x` hex, PostgreSQL `1_000` separators, `1.`/`.5` forms.
- `dialect_ambiguous` guardrail on low-confidence detection ties.
- `findBody` hardening: `CREATE VIEW … WITH`, `ALTER` headers, multi-object
  scripts without `GO`.

**Acceptance:** all existing `tsql-fixtures.ts` cases pass unchanged; new
fixtures assert exact statement ranges per item; neither tail-unconsumed nor
internally unattributed token rates increase.

### B. Procedural parsing completeness (`dialects.ts`)

**Goal:** resolve more real-world control flow; label what stays unresolved.

- Mixed one-line and block `IF`/`WHILE` parse to one AST.
- Harden the existing labelled loop-control and `GOTO` support: validate label
  scope and target kind, carry source spans, and preserve correct nested-loop
  behaviour. Unresolved labels get a `goto_unresolved` diagnostic and an
  explicit "unresolved label" node.
- Represent the query behind DB2 `FOR` cursors and T-SQL `DECLARE … CURSOR`
  consistently in query graphs, while preserving the existing object-level
  cursor read extraction.
- DB2 `ATOMIC` block rollback scope in the graph.
- Extended `summarise` label set (`GRANT`, `WAITFOR`, `KILL`, …).

**Acceptance:** new graph-edge fixtures per construct (the
`tests/dialects/*.ts` pattern), including invalid and unresolved targets;
existing labelled-loop, `GOTO`, and cursor-read fixtures remain green;
`unknown`-node fallback rate stays flat or drops.

### C. Query lineage accuracy (`lineage.ts`, `ir.ts`)

**Goal:** the query diagram reports every object a query reads, joins, or
produces.

- Detect comma-separated sources in `refsIn` (`FROM a, b` wires both `a` + `b`).
- `APPLY`/`LATERAL`/tabular functions (`UNNEST`, `XMLTABLE`, `JSON_TABLE`,
  `GENERATE_SERIES`, …) as structured source references or documented opaque
  references.
- Read extraction from `UPDATE…FROM`, `DELETE…USING`, `MERGE…USING`.
- Mark recursive CTEs in graph metadata. A valid, resolved recursive CTE is an
  informational annotation, not a warning; emit a diagnostic only when its
  recursion or source resolution is approximate.
- Wire derived-table/subquery inner sources into the query graph.

**Acceptance:** new query fixtures assert exact structured reference lists
(name, span, role, resolution) and semantic edges; existing query fixtures
(p24–p26, p37–p42, view/CTE cases) remain green. Any intentional correction
to an existing golden is isolated and reviewed as an accuracy change.

### D. Data-flow and dependency accuracy (`ir.ts`)

**Goal:** show how the steps of a procedure actually feed one another.

- Temporary-table producer→consumer edges (`SELECT … INTO #stage` → later
  `#stage` consumers) with semantic `data` edge kinds — the largest single
  readability win for procedures. Multiple producers and branch merges remain
  conservative when a unique reaching definition cannot be proven.
- Conservative, labelled external nodes: unknown three-/four-part names render
  as `external: [server].[db].[schema].[obj]`, not a bare last-part match.
- Transaction edge cases: `SET XACT_ABORT` inside `CATCH`, savepoint-only
  recovery, DB2 `ATOMIC` rollback scopes.

**Acceptance:** new temp-table and external-node fixtures; existing
transaction fixtures (XACT_STATE, @@TRANCOUNT, savepoints) remain green;
unaffected outputs remain byte-identical, while deliberate corrections to
known inaccurate goldens are reviewed and documented.

### E. Confidence and diagnostics granularity (`ir.ts`, `app.ts`)

**Goal:** the reviewer can always tell which part of the diagram is estimated.

- Region-scoped, span-attached diagnostics for every approximate resolution
  (dynamic SQL already does this; extend to opaque table expressions,
  partially resolved `APPLY`, uncertain recursion, and unresolved labels).
  Document-scoped diagnostics such as dialect ambiguity are explicitly marked
  and do not receive artificial one-character spans.
- Informational construct annotations, such as a correctly resolved recursive
  CTE, remain separate from warnings and do not inflate the findings count.
- Construct-coverage statistic (branches, loops, handlers, CTEs, source refs)
  alongside token attribution. Publish both the number of constructs detected
  and the number resolved/opaque so the denominator is inspectable.
- Versioned, documented confidence formula derived from per-region signals,
  keeping a single headline number in the UI. Coverage alone never increases
  confidence without a corresponding correctness assertion.

**Acceptance:** golden tests assert the new diagnostic codes; UI tests assert
the construct-coverage display and keep informational annotations out of the
findings count; every region-scoped diagnostic has a valid span; every
document-scoped diagnostic declares its scope; existing `coverage-val` UI
assertions still pass.

### F. Export fidelity (`exporters.ts`)

**Goal:** exports preserve analysis accuracy, traceability, and readable
layout.

- Preserve traceability: `node.sources`/`objectId` as metadata on `.drawio`
  vertices; source-spans and provenance map in a Mermaid `%%` comment block.
  Synthetic nodes export their origin instead of a fabricated source span.
- Canonical node-class→shape/style and semantic edge-kind→style mapping shared
  by both exporters, with an export-parity fixture per construct (same nodes,
  edges, labels, and meaning; draw.io XML well formed).
- Distinct data-flow edge style in both exporters, derived from the `data` edge
  kind rather than stored as semantic state in a presentation string.
- Replace naive `layoutDrawio` BFS with a layered, crossing-reducing,
  data-flow-aware layout. Define deterministic node positions and, where
  crossing assertions require them, explicit edge waypoints. Prioritise a
  monotonic control-flow spine and route data-flow edges around it where the
  graph permits.
- Replace the `\u0001` text sentinel with structured label lines before adding
  column- and report-level labels.
- Keep exporters in lockstep with every new node class or semantic edge kind
  from P and A–E.

**Acceptance:** export-parity fixture per construct; `.drawio` round-trips
with metadata intact; deterministic layout fixtures assert no node overlaps,
a monotonic control-flow spine, readable label bounds, and a documented
crossing budget on named graph classes and size limits. Zero crossings are not
claimed for arbitrary or non-planar graphs.

## Release plan — v1.1.0 through v2.0.0

Each release is capability-based and shippable on its own; version numbers do
not imply a calendar commitment. The high-risk layout and column-lineage work
is deliberately split across releases. README post-v1.0.0 items are scheduled:
**item 8 → v1.1.0, item 7 → v1.8.0, item 5 → v1.9.0, item 6 →
v1.11.0, item 4 → v1.12.0.**

| Release | Theme | Ships |
|---|---|---|
| v1.1.0 | Trustworthy semantic foundation | P; README 8; F metadata + canonical rendering contract |
| v1.2.0 | Trust statement boundaries | A; F parity; E boundary diagnostics |
| v1.3.0 | Trust procedural control flow | B; F parity; E procedural diagnostics |
| v1.4.0 | Report every object a query touches | C; F parity for query graphs; E query diagnostics/annotations |
| v1.5.0 | Data flow and internal resilience | D; F data-flow rendering; E construct coverage |
| v1.6.0 | Honest measurement | E confidence re-score; fixture-corpus metrics publishing |
| v1.7.0 | Clear deterministic exports | F layout and round-trip completion |
| v1.8.0 | Usable local workspace | README 7 (optional persistence + dependency filtering) |
| v1.9.0 | Resolve by catalogue | README 5; E catalogue diagnostics |
| v1.10.0 | Column lineage foundations | scopes, bindings, projections, and safe ambiguity |
| v1.11.0 | Column lineage pipelines | README 6; temp/inter-object column flow; F column export |
| v1.12.0 | Report import | README 4 (RDL import + dataset linking); E report diagnostics |
| v1.13.0 | Report intelligence | report → dataset → object → column views; F report export |
| v1.14.0 | Scale and convergence | large-graph layout; full regression; metrics finalization |
| v2.0.0 | Final convergence | accuracy contract; README + release notes; all fixtures green |

### v1.1.0 — Trustworthy semantic foundation

- **Ships:** Workstream P in full; README item 8 (separate graph,
  transaction, query-reference, and estate internals without changing verified
  v1.0.0 behaviour); the metadata and canonical-rendering foundation from F.
- **Deferred:** parser/lineage expansion, data flow, confidence re-score, and
  layout replacement.
- **Exit criteria:** the v1.0.0 fixture corpus remains structurally unchanged
  except for semantic metadata; every edge has a recognised kind; every node
  declares source, external, or synthetic provenance; source-derived and
  external nodes and structured references carry valid spans; curated fixtures achieve
  complete token attribution; Mermaid and draw.io metadata round-trip; full CI
  gate green.

### v1.2.0 — Trust statement boundaries

- **Ships:** Workstream A in full; F export parity for any boundary-driven
  graph changes; E boundary diagnostics (`dialect_ambiguous`, bracket/block
  balance) with correct document/region scope.
- **Deferred:** B, C, D, confidence re-score, and layout rewrite.
- **Exit criteria:** exact statement-range fixtures cover terminated and valid
  unterminated statements for every dialect; semicolon-free T-SQL remains
  supported; `findBody` and multi-object fixtures cover the new headers;
  tail-unconsumed and unattributed-token rates stay flat or drop; full CI gate
  green.

### v1.3.0 — Trust procedural control flow

- **Ships:** Workstream B in full; F export parity for every new procedural
  construct; E procedural diagnostics such as `goto_unresolved` with correct
  document/region scope.
- **Deferred:** C, D, confidence re-score, layout, catalogue, and columns.
- **Exit criteria:** graph-edge fixtures cover mixed `IF`/`WHILE`, valid and
  invalid labelled control, cursor query bodies, and DB2 `ATOMIC`; existing
  labelled-loop, `GOTO`, and cursor-read fixtures remain green; unattributed-
  token and `unknown` fallback rates stay flat or drop; full CI gate green.

### v1.4.0 — Report every object a query touches

- **Ships:** Workstream C in full; F export parity for query graphs; E
  diagnostics and informational annotations required by the new constructs.
- **Deferred:** D, confidence re-score, and layout rewrite.
- **Exit criteria:** structured-reference fixtures assert exact names, spans,
  roles, and resolution status for comma, `APPLY`, `USING`, `MERGE`, recursive
  CTE, and derived-table cases; existing query fixtures remain green;
  export-parity fixture per construct; `.drawio` round-trips with provenance;
  full CI gate green.

### v1.5.0 — Data flow and internal resilience

- **Ships:** Workstream D in full; F data-flow rendering in both exporters; E
  construct-coverage statistic + UI.
- **Deferred:** confidence re-score, general layout replacement, persistence,
  catalogue, and columns.
- **Exit criteria:** temp-table producer→consumer fixtures use semantic `data`
  edges; ambiguous branch merges remain explicitly unresolved; external-node
  fixtures preserve complete names; existing transaction fixtures remain
  green; construct coverage exposes detected/resolved/opaque counts; full CI
  gate green.

### v1.6.0 — Honest measurement

- **Ships:** E confidence re-score in full: per-region signals, a versioned
  formula, one headline number, and `data-band` derived from the same formula.
  Fixture-corpus metric publishing begins as a CI artifact or checked-in
  snapshot; no user inputs or runtime telemetry are collected.
- **Deferred:** layout replacement, persistence, catalogue, and columns.
- **Exit criteria:** golden fixtures assert the confidence formula and signal
  contributions; document-scoped findings do not fabricate spans;
  informational annotations do not inflate warning counts; metric generation
  is deterministic and fixture-only; full CI gate green.

### v1.7.0 — Clear deterministic exports

- **Ships:** core Workstream F for the existing object, control, and data graph
  classes, including the `layoutDrawio` replacement, explicit provenance
  metadata, canonical renderer mapping, structured labels, and deterministic
  routing information needed by layout tests.
- **Deferred:** persistence, catalogue, columns, and RDL.
- **Exit criteria:** `.drawio` and Mermaid parity/round-trip fixtures pass for
  every graph construct; named layout classes satisfy their overlap,
  monotonic-spine, label-bound, and crossing budgets at documented size limits;
  large or non-planar graphs degrade honestly without claiming zero crossings;
  full CI gate green.

### v1.8.0 — Usable local workspace

- **Ships:** README item 7 — optional local workspace persistence and
  dependency filtering. Persistence is opt-in, versioned, and exportable; the
  security/privacy documentation and local-only CI checks are updated in the
  same release.
- **Deferred:** catalogue, columns, and RDL.
- **Exit criteria:** save → reload produces identical analysis; schema-version
  migration and corrupt-state recovery fixtures pass; clearing a workspace is
  explicit and tested; filtering never changes the underlying analysis graph;
  full CI gate green including the extended local-only check.

### v1.9.0 — Resolve by catalogue

- **Ships:** README item 5 — catalogue metadata import (paste/import
  table/view/column catalogues); exact synonym, linked-server, and
  cross-database resolution replaces v1.5.0's external labels where catalogue
  evidence exists; E diagnostics for partial or conflicting catalogue data.
- **Deferred:** column flow and RDL.
- **Exit criteria:** catalogue fixtures assert exact identity and resolution
  status; external-node fixtures become verified only where the catalogue
  proves the match; conflicting or missing metadata stays conservative and
  region-scoped; full CI gate green.

### v1.10.0 — Column lineage foundations

- **Ships:** column scopes and bindings for qualified references, aliases,
  projections, CTEs, derived tables, and catalogue-backed wildcard expansion;
  expression-level provenance within one query statement; explicit ambiguous
  and opaque column references.
- **Deferred:** multi-statement temporary-table flow, inter-object column flow,
  final column export contract, and RDL.
- **Exit criteria:** single-statement column fixtures assert exact input→output
  mappings and spans; ambiguity never invents a column edge; unsupported
  expressions become opaque with region-scoped diagnostics; object-level
  fixtures remain green; full CI gate green.

### v1.11.0 — Column lineage pipelines

- **Ships:** README item 6 in full — column-flow edges through CTEs, views,
  temporary tables, transformations, and catalogue-resolved object boundaries;
  F column metadata and column-flow export styles; E column-resolution signals;
  the layout engine's documented column-graph class.
- **Deferred:** RDL.
- **Exit criteria:** end-to-end fixtures trace `SELECT col INTO #t` through
  transformations to outputs; ambiguous reaching definitions remain opaque;
  column export parity and `.drawio` round-trip preserve metadata; column
  layouts meet their bounded fixture budgets; full CI gate green.

### v1.12.0 — Report import

- **Ships:** README item 4 — SSRS/RDL import: parse report definitions and link
  reports to datasets and each dataset to its SQL analysis; E diagnostics for
  report- and dataset-parsing uncertainty.
- **Deferred:** combined report dependency views and report export (v1.13.0).
- **Exit criteria:** RDL fixtures link reports to datasets and preserve XML
  source locations where available; embedded, shared, and unresolved datasets
  are distinguished; parser uncertainty is region- or document-scoped as
  appropriate; full CI gate green.

### v1.13.0 — Report intelligence

- **Ships:** report → dataset → object → column dependency views built on the
  v1.9.0 catalogue and v1.11.0 column contract; F export fidelity for report
  graphs.
- **Deferred:** large-graph convergence (v1.14.0).
- **Exit criteria:** report fixtures assert the complete dependency chain;
  report export parity and `.drawio` round-trip preserve report/dataset source
  identity; filtering affects presentation only; full CI gate green.

### v1.14.0 — Scale and convergence

- **Ships:** bounded layout support for large dependency, column, and report
  graph classes; full regression of v1.0.0–v1.13.0 fixtures; finalization and
  trending of all fixture-corpus metrics in
  ["Metrics that matter"](#metrics-that-matter).
- **Deferred:** final accuracy contract (v2.0.0).
- **Exit criteria:** documented large-graph fixture budgets pass; metric trends
  contain no unexplained regression; full regression and CI gate green.

### v2.0.0 — Final convergence

- **Ships:** the v2.0.0 accuracy contract; README and release notes updated to
  the contract; final verification that workstreams P and A–F and every README
  post-v1.0.0 item scheduled here are delivered.
- **Deferred:** nothing — this is the convergence release.
- **Exit criteria:** all unaffected v1.0.0–v1.14.0 fixtures pass unchanged;
  intentional corrected goldens are documented with their accuracy rationale;
  every roadmap item is delivered and documented; full CI gate green.

## Test and verification strategy

The v1.0.0 baseline is 131 golden tests, 400 fuzz cases, and 12 UI tests.
Every release preserves or extends it:

- **Golden fixtures:** each new construct asserts counts, structured
  references, exact semantic graph edges (`required`/`forbidden`, including
  edge kind), source spans, and node provenance.
- **Export-parity fixtures (new):** for each construct, `toMermaid` and
  `toDrawio` are parsed back to semantic manifests and compared with the input
  `Graph`; draw.io XML remains well formed and metadata survives round-trip.
- **Fuzz invariants:** keep no-crash, determinism, source-span, and
  well-formed-output checks; add a **token-attribution invariant** in which
  every body token is resolved, deliberately ignored, or assigned to an
  unresolved/opaque region. Every unresolved region must have a matching node
  and region-scoped diagnostic. Also assert recognised edge kinds and exported
  vertex provenance.
- **Layout fixtures:** test named graph classes at documented size/label
  limits. Assert deterministic positions, no node overlaps, monotonic control
  spines, readable label bounds, and per-class crossing budgets.
- **UI tests:** findings-panel count matches warning/error diagnostics on a
  deliberately half-parsed input; informational annotations are displayed
  separately and do not inflate the count.
- **Regression policy:** unaffected fixture output remains unchanged.
  Correcting a known inaccurate golden is allowed only with a focused
  failing-before fixture and a documented rationale in the change.
- **Release gate:** typecheck, build, `test:file`, the three served browser
  suites, `dist` currency, and the local-only HTTP check run on every push and
  must stay green.

## Metrics that matter

| Metric | Meaning |
|---|---|
| Attribution rate | body tokens assigned to resolved, deliberately ignored, unresolved, or opaque regions (target 100 %) |
| Unresolved-token rate | tokens attributed to unresolved regions ÷ body tokens on the fixture corpus |
| Tail-unconsumed rate | tokens remaining after parser termination ÷ body tokens; retained as a narrower failure signal |
| Fallback rate | unresolved source-derived nodes ÷ source-derived statement regions |
| Opaque dynamic rate | intentionally opaque dynamic-SQL regions; reported separately, not treated as a parser regression |
| Reference-fixture pass rate | exact structured-reference assertions passing |
| Edge-fixture pass rate | required/forbidden semantic-edge assertions passing |
| Semantic-edge coverage | graph edges carrying a recognised semantic kind (target 100 %) |
| Region diagnostic-to-span ratio | region-scoped diagnostics carrying a valid source span (target 100 %) |
| Provenance rate | nodes correctly classified as source-derived, external, or synthetic (target 100 %) |
| Export-parity pass rate | graph fixtures whose Mermaid and draw.io semantic manifests match and are well formed |
| Export traceability rate | exported source-derived/external vertices carrying spans and object identity, and synthetic vertices carrying origin metadata |
| Layout-budget pass rate | named layout fixtures meeting their overlap, spine, label, and crossing budgets |
| Fixture corpus size | golden, fuzz, and UI counts |

A release that raises attribution or construct coverage but lowers reference-
or edge-fixture pass rates has reduced accuracy and does not ship. The same
applies on the export side when a construct ships without an export-parity
fixture. Published metrics are derived only from the checked-in anonymised
fixture corpus in CI; ProcFlow does not collect runtime telemetry or user SQL.

## Non-goals

- **Compiler-grade parsing.** ProcFlow is heuristic; full grammar compliance is
  out of scope. The roadmap closes the highest-impact gaps and reports the
  rest.
- **Dynamic SQL resolution.** `EXEC(@sql)`, `sp_executesql`, and PL/pgSQL
  `EXECUTE` stay opaque by design — guesses are worse than an explicit opaque
  node.
- **Executing SQL or connecting to a database.** The browser-only, local-only
  security model is unchanged.
- **Runtime analytics or user-SQL telemetry.** Published accuracy metrics come
  from the checked-in fixture corpus, never from user workspaces or imports.
- **Cosmetic layout polish.** Purely aesthetic work is out of scope; layout
  work that *prevents the logic flow from being misread* is in scope (F).
- **Zero crossings for every graph.** Arbitrary dependency graphs may be
  non-planar. The layout contract is deterministic, bounded, and explicit
  about graph classes where crossings remain.

## How to contribute

- Add a failing-before/passing-after fixture per item; prefer graph-edge
  assertions over counts.
- Add the matching provenance and export-parity fixture for any new node class
  or semantic edge kind.
- Treat a changed existing golden as a reviewed accuracy correction, not a
  routine fixture update; document why the previous graph was wrong.
- Run typecheck, build, `test:file`, and the relevant served suites before
  opening a pull request.
- Commit the generated `dist/` files; keep the Mermaid checksum, the local-only
  check, and the `dist` currency check green.
