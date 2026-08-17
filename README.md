<p align="center">
  <img src="assets/procflow-logo.svg"
       alt="proc&gt;flow — SQL logic and dependency visualiser"
       width="760">
</p>

<p align="center"><strong>Understand complicated SQL without tracing every branch by hand.</strong></p>

<p align="center">
  <a href="https://github.com/ikelaiah/ProcFlow/actions/workflows/correctness.yml">
    <img src="https://github.com/ikelaiah/ProcFlow/actions/workflows/correctness.yml/badge.svg?branch=main"
         alt="Correctness workflow status">
  </a>
  <a href="https://github.com/ikelaiah/ProcFlow/releases/latest">
    <img src="https://img.shields.io/github/v/release/ikelaiah/ProcFlow?display_name=tag&amp;sort=semver"
         alt="Latest release">
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/github/license/ikelaiah/ProcFlow?color=54c39b"
         alt="MIT license">
  </a>
  <a href="#security-and-privacy">
    <img src="https://img.shields.io/badge/runtime-local--only-54c39b"
         alt="Runtime: local only">
  </a>
</p>

<hr>

`proc>flow` turns complicated SQL into diagrams you can actually follow. Paste
SQL — or import a folder of files — and see:

- how a procedure, function, trigger, view, or query works internally; and
- how database objects read, write, and call one another.

It runs entirely in your browser, straight from the local filesystem: no
installation, no database connection, no backend, no sign-in.

> [!IMPORTANT]
> ProcFlow uses a heuristic parser rather than a database engine's compiler.
> Treat diagrams as investigation aids. Check important findings against the
> source SQL and the target database.

**Release notes:** [v1.12.0](docs/RELEASE_NOTE_v1.12.0.md) · earlier releases
live in [`docs/`](docs/) alongside the per-release PR notes.

## Start here

