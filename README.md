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

`proc>flow` is a local-first SQL logic and dependency visualiser for database
administrators, SQL report engineers, developers, analysts, and reviewers.
Paste SQL or import a group of SQL files to see:

- how a procedure, function, trigger, view, or query works internally; and
- how database objects read, write, and call one another.

There is no installation, database connection, backend service, or sign-in.
The application runs entirely in a browser and works from the local filesystem.

> [!IMPORTANT]
> ProcFlow uses a heuristic parser rather than a database engine's compiler.
> Treat diagrams as investigation aids. Check important findings against the
> source SQL and the target database.

For the first stable release, see
[RELEASE_NOTE_v1.0.0.md](RELEASE_NOTE_v1.0.0.md). For the v1.1.0 release, see
[RELEASE_NOTE_1.1.0.md](docs/RELEASE_NOTE_1.1.0.md). For the v1.2.0 release, see
[RELEASE_NOTE_1.2.0.md](docs/RELEASE_NOTE_1.2.0.md).

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

1. Download the `v1.2.0` archive from
   [GitHub Releases](https://github.com/ikelaiah/ProcFlow/releases) or clone
   this repository.
2. Extract the complete archive. Keep `index.html`, `styles.css`, `dist/`, and
   `vendor/` together.
3. Open `index.html` in a recent Chrome, Edge, Firefox, or Chromium browser.
4. Choose one input:
   - press **Load sample**;
   - paste SQL into **SQL source**; or
   - press **Import SQL files** and select one or more files.
5. Press **Refresh** or use `Ctrl+Enter` (`Cmd+Enter` on macOS).

No `npm install`, local server, database, or internet connection is required
for normal use.

If the page opens but the diagram does not render, first confirm that the whole
archive was extracted. Opening a copied `index.html` without its sibling
`dist/` and `vendor/` directories will not work.

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

Useful DBA review questions include:

- Which tables are read or changed?
- Which routines are called?
- Can execution exit before a commit or final result?
- Where can an exception or error be handled, rethrown, or terminate work?
- Does transaction state affect the available recovery path?
- Is any dynamic SQL hiding behavior from static analysis?

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

ProcFlow imports SQL text, not report-definition files. SSRS/RDL import is on
the roadmap; for v1.2.0, paste or export the dataset SQL itself.

## What ProcFlow can show

### Internal control flow

- `IF`, `ELSE`, and `CASE` decisions
- loops, loop exits, and early returns
- statements and result sets
- procedure and function calls
- table reads and writes
- temporary-table transformations
- transactions and savepoints
- exception handling and T-SQL `TRY`/`CATCH`
- dynamic SQL as an explicit opaque step

### Query structure

- common table expressions
- source tables and views
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

Known imported objects are linked. Selecting one can open its internal logic.

## Reading the analysis safely

The analysis panel provides three release-safety signals:

- **Confidence** combines dialect certainty, parser coverage, and diagnostics.
- **Coverage** is the percentage of body tokens consumed by the parser.
- **Diagnostics** reports uncertain dialects, balance errors, missing block
  terminators, unconsumed input, invalid actions, and opaque dynamic SQL.

Use this rule of thumb:

- High confidence and complete coverage: review the chart, then verify material
  findings in the SQL.
- Reduced confidence: select the dialect manually and inspect the diagnostics.
- Incomplete coverage: treat the unresolved source region as a review item.
- Dynamic SQL warning: review the generated SQL separately; its internal reads,
  writes, calls, and branches cannot be inferred safely.

Input the parser cannot consume is represented as an unresolved node rather
than silently disappearing from the diagram.

## Supported SQL

ProcFlow v1.2.0 recognises:

- Microsoft T-SQL
- IBM DB2 SQL PL
- PostgreSQL PL/pgSQL
- SQLite

Supported inputs include procedures, functions, triggers, views, plain SQL
statements, report dataset queries, and multi-object scripts where those object
types apply to the selected dialect.

Dialect-specific v1.2.0 coverage includes:

- **T-SQL:** semicolon-free statements with grammar-driven boundaries, `TRY`/
  `CATCH`, `THROW`, `RAISERROR` severity, `XACT_STATE()`,
  `@@TRANCOUNT`, nested transaction depth, savepoints, `SET XACT_ABORT`, and
  invalid transaction-action termination.
- **DB2 SQL PL:** scoped handlers, cursors, `NOT FOUND` flow, and labelled loop
  control.
- **PL/pgSQL:** `EXCEPTION` condition matching, transactional exception scopes,
  and rethrow propagation.
- **SQLite:** trigger `RAISE` actions, termination behavior, trigger `WHEN`,
  conditional `WHERE`, and searched `CASE` paths.

Detection is automatic and can be overridden from the **Dialect** selector.
When detection is uncertain and several dialects score equally, an explicit
`dialect_ambiguous` diagnostic is reported along with the usual
low-confidence warning.

## Importing SQL

**Import SQL files** accepts multiple `.sql`, `.ddl`, and `.txt` files. Files
are read into memory by the current browser tab; they are not uploaded or
persisted.

Multi-object scripts are split into selectable objects. If the split cannot be
made confidently, ProcFlow keeps the input as one script and reports the
uncertainty.

## Exporting and sharing

The **Export** menu provides:

- **Copy Mermaid** — copy the generated Mermaid definition.
- **Copy narration prompt** — copy a prompt containing diagram structure and
  source SQL.
- **Save SVG** — download the rendered diagram.
- **Save draw.io** — download editable native `.drawio` XML.

The narration prompt is never submitted automatically. It reaches another
system only if a user pastes it there. Review organisational policy before
sharing confidential SQL.

draw.io is a trademark of draw.io AG. ProcFlow is not affiliated with or
endorsed by draw.io.

## Security and privacy

### Quick answers

| Question | ProcFlow v1.2.0 behavior |
|---|---|
| Is SQL uploaded? | No. Analysis and rendering happen in the browser tab. |
| Does it connect to a database? | No. There is no driver, connection string, or query execution. |
| Is there a backend or API? | No. It is a static HTML, CSS, and JavaScript application. |
| Is there analytics or telemetry? | No. |
| Is internet access required? | No for local or internally hosted use. |
| Are imported files uploaded? | No. The browser File API reads them into the current tab. |
| Is SQL retained after closing the tab? | No. ProcFlow does not use cookies, `localStorage`, `sessionStorage`, or IndexedDB. |
| Does ProcFlow write to the clipboard automatically? | No. Clipboard writes follow an explicit copy action. |
| Are exports local? | Yes. SVG and draw.io files are generated in memory and downloaded by the browser. |
| Does it call an AI service? | No. It can copy a narration prompt but never submits it. |

### Runtime files

The runtime application consists of:

```text
index.html
styles.css
dist/src/tokenizer.js
dist/src/dialects.js
dist/src/lineage.js
dist/src/ir.js
dist/src/exporters.js
dist/src/app.js
vendor/mermaid/mermaid.min.js
```

There is no application `fetch`, `XMLHttpRequest`, WebSocket, beacon, or other
network-submission code. The only bundled third-party runtime is the pinned
Mermaid 10.9.1 renderer. Its MIT licence is stored at
`vendor/mermaid/LICENSE`.

The SHA-256 of `vendor/mermaid/mermaid.min.js` in v1.2.0 is:

```text
61B335A46DF05A7CE1C98378F60E5F3E77A7FB608A1056997E8A649304A936D6
```

The repository's `.gitattributes` preserves this vendored file byte-for-byte
so the release checksum remains reproducible across operating systems.

### Guidance for security review

1. Review and pin the `v1.2.0` tag or its exact commit.
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

- Parsing is heuristic and does not provide the guarantees of the target
  database engine's parser.
- Dynamic SQL is opaque.
- Statement boundaries no longer depend on newline position: semicolons are
  authoritative and omitted semicolons are split by control keywords and
  statement grammar. Exceptionally malformed batches can still produce imperfect
  splits.
- Query lineage is object-level rather than column-level.
- Comma-separated sources and some vendor-specific table expressions might not
  be detected.
- Temporary-table, synonym, linked-server, and cross-database resolution is
  lightweight.
- SSRS/RDL files are not imported in v1.2.0.
- Large draw.io exports can require manual rearrangement.

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

The v1.2.0 baseline is:

- 156 golden and boundary assertions
- 400 deterministic mutation cases
- 13 browser interaction tests

GitHub Actions installs dependencies, type-checks, builds, verifies generated
files, runs the local-file smoke test, checks that the runtime remains
local-only, and runs all three served browser suites on every push and pull
request.

### Project structure

```text
index.html
styles.css
README.md
RELEASE_NOTE_v1.0.0.md
package.json
package-lock.json
tsconfig.json
.gitattributes
.github/
└── workflows/
    └── correctness.yml
assets/
└── procflow-logo.svg  # adaptive light/dark README wordmark
scripts/
└── file-smoke.mjs    # dependency-free local-file release smoke test
src/
├── types.d.ts        # shared tokens, AST, graphs, diagnostics, and contracts
├── tokenizer.ts      # lexical analysis, escaping, balance checks, source spans
├── dialects.ts       # dialect detection and procedural parsing
├── lineage.ts        # CTE and query dependency extraction
├── ir.ts             # graphs, diagnostics, and estate analysis
├── exporters.ts      # Mermaid, draw.io, and narration output
└── app.ts            # browser UI and workspace interaction
dist/                 # generated JavaScript and source maps
├── src/
└── tests/
tests/
├── index.html
├── fuzz.html
├── ui.html
├── fixtures.ts
├── tsql-fixtures.ts
├── boundary.ts
├── tests.ts
├── fuzz.ts
├── ui-tests.ts
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
5. `RELEASE_NOTE_1.2.0.md` matches the final tag contents.
6. The complete archive opens locally with `index.html`.
7. The tag is named `v1.2.0`.

The release can then be created manually from the `v1.2.0` tag using
[RELEASE_NOTE_1.2.0.md](docs/RELEASE_NOTE_1.2.0.md).

## Roadmap after v1.0.0

1. Expand the anonymised golden SQL fixture corpus.
2. Improve table-function, `APPLY`, comma-source, and DML lineage.
3. Model more multi-statement and temporary-table transformations.
4. Import SSRS/RDL definitions and link reports to datasets.
5. Accept database catalogue metadata for more accurate object resolution.
6. Add column-level lineage where it can be resolved safely.
7. Add optional local workspace persistence and dependency filtering.
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
