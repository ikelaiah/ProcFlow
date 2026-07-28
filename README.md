# proc>flow 🔎

Understand complicated SQL without tracing every branch by hand.

`proc>flow` is a local-first SQL visualiser for DBAs, developers, analysts, and
reviewers. Paste SQL or import several SQL files to explore:

- how an individual procedure, function, trigger, view, or query works; and
- how objects depend on tables, views, and called routines.

There is no installation, database connection, backend service, or build step.
Open the page in a modern browser and start exploring.

> [!IMPORTANT]
> Parsing is heuristic rather than compiler-grade. Use each diagram as an
> investigation aid and verify important findings against the source SQL.

## 🚀 Quick start

1. Download or clone this repository.
2. Open `index.html` in a modern browser.
3. Paste SQL, press **Load sample**, or use **Import SQL files**.
4. Press **Draw flowchart**.
5. Switch between **Internal logic** and **Object dependencies**.

Everything needed to render a diagram is included in the repository, so the
application works without an internet connection.

## 🧭 What can I visualise?

### 🔬 Internal logic

Follow the execution path inside the selected object:

- `IF`, `ELSE`, and `CASE` decisions
- loops, loop exits, and early returns
- statements and result sets
- procedure and function calls
- table reads and writes
- temporary-table transformations
- transactions
- exception handling and T-SQL `TRY`/`CATCH`
- dynamic SQL, shown explicitly as an opaque step

Click a source-aware diagram node to select the corresponding SQL in the editor.

For a single query, Procflow can instead show query structure, including CTEs,
source tables, explicit joins, unions, subqueries, filtering, and grouping.

### 🕸️ Object dependencies

Import or paste several database objects to see an estate-level map:

- procedure or function → called routine
- view or query → source object
- object → table read
- object → table write

Click a known object in the dependency diagram to open its internal logic.

## 🔐 Designed for local and security-conscious use

Procflow performs SQL analysis inside the browser tab. The application code
does not send SQL, filenames, diagrams, or usage information anywhere.

### 🛡️ Security and privacy summary

| Question | Procflow behaviour |
|---|---|
| Is SQL uploaded to a server? | No. Parsing and diagram generation happen in the browser. |
| Does it connect to a database? | No. There is no database driver, connection string, or query execution capability. |
| Is there a backend or API? | No. It is a static HTML, CSS, and JavaScript application. |
| Does it contain analytics or telemetry? | No. There are no analytics, tracking, or telemetry calls. |
| Does it require internet access? | No when opened locally or hosted internally. Mermaid is included in `vendor/`. |
| Are imported files uploaded? | No. The browser File API reads them into the current tab only. |
| Is SQL stored after closing the tab? | No. Procflow does not use cookies, `localStorage`, `sessionStorage`, or IndexedDB. |
| Does it write to the clipboard automatically? | No. Clipboard writes occur only after a user chooses a copy action. |
| Are exports local? | Yes. SVG and draw.io files are generated in memory and downloaded by the browser. |
| Does it call an AI service? | No. It can copy a narration prompt, but never submits that prompt itself. |

### ✅ What a cyber-security review should know

The runtime application consists of:

```text
index.html
styles.css
src/core.js
src/app.js
vendor/mermaid/mermaid.min.js
```

There is no `fetch`, `XMLHttpRequest`, WebSocket, beacon, or other application
network-submission code. The only bundled third-party runtime is the pinned
Mermaid 10.9.1 renderer. Its MIT licence is stored at
`vendor/mermaid/LICENSE`. The vendored `mermaid.min.js` SHA-256 for this
revision is:

```text
61B335A46DF05A7CE1C98378F60E5F3E77A7FB608A1056997E8A649304A936D6
```

For higher-assurance use:

1. Review and pin a specific repository commit.
2. Open the reviewed files locally or serve them from an approved internal
   static host.
3. Keep browser extensions and developer tools within organisational policy.
4. Re-review dependency changes before upgrading the vendored Mermaid file.
5. Apply your organisation's Content Security Policy at the hosting layer.

If the application is served through GitHub Pages, the browser must download
the static application files from GitHub. After the application loads, Procflow
still does not transmit the SQL entered by the user. Organisations that do not
permit public hosting should use the same files locally or on an internal static
web server. As with any hosted website, GitHub may record ordinary request
metadata such as IP address and browser details while serving the static files;
those requests do not contain the SQL entered into Procflow.

The main deliberate data-release action is **Copy narration prompt**. It places
the SQL and diagram structure on the clipboard. Procflow does not send it
anywhere, but users should follow organisational policy before pasting it into
an external AI product, email, chat, or ticket.