| I want to… | Go to |
|---|---|
| Open ProcFlow and try it now | [60-second quick start](#60-second-quick-start) |
| Review a stored procedure, function, or trigger | [Workflow for DBAs](#workflow-for-database-administrators) |
| Understand a report or dataset query | [Workflow for SQL report engineers](#workflow-for-sql-report-engineers) |
| Understand confidence, coverage, and warnings | [Reading the analysis safely](#reading-the-analysis-safely) |
| Check privacy or prepare a security review | [Security and privacy](#security-and-privacy) |
| Build, test, or change the project | [Developer guide](#developer-guide) |
| Prepare a release | [Release checklist](#release-checklist) |

## 60-second quick start

1. Download the `v1.12.0` archive from
   [GitHub Releases](https://github.com/ikelaiah/ProcFlow/releases) or clone
   this repository.
2. Extract the complete archive — `index.html`, `styles.css`, `dist/`, and
   `vendor/` must stay together.
3. Open `index.html` in a recent Chrome, Edge, Firefox, or Chromium browser.
4. Choose one input: press **Load sample**, paste SQL into **SQL source**, or
   press **Import SQL files** and select one or more files.
5. Press **Refresh** or use `Ctrl+Enter` (`Cmd+Enter` on macOS).

No `npm install`, local server, database, or internet connection is required
for normal use. If the diagram does not render, the archive was probably
extracted incompletely — an `index.html` without its sibling `dist/` and
`vendor/` directories will not work.

## Workflow for database administrators

Use ProcFlow to shorten the first pass through unfamiliar routines and change
reviews.

1. Import the relevant `.sql`, `.ddl`, or `.txt` files.
2. Set **Scope** to **Object dependencies** to see routine calls and table
   reads/writes across the imported files.
3. Select a known object in the diagram or use the **Object** selector.
4. Set **Scope** to **Internal logic**.
5. Use **View → Control flow** for branches, loops, transactions, exits, and
   error paths.
6. Check **Confidence**, **Coverage**, and **Diagnostics** before relying on the
   chart.
7. Click a source-aware diagram node to select its SQL in the editor.
8. Use **Export** to save SVG or editable draw.io XML when the diagram is ready
   to share.

Useful DBA review questions include: which tables are read or changed; which
routines are called; can execution exit before a commit or final result; where
can an exception be handled, rethrown, or terminate work; does transaction
state affect the available recovery path; and is any dynamic SQL hiding
behavior from static analysis?

When automatic dialect detection is uncertain, select the dialect explicitly
and refresh the analysis.

## Workflow for SQL report engineers

Use ProcFlow to understand report datasets, extracts, views, and large SELECT
statements.

1. Paste the dataset query or import its SQL file.
2. Leave **View** on **Auto**, or choose **Query structure** explicitly.
3. Review CTEs, source tables, explicit joins, unions, subqueries, filtering,
   and grouping.
4. Turn **Source tables** on or off to adjust the amount of detail.
5. For several views or queries, use **Object dependencies** to see shared
   sources and upstream objects.
6. Check **Coverage** and **Diagnostics**, especially for vendor-specific table
   expressions or comma-separated sources.
7. Export the result as SVG or draw.io when documenting a report or handing
   analysis to another engineer.

ProcFlow imports SQL text directly, and since v1.12.0 it also imports
SSRS/RDL report definitions: paste or import an `.rdl` file, and the
**Reports** menu links the report to its datasets, distinguishes embedded,
shared, and unresolved datasets, and opens each embedded dataset's query for
analysis. Report dependency views and report export arrive with v1.13.0.

## What ProcFlow can show

### Internal control flow

- `IF`, `ELSE`, and `CASE` decisions
- loops, loop exits, and early returns
- labelled loop-control and `GOTO`, with source span selection and explicit
  "Unresolved label" nodes for missing targets
- cursor operations and the query behind a cursor
- statements and result sets
- procedure and function calls
- table reads and writes
- temporary-table transformations, with producer→consumer data-flow edges on
  provably linear paths
- transactions and savepoints
- exception handling and T-SQL `TRY`/`CATCH`
- dynamic SQL as an explicit opaque step

### Query structure

- common table expressions (including recursive CTEs, marked and annotated)
- source tables and views, including comma-separated `FROM` lists
- `CROSS`/`OUTER APPLY` and tabular functions (`UNNEST`, `XMLTABLE`,
  `JSON_TABLE`, `GENERATE_SERIES`) as source references
- derived-table/subquery inner sources
- `MERGE … USING` and `DELETE … USING` read sources
- explicit joins
- unions
- subqueries
- filtering
- grouping

### Object dependencies

- procedure or function → called routine
- view or query → source object
- object → table read
- object → table write

Known imported objects are linked — selecting one opens its internal logic.
With a catalogue loaded, references the catalogue proves (an exact full-name
match, or an explicit synonym) resolve to their canonical identity instead of a
conservative label. Unmatched three-/four-part names keep their complete
identity as `external: [server].[database].[schema].[object]` nodes rather
than collapsing to a bare last-part match.

## Reading the analysis safely

The analysis panel gives four signals for how much to trust a diagram:

- **Confidence** — a single headline number from a versioned formula (v1.6.0)
  built on per-region signals: dialect certainty × the token-weighted quality of
  each statement region (resolved / approximate / opaque / error) × a coverage
  factor. The health band (`high`/`medium`/`low`) comes from the same formula,
  so it can never contradict the percentage. Coverage alone never raises
  confidence: an object whose tokens all land in opaque dynamic-SQL regions
  stays at 40 % even at 100 % coverage.
- **Coverage** — the percentage of body tokens consumed by the parser.
- **Diagnostics** — uncertain dialects, balance errors, missing block
  terminators, unconsumed input, invalid actions, opaque dynamic SQL, opaque
  table expressions, heuristic `APPLY` targets, ambiguous and opaque column
  references (v1.10.0), opaque column-flow reaching definitions (v1.11.0),
  catalogue problems (malformed or conflicting data, unproven partial matches),
  and report/dataset parsing uncertainty (v1.12.0). Informational annotations
  (for example a correctly resolved recursive CTE) are shown separately and
  never inflate the findings count. Document-scoped findings such as dialect
  ambiguity carry no fabricated source span.
- **Constructs** — how many branches, loops, handlers, CTEs, source
  references, temp-flow links, and column-flow objects and edges were detected,
  resolved, or left opaque.

Rule of thumb:

- High confidence and complete coverage: review the chart, then verify material
  findings in the SQL.
- Reduced confidence: select the dialect manually and inspect the diagnostics.
- Incomplete coverage: treat the unresolved source region as a review item.
- Dynamic SQL warning: review the generated SQL separately; its internal reads,
  writes, calls, and branches cannot be inferred safely.

Input the parser cannot consume is represented as an unresolved node rather
than silently disappearing from the diagram.

## Supported SQL

ProcFlow v1.12.0 recognises Microsoft T-SQL, IBM DB2 SQL PL, PostgreSQL
PL/pgSQL, and SQLite — covering procedures, functions, triggers, views, plain
SQL statements, report dataset queries, and multi-object scripts.

Dialect coverage highlights:

- **T-SQL:** mixed one-line and block `IF`/`WHILE` control flow, labelled
  `GOTO` with source spans and an explicit "Unresolved label" node, cursor
  queries in the query graph, concise `GRANT`/`WAITFOR`/`KILL` labels,
  semicolon-free statements with grammar-driven boundaries, `TRY`/`CATCH`,
  `THROW`, `RAISERROR` severity, transaction depth and savepoints (including
  savepoint-only recovery in `CATCH`), `SET XACT_ABORT` annotation, invalid
  transaction-action termination, temporary-table producer→consumer data-flow
  edges, and column flow across statements through temp tables, views, CTEs,
  and catalogue-resolved boundaries (v1.11.0).
- **DB2 SQL PL:** mixed `THEN` and `BEGIN`/`END` `IF` forms, `BEGIN ATOMIC`
  rollback scope, labelled loop control and `LEAVE`/`ITERATE` target validation,
  `FOR … CURSOR FOR` queries in the query graph, scoped handlers, and
  `NOT FOUND` flow.
- **PL/pgSQL:** `EXCEPTION` condition matching, transactional exception scopes,
  rethrow propagation, and labelled loop-control target validation.
- **SQLite:** trigger `RAISE` actions, termination behavior, trigger `WHEN`,
  conditional `WHERE`, and searched `CASE` paths.

Across dialects, Query structure view reports every read source: a
comma-separated `FROM` list, an `APPLY` or tabular function, a `MERGE…USING` /
`DELETE…USING` source, a recursive CTE, and a derived-table inner table all
appear as source nodes.

Since v1.10.0, each query-bearing `SELECT` statement also gets column-level
analysis: qualified references, aliases, projections, CTE and derived-table
scopes, and catalogue-backed wildcard expansion produce exact input→output
column bindings with source spans. An unqualified reference that matches
several sources is reported as ambiguous and never invents a binding;
unsupported expressions become opaque with a region-scoped diagnostic.

Since v1.11.0, column lineage flows across statements as a pipeline:
`SELECT col INTO #t`, `INSERT … SELECT`, `CREATE TABLE`, and `UPDATE … SET`
transformations define an object's columns, later consumers bind back through
them, and each produced column is traced end-to-end to its original source
object — through temp tables, same-script views, catalogue-resolved object
boundaries, and CTE scopes. When a reaching definition is ambiguous (a
conditional write or a branch merge) the consumer stays explicitly opaque with
a region-scoped `column_flow_opaque` diagnostic, and no binding is invented.
The column-flow graph exports to Mermaid and draw.io with provenance metadata
and is laid out on its own documented `column` graph class. Interactive column
views remain scheduled for v1.13.0.

Since v1.12.0, SSRS/RDL report definitions can be imported: the **Reports**
menu parses a report definition, links the report to its datasets, and
distinguishes embedded (query text is in the report), shared (a reference to an
external shared dataset definition), and unresolved datasets. XML source
locations are preserved where element tags are locatable, and parser
uncertainty is scoped: malformed RDL or a missing `<Report>` root is a
document-scoped diagnostic, while an unresolved dataset is region-scoped at its
own element span. Selecting an embedded dataset in the Dataset picker loads and
analyses its query. Combined report dependency views and report export remain
scheduled for v1.13.0.

Detection is automatic and can be overridden from the **Dialect** selector.
When detection is uncertain and several dialects score equally, an explicit
`dialect_ambiguous` diagnostic is reported along with the usual
low-confidence warning.

Catalogue resolution (README item 5, delivered in v1.9.0) applies across
dialects: when a catalogue is loaded, object references the catalogue proves
are shown as verified identity instead of external labels. See
[Working with a catalogue](#working-with-a-catalogue).

## Importing SQL

**Import SQL files** accepts multiple `.sql`, `.ddl`, and `.txt` files. Files
are read into memory by the current browser tab; they are not uploaded and are
not persisted automatically.

Multi-object scripts are split into selectable objects. If the split cannot be
made confidently, ProcFlow keeps the input as one script and reports the
uncertainty.

## Working with reports

The **Reports** menu (v1.12.0) imports SSRS/RDL report definitions so each
report's datasets link to their SQL analysis.

- **Paste or import.** Type an RDL/XML report definition into the textarea (or
  press **Import file** for `.rdl`/`.xml` files) and press **Apply report**.
- **Dataset kinds.** Each dataset is **embedded** (its query text is in the
  report and is analysed), **shared** (a reference to an external shared
  dataset definition, so there is no SQL to analyse here), or **unresolved**
  (neither a query text nor a shared reference, so it cannot be linked).
- **Open a dataset.** The **Dataset** picker lists every dataset with its
  source kind; selecting an embedded dataset loads its query into the editor
  and runs the normal SQL analysis.
- **Honest diagnostics.** XML source locations are preserved where element
  tags are locatable. Malformed RDL or a missing `<Report>` root is a
  document-scoped diagnostic with no fabricated span; an unresolved dataset is
  a region-scoped diagnostic at its own element span. These findings appear in
  the Diagnostics panel alongside the SQL analysis.
- **Clear** removes the report. The report is an analysis input, so a saved
  workspace captures it and Restore reproduces an identical analysis.

## Working with a catalogue

The **Catalogue** menu imports table/view/column metadata so ProcFlow can
resolve object references to their exact identity instead of a conservative
`external:` label.

- **Paste or import.** Type a catalogue into the textarea (or press **Import
  file**) and press **Apply catalogue**. Two formats are accepted:
  - **JSON** — `{"objects":[{"name":"dbo.Student","kind":"TABLE",
    "synonyms":["student"]}], "columns":[{"table":"dbo.Student","name":"Id"}]}`
    (a bare array of objects or names also works);
  - **simple line format** — one object per line: `name KIND syn1, syn2` plus
    `COL table.column` column lines; `#` lines are comments.
- **Verified resolution.** Only exact full-name matches and explicit synonyms
  count as verified. In **Object dependencies** scope and the **Query
  structure** view, a verified reference renders as its canonical object name
  (no `external:` prefix) and carries the resolution as metadata on draw.io
  exports.
- **Conservative when uncertain.** A reference that only partially matches
  (for example a server prefix over a catalogued object) stays external and
  gets a region-scoped `catalogue_partial` diagnostic naming the unproven
  candidate. Duplicate or colliding catalogue entries produce a
  `catalogue_conflict` diagnostic and never invent a verification.
- **Clear** removes the catalogue; applying a different catalogue re-runs the
  current analysis. The catalogue is an analysis input, so a saved workspace
  captures it and Restore reproduces an identical analysis.

## Workspace

The **Workspace** menu keeps your work usable across sessions, entirely on your
terms:

- **Save to this browser** persists the current workspace (files, analysis
  options, and any applied catalogue or report text) to this browser's
  `localStorage`. This is strictly opt-in — nothing is written or restored on
  load.
- **Restore saved workspace** replays the saved files, options, catalogue, and
  report text into an identical analysis.
- **Export workspace file** / **Import workspace file** transfer a workspace as
  portable JSON.
- **Forget saved workspace** removes the local copy explicitly.

Saved workspaces are versioned (so future releases can migrate them) and, if
corrupt or unreadable, are recovered by starting fresh rather than crashing.

## Dependency filtering

In **Object dependencies** scope, the **Filter dependencies** menu offers
presentation-only filters over the estate diagram: show/hide **Reads**,
**Writes**, and **Calls** edges; show/hide **External objects** and **Temp
tables** nodes; and a **Focus** box that keeps an object and its direct
neighbours. Filtering derives a filtered view at render time and never changes
the underlying analysis graph, so confidence, coverage, diagnostics, and the
reported stats stay exactly as analysed.

## Exporting and sharing

The **Export** menu provides:

- **Copy Mermaid** — copy the generated Mermaid definition.
- **Copy narration prompt** — copy a prompt containing diagram structure and
  source SQL.
- **Save SVG** — download the rendered diagram.
- **Save draw.io** — download editable native `.drawio` XML, placed by a
  deterministic, data-flow-aware layered layout. Exporting the same SQL always
  produces the same coordinates, with temp-table data-flow edges routed in a
  dedicated lane.

The narration prompt is never submitted automatically. It reaches another
system only if a user pastes it there. Review organisational policy before
sharing confidential SQL.

draw.io is a trademark of draw.io AG. ProcFlow is not affiliated with or
endorsed by draw.io.

## Security and privacy

### Quick answers

| Question | ProcFlow v1.12.0 behavior |
|---|---|
| Is SQL uploaded? | No. Analysis and rendering happen in the browser tab. |
| Does it connect to a database? | No. There is no driver, connection string, or query execution. |
| Is there a backend or API? | No. It is a static HTML, CSS, and JavaScript application. |
| Is there analytics or telemetry? | No. |
| Is internet access required? | No for local or internally hosted use. |
| Are imported files uploaded? | No. The browser File API reads them into the current tab. |
| Is SQL retained after closing the tab? | No by default — no cookies, `sessionStorage`, IndexedDB, or `localStorage` writes on load. A workspace persists only when you explicitly choose **Save to this browser**. |
| Is a saved workspace stored on this computer? | Only if you choose **Save to this browser**: written to `localStorage`, local-only, versioned, exportable to JSON, and removable via **Forget saved workspace** or clearing site data. |
| Does ProcFlow write to the clipboard automatically? | No. Clipboard writes follow an explicit copy action. |
| Are exports local? | Yes. SVG and draw.io files are generated in memory and downloaded by the browser. |
| Does it call an AI service? | No. It can copy a narration prompt but never submits it. |

### Runtime files

The runtime application consists of:

```text
index.html
styles.css
dist/src/tokenizer.js
dist/src/catalogue.js
dist/src/dialects.js
dist/src/lineage.js
dist/src/ir.js
dist/src/columns.js
dist/src/columnflow.js
dist/src/report.js
dist/src/exporters.js
dist/src/workspace.js
dist/src/app.js
vendor/mermaid/mermaid.min.js
```

There is no application `fetch`, `XMLHttpRequest`, WebSocket, beacon, or other
network-submission code. The only bundled third-party runtime is the pinned
Mermaid 10.9.1 renderer. Its MIT licence is stored at
`vendor/mermaid/LICENSE`.

The opt-in persistence module (`dist/src/workspace.js`) is the only runtime
that touches browser storage, and it does so only through explicit
**Workspace** menu actions (Save / Restore / Forget) — never on load. Its
import/export uses the browser download API, which also requires an explicit
action. The catalogue module (`dist/src/catalogue.js`) and the report module
(`dist/src/report.js`) parse pasted or imported metadata/report definitions in
memory only; they never read or write storage.

The SHA-256 of `vendor/mermaid/mermaid.min.js` in v1.12.0 is:

```text
61B335A46DF05A7CE1C98378F60E5F3E77A7FB608A1056997E8A649304A936D6
```

The repository's `.gitattributes` preserves this vendored file byte-for-byte
so the release checksum remains reproducible across operating systems.

### Guidance for security review

1. Review and pin the `v1.12.0` tag or its exact commit.
2. Verify the vendored Mermaid checksum.
3. Review the runtime files listed above.
4. Open the reviewed files locally or serve them from an approved internal
   static host.
5. Keep browser extensions and developer tools within organisational policy.
6. Re-review runtime and dependency changes before upgrading.
7. Apply the organisation's Content Security Policy at the hosting layer when
   serving ProcFlow over HTTP.

If ProcFlow is served through GitHub Pages or another host, that host receives
ordinary web-request metadata while serving the static files. ProcFlow still
does not place entered SQL in those requests. Organisations that do not permit
public hosting should use the release files locally or on an internal static
server.

The primary deliberate data-release action is **Copy narration prompt**. It
places SQL and diagram structure on the clipboard. Users remain responsible for
where that information is pasted or saved.

No browser application can guarantee the security of the host computer,
browser, installed extensions, modified source files, or external destination.
ProcFlow's boundary is that its own application code performs analysis locally
and contains no automatic data-submission path.

## Known limitations

- Parsing is heuristic, not compiler-grade.
- Dynamic SQL is opaque by design.
- Statement boundaries no longer depend on newline position: semicolons are
  authoritative and omitted semicolons are split by control keywords and
  statement grammar. Exceptionally malformed batches can still produce imperfect
  splits.
- Column resolution is conservative: an ambiguous reaching definition stays
  opaque and is never resolved by invention. Interactive column views in the
  app are scheduled for v1.13.0.
- Some vendor-specific table expressions might not be detected.
- Temporary-table data flow is shown within one object; cross-object temp flow
  remains unresolved.
- Catalogue resolution is deliberately conservative: only exact full-name and
  explicit-synonym matches are verified. Suffix-only matches, unqualified names
  without a catalogue synonym, and unknown linked-server layouts stay external
  (with a `catalogue_partial` diagnostic where a plausible but unproven
  candidate exists) until the catalogue proves them.
- SSRS/RDL definitions are imported and linked to their datasets; shared and
  unresolved datasets stay explicit and are reported rather than guessed.
  Report dependency views and report export are scheduled for v1.13.0.
- draw.io layout is deterministic for the documented graph classes at
  documented size limits; very large or non-planar graphs are laid out without
  overlapping boxes and reported honestly rather than claimed crossing-free.

Always confirm critical dependencies, execution paths, transaction behavior,
and security conclusions against the original SQL and target database.

## Developer guide

### Prerequisites

- Node.js 22 is recommended and is the CI baseline.
- npm, included with Node.js.
- A recent Chrome, Edge, or Chromium browser for the local-file smoke test.
- Python 3 is optional and is used only for the simple manual test server shown
  below.

### First checkout

```text
git clone https://github.com/ikelaiah/ProcFlow.git
cd ProcFlow
npm ci
npm run typecheck
npm run build
npm run test:file
```

`npm run test:file` opens the real `index.html` through a `file://` URL in a
headless Chromium browser and verifies that the page and all local runtime
scripts initialise. The runner automatically looks for Chrome, Edge, or
Chromium. If the browser is installed in a non-standard location, set
`CHROME_PATH` to its executable.

### Source and generated files

Make source changes in `src/` or `tests/`. `npm run build` compiles TypeScript
into browser-ready JavaScript and source maps under `dist/`.

`dist/` is committed deliberately so an end user can open `index.html` without
installing a toolchain. After source changes:

```text
npm run typecheck
npm run build
git status --short
```

Commit the matching generated `dist/` files with their TypeScript sources.

### Full browser suites

Start a local static server from the repository root:

```text
python -m http.server 8000
```

Then open:

- `http://127.0.0.1:8000/tests/index.html` — golden parser, graph, dependency,
  and exporter tests
- `http://127.0.0.1:8000/tests/fuzz.html` — deterministic mutation and invariant
  tests
- `http://127.0.0.1:8000/tests/ui.html` — browser interaction and local-runtime
  tests

The v1.12.0 baseline is:

- 211 golden and boundary assertions
- 400 deterministic mutation cases
- 25 browser interaction tests
- 20 export-parity checks (10 fixtures × TD + LR), 11 layout-budget fixtures,
  and 100 % export-traceability on the export fixtures
- 14 workspace-persistence and dependency-filtering fixtures (save→reload
  identity, schema migration, corrupt recovery, explicit clear, non-mutating
  filters, and the report-definition round-trip)
- 13 catalogue fixtures (JSON and line import, synonym / linked-server /
  cross-database verification, conservative conflict and partial diagnostics,
  export metadata, workspace round-trip)
- 18 single-statement column-lineage fixtures (qualified references, aliases,
  projections, CTE and derived-table scopes, catalogue-backed wildcard
  expansion, ambiguous and opaque column references with exact spans)
- 15 column-flow pipeline fixtures (end-to-end `SELECT … INTO #t` traces
  through transformations to outputs, opaque ambiguous reaching definitions,
  same-script view and catalogue-boundary resolution, clean invariants, and
  export parity) plus 2 column layout-budget fixtures on the documented
  `column` graph class
- 12 report-import fixtures (report→dataset linking, embedded/shared/unresolved
  dataset distinction, XML source locations, and region/document-scoped parser
  diagnostics)

Fixture-corpus accuracy metrics (attribution, unresolved-token, tail-unconsumed,
fallback, opaque-dynamic, semantic-edge coverage, provenance,
region-diagnostic-to-span, export-parity, export-traceability, layout-budget,
workspace, catalogue, column, column-flow, and report pass-rate ratios) are
published from the checked-in golden corpus in
[docs/metrics-v1.12.0.json](docs/metrics-v1.12.0.json). Generation
is deterministic and fixture-only — no user inputs or runtime telemetry are
collected — and CI refuses to merge when the snapshot is stale. Regenerate with
`npm run metrics:write`.

GitHub Actions installs dependencies, type-checks, builds, verifies generated
files, runs the local-file smoke test (including the opt-in workspace
assertion), checks that the runtime remains local-only (no external URLs or
network APIs, and browser storage confined to the opt-in persistence module),
verifies the metric snapshot, and runs all three served browser suites on every
push and pull request.

### Project structure

```text
index.html
styles.css
README.md
ROADMAP.md
package.json
package-lock.json
tsconfig.json
.gitattributes
.github/
└── workflows/
    └── correctness.yml
assets/
└── procflow-logo.svg  # adaptive light/dark README wordmark
docs/
├── PR_NOTE_1.1.0.md
├── PR_NOTE_1.2.0.md
├── PR_NOTE_1.3.0.md
├── PR_NOTE_1.4.0.md
├── PR_NOTE_1.5.0.md
├── PR_NOTE_1.6.0.md
├── PR_NOTE_1.7.0.md
├── PR_NOTE_1.8.0.md
├── PR_NOTE_1.9.0.md
├── PR_NOTE_1.10.0.md
├── PR_NOTE_1.11.0.md
├── PR_NOTE_1.12.0.md
├── RELEASE_NOTE_1.1.0.md
├── RELEASE_NOTE_1.2.0.md
├── RELEASE_NOTE_1.3.0.md
├── RELEASE_NOTE_v1.0.0.md
├── RELEASE_NOTE_v1.1.0.md
├── RELEASE_NOTE_v1.2.0.md
├── RELEASE_NOTE_v1.3.0.md
├── RELEASE_NOTE_v1.4.0.md
├── RELEASE_NOTE_v1.5.0.md
├── RELEASE_NOTE_v1.6.0.md
├── RELEASE_NOTE_v1.7.0.md
├── RELEASE_NOTE_v1.8.0.md
├── RELEASE_NOTE_v1.9.0.md
├── RELEASE_NOTE_v1.10.0.md
├── RELEASE_NOTE_v1.11.0.md
├── RELEASE_NOTE_v1.12.0.md
└── metrics-v1.12.0.json   # deterministic fixture-only accuracy metrics snapshot
examples/
├── dbo.v110_demo.sql    # per-release outcome demos
├── dbo.v120_demo.sql
├── dbo.v130_demo.sql
├── dbo.v140_demo.sql
├── dbo.v150_demo.sql
├── dbo.v160_demo.sql
├── dbo.v170_demo.sql    # v1.7.0: clear deterministic exports demo
├── dbo.v180_demo.sql    # v1.8.0: usable local workspace demo
├── dbo.v190_demo.sql    # v1.9.0: resolve by catalogue demo
├── dbo.v1100_demo.sql   # v1.10.0: column lineage foundations demo
├── dbo.v1110_demo.sql   # v1.11.0: column lineage pipelines demo
└── dbo.v1120_demo.rdl   # v1.12.0: SSRS/RDL report import demo
scripts/
├── file-smoke.mjs    # dependency-free local-file release smoke test
└── metrics.mjs       # generate/verify the fixture-corpus metric snapshot
src/
├── types.d.ts        # shared tokens, AST, graphs, diagnostics, and contracts
├── tokenizer.ts      # lexical analysis, escaping, balance checks, source spans
├── catalogue.ts      # catalogue import (JSON + line) and object resolution
├── dialects.ts       # dialect detection and procedural parsing
├── lineage.ts        # CTE and query dependency extraction
├── ir.ts             # graphs, diagnostics, confidence, and estate analysis
├── columns.ts        # v1.10.0: single-statement column scopes and bindings
├── columnflow.ts     # v1.11.0: cross-statement column-flow pipelines + export graph
├── report.ts         # v1.12.0: SSRS/RDL report import and dataset linking
├── exporters.ts      # Mermaid, draw.io, and narration output
├── workspace.ts      # opt-in persistence + presentation-only dependency filtering
└── app.ts            # browser UI and workspace interaction
dist/                 # generated JavaScript and source maps
├── src/
└── tests/
tests/
├── index.html
├── fuzz.html
├── ui.html
├── metrics.html
├── fixtures.ts
├── tsql-fixtures.ts
├── boundary.ts
├── parity.ts
├── workspace.ts
├── catalogue.ts
├── columns.ts        # v1.10.0: column lineage foundations fixtures
├── column-flow.ts    # v1.11.0: column-flow pipelines, export, and layout fixtures
├── report.ts         # v1.12.0: report import, dataset linking, diagnostics fixtures
├── tests.ts
├── fuzz.ts
├── ui-tests.ts
├── metrics.ts
└── dialects/
    ├── db2.ts
    ├── tsql.ts
    ├── plpgsql.ts
    └── sqlite.ts
vendor/
└── mermaid/
    ├── mermaid.min.js
    └── LICENSE
```

The shared model uses a discriminated TypeScript AST and records source spans,
branches, loops, scoped handlers, reads, writes, calls, result sets,
diagnostics, and graph structures.

## Release checklist

Run the following from a clean checkout before tagging a release:

```text
npm ci
npm run typecheck
npm run build
npm run test:file
git status --short
```

Then verify:

1. The three served browser suites pass.
2. `git status --short` shows only the intended release changes.
3. Generated `dist/` files match their TypeScript sources.
4. The Mermaid SHA-256 matches the value in this README and the workflow.
5. `npm run metrics` reports the metric snapshot is current.
6. `RELEASE_NOTE_v1.12.0.md` matches the final tag contents.
7. The complete archive opens locally with `index.html`, and the local-file
   smoke test reports the opt-in workspace assertion.
8. The tag is named `v1.12.0`.

The release can then be created manually from the `v1.12.0` tag using
[RELEASE_NOTE_v1.12.0.md](docs/RELEASE_NOTE_v1.12.0.md).

## Roadmap after v1.0.0

1. Expand the anonymised golden SQL fixture corpus.
2. Improve table-function, `APPLY`, comma-source, and DML lineage.
3. Model more multi-statement and temporary-table transformations.
4. Import SSRS/RDL definitions and link reports to datasets.
   **Delivered in v1.12.0.**
5. Accept database catalogue metadata for more accurate object resolution.
   **Delivered in v1.9.0.**
6. Add column-level lineage where it can be resolved safely.
   **Delivered in v1.11.0** — foundations landed in v1.10.0 (column scopes,
   bindings, projections, CTE/derived-table scopes, and catalogue-backed
   wildcard expansion within one statement); v1.11.0 adds the full column-flow
   pipelines through temp tables, transformations, views, CTEs, and
   catalogue-resolved object boundaries, plus column export metadata/styles and
   the documented column layout class.
7. Add optional local workspace persistence and dependency filtering.
   **Delivered in v1.8.0.**
8. Separate graph, transaction, and estate-analysis internals while preserving
   the v1.0.0 behavior through golden tests. **Delivered in v1.1.0.**

## Contributing and reporting problems

A useful bug report includes:

- the selected and detected dialect;
- a minimal anonymised SQL example;
- the generated Mermaid source;
- the expected control flow or dependency;
- the reported confidence, coverage, and diagnostics; and
- the browser and version.

For parser changes, add a focused fixture that fails before the change and
passes afterward. Run type-checking, the build, the local-file smoke test, and
the relevant browser suites before opening a pull request.

Never include production credentials, confidential data, or SQL that cannot be
shared safely in a public issue.
