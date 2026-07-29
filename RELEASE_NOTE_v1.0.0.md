# proc>flow v1.0.0

ProcFlow v1.0.0 is the first stable release of the local-first SQL logic and
dependency visualiser.

It is designed for database administrators, SQL report engineers, developers,
analysts, and reviewers who need to understand unfamiliar SQL quickly without
connecting ProcFlow to a database or sending SQL to a service.

## Highlights

- Open `index.html` directly from the extracted release; no installation,
  server, account, or database connection is required.
- Analyse Microsoft T-SQL, IBM DB2 SQL PL, PostgreSQL PL/pgSQL, and SQLite.
- Visualise internal control flow, query structure, or dependencies across
  several imported objects.
- Import multiple `.sql`, `.ddl`, or `.txt` files.
- Click diagram nodes to select the corresponding SQL.
- Review confidence, input coverage, and diagnostics before relying on a
  diagram.
- Export Mermaid, SVG, editable draw.io XML, or a narration prompt.
- Work offline with a vendored and checksum-pinned Mermaid renderer.

## For database administrators

ProcFlow can identify routine calls, table reads and writes, decisions, loops,
returns, transactions, savepoints, and error paths.

The v1.0.0 dialect model includes:

- T-SQL `TRY`/`CATCH`, `THROW`, `RAISERROR` severity, `XACT_STATE()`,
  `@@TRANCOUNT`, nested transaction depth, savepoint flow, `SET XACT_ABORT`,
  and invalid transaction-action termination.
- DB2 scoped handlers, cursor and `NOT FOUND` flow, and labelled loop control.
- PL/pgSQL `EXCEPTION` condition matching, transactional exception scopes, and
  rethrow propagation.
- SQLite trigger `RAISE` actions, termination behavior, trigger `WHEN`,
  conditional `WHERE`, and searched `CASE` paths.

## For SQL report engineers

Query-structure diagrams can show common table expressions, source tables,
explicit joins, unions, subqueries, filters, and grouping. Multi-object
dependency diagrams help trace report queries and views to their upstream
objects and tables.

SSRS/RDL report definitions are not imported in this release. Dataset SQL can
be pasted or imported directly.

## Correctness baseline

The v1.0.0 baseline passes:

- TypeScript type-checking and a clean generated build;
- 131 focused golden parser, graph, dependency, and exporter tests;
- 400 deterministic mutation cases covering no-crash, source-span, graph,
  determinism, Mermaid, and draw.io invariants;
- 12 browser interaction and local-runtime tests; and
- a release smoke test that opens the real application from a `file://` URL and
  verifies that all local runtime scripts initialise.

GitHub Actions also rejects stale generated JavaScript, a changed vendored
Mermaid checksum, and external HTTP URLs in runtime application files.

## Get started

1. Download the `v1.0.0` archive from GitHub Releases.
2. Extract the complete archive.
3. Open `index.html` in a recent Chrome, Edge, Firefox, or Chromium browser.
4. Press **Load sample**, paste SQL, or import SQL files.
5. Press **Refresh** or use `Ctrl+Enter` (`Cmd+Enter` on macOS).

Keep `index.html`, `styles.css`, `dist/`, and `vendor/` together. The compiled
JavaScript and Mermaid renderer are included in the release.

## Security and privacy

- SQL analysis and diagram generation happen inside the browser tab.
- ProcFlow does not upload SQL, connect to a database, execute SQL, use
  analytics, or call an AI service.
- Imported files remain in memory and are discarded when the tab closes.
- ProcFlow does not use cookies, `localStorage`, `sessionStorage`, or IndexedDB.
- Clipboard and export actions occur only after a user chooses them.
- The only third-party runtime is Mermaid 10.9.1 under the MIT licence.

The v1.0.0 Mermaid bundle SHA-256 is:

```text
61B335A46DF05A7CE1C98378F60E5F3E77A7FB608A1056997E8A649304A936D6
```

Review organisational policy before pasting a narration prompt or SQL into an
external system.

## Known limitations

- Parsing is heuristic rather than compiler-grade.
- Dynamic SQL is shown as opaque.
- Semicolon-free or unusually formatted batches can affect statement
  boundaries.
- Query lineage is object-level, not column-level.
- Comma-separated sources and some vendor-specific table expressions might not
  be detected.
- Temporary-table, synonym, linked-server, and cross-database resolution is
  lightweight.
- SSRS/RDL import is not included.
- Large draw.io exports can require manual rearrangement.

Verify critical dependencies, execution paths, transaction behavior, and
security conclusions against the original SQL and target database.

## Upgrade notes

This is the first stable release. There is no data migration: ProcFlow does not
persist SQL or workspace state. Replace an older extracted copy with the
complete v1.0.0 archive and open its `index.html`.

See [README.md](README.md) for detailed user workflows, security-review
guidance, development instructions, and the post-v1.0.0 roadmap.