No browser application can guarantee the security of the host computer,
browser, installed extensions, modified source files, or the location where a
user chooses to paste or save data. Procflow's security boundary is that its own
application code performs analysis locally and contains no automatic data
submission path.

## 🗄️ Supported SQL

Procflow currently recognises:

- Microsoft T-SQL
- IBM DB2 SQL PL
- PostgreSQL PL/pgSQL
- SQLite

Supported object headers include procedures, functions, triggers, and views.
Plain SQL statements, report dataset queries, and multi-object scripts can also
be visualised.

Dialect detection is automatic, but it can be overridden. Procflow warns when
detection is uncertain and marks dynamic SQL as opaque when its internal
behaviour cannot be resolved statically.

## 🗺️ Using the diagrams

The **Diagram** selector controls the level:

- **Internal logic** shows the selected object's execution or query structure.
- **Object dependencies** shows relationships across all imported objects.

Within **Internal logic**, **Show** controls the representation:

- **Auto** chooses query structure for a suitable flat query and control flow
  otherwise.
- **Control flow** shows execution order, decisions, loops, exits, and error
  paths.
- **Query structure** shows CTE and source-table relationships.

Additional controls change orientation, label detail, straight-run grouping,
step numbering, error-path fan-in, and source-table visibility.

## 📥 Importing SQL

Use **Import SQL files** to select multiple `.sql`, `.ddl`, or `.txt` files.
Files are read into memory by the current browser tab. They are not uploaded or
persisted.

Multi-object scripts are split into selectable objects. If a script cannot be
split confidently, it is treated as a single script.

## 📤 Exporting and sharing

- **Copy Mermaid** copies the generated Mermaid definition.
- **Copy narration prompt** copies a prompt containing the diagram and source
  SQL. Review organisational policy before sharing it externally.
- **Save SVG** downloads the rendered diagram as an image.
- **Save draw.io** downloads editable native `.drawio` XML.

draw.io is a trademark of draw.io AG. Procflow is not affiliated with or
endorsed by draw.io.

## ⚠️ Known limitations

- The parser does not provide the same guarantees as the target database
  engine's parser.
- Dynamic SQL is opaque; its internal reads, writes, calls, and branches cannot
  be determined safely.
- Semicolon-free or unusually formatted batches may produce inaccurate
  statement boundaries.
- Query lineage is currently object-level rather than column-level.
- Comma-separated sources and some vendor-specific table expressions may not be
  detected.
- Temporary-table, synonym, linked-server, and cross-database resolution remain
  lightweight.
- SSRS/RDL report definition files are not yet imported.
- Large draw.io exports may benefit from manual rearrangement.

Always confirm critical dependencies, execution paths, and security conclusions
against the original SQL and the target database platform.

## 🧱 Project structure

```text
index.html
styles.css
src/
├── core.js        # parser, shared model, dependencies, and exporters
└── app.js         # browser UI and workspace interaction
tests/
├── index.html     # parser, model, dependency, and exporter suite
├── fixtures.js
├── tests.js
├── ui.html        # browser interaction and offline-runtime suite
└── ui-tests.js
vendor/
└── mermaid/
    ├── mermaid.min.js
    └── LICENSE
```

The shared model records statements, source spans, branches, reads, writes,
calls, result sets, diagnostics, and graph structures.

## 🧪 Testing

No test runner installation is required. Open these files in a browser:

- `tests/index.html` — golden parser, model, dependency, and exporter tests
- `tests/ui.html` — object selection, linked diagrams, source highlighting, and
  offline-runtime tests

Current coverage includes all four dialects, CTE/report queries, dynamic SQL,
temporary-table writes, multi-object estates, special-character escaping, and
draw.io XML validation.

## 🛣️ Roadmap

1. Expand the anonymised golden SQL fixture corpus.
2. Improve table-function, `APPLY`, comma-source, and DML lineage.
3. Model more multi-statement and temporary-table transformations.
4. Import SSRS/RDL definitions and link reports to datasets.
5. Accept database catalogue metadata for more accurate object resolution.
6. Add column-level lineage where it can be resolved safely.
7. Add optional local workspace persistence and dependency filtering.

## 🤝 Contributing

Useful bug reports include:

- the selected and detected dialect;
- a minimal anonymised SQL example;
- the generated Mermaid source;
- the expected control flow or dependency; and
- the browser and version.

Never include production credentials, confidential data, or SQL that cannot be
shared safely in a public issue.
