<p align="center">
  <img src="assets/procflow-logo.svg"
       alt="proc&gt;flow — SQL logic and dependency visualiser"
       width="760">
</p>

<p align="center"><strong>Understand complicated SQL without tracing every branch by hand.</strong></p>

<p align="center">
  <a href="https://github.com/ikelaiah/ProcFlow/actions/workflows/correctness.yml"><img src="https://github.com/ikelaiah/ProcFlow/actions/workflows/correctness.yml/badge.svg?branch=main" alt="Correctness workflow status"></a>
  <a href="https://github.com/ikelaiah/ProcFlow/releases/latest"><img src="https://img.shields.io/github/v/release/ikelaiah/ProcFlow?display_name=tag&amp;sort=semver" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/ikelaiah/ProcFlow?color=54c39b" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/runtime-local--only-54c39b" alt="Runtime: local only">
</p>

ProcFlow turns SQL into diagrams for control flow, query structure, object
dependencies, column lineage, and report dependencies. It runs locally in the
browser: no backend, database connection, sign-in, or installation is required.

> **Accuracy warning:** ProcFlow is a deterministic heuristic analyser, not a
> database compiler. Treat diagrams as investigation aids and verify important
> findings against the source SQL and target database.

## Use cases

- **DBAs:** review procedures, functions, triggers, views, transactions,
  exception paths, reads, writes, and calls.
- **SQL/report engineers:** import SSRS/RDL definitions, connect datasets to
  their queries, and trace report → dataset → object → column dependencies.
- **Application teams:** inspect multi-object scripts, temporary-table flow,
  catalogue-backed object resolution, and conservative column lineage.
- **Reviewers:** export deterministic Mermaid, SVG, or editable draw.io
  diagrams with source provenance.

## Quick start

1. Download the `v1.14.0` runtime ZIP from the [GitHub release](https://github.com/ikelaiah/ProcFlow/releases/tag/v1.14.0), or clone this repository.
2. Open `index.html` in a current Chromium, Firefox, or Edge browser.
3. Paste SQL or import local files, select a dialect or **Auto**, and choose
   **Refresh**.
4. Choose an object and scope, then inspect the source spans and diagnostics
   before relying on a relationship.

For development, see [Development](docs/DEVELOPMENT.md). For a simple served
run, use `python -m http.server 8000` from the runtime directory and open
`http://127.0.0.1:8000/`.

## Demo

Open the app and choose **Load sample** to explore a representative procedure,
query, report-shaped dependency, or SQLite trigger without preparing any input.
The logo above is the bundled project mark; all sample and user analysis stays
in the browser.

## What it shows

- `IF`/`ELSE`/`CASE`, loops, exits, labels, `GOTO`, cursors, transactions,
  savepoints, returns, and exception handling;
- statement and result-set structure, CTEs, joins, unions, subqueries, table
  reads/writes, `MERGE`, `APPLY`, derived tables, and query references;
- procedure/function calls and object dependencies;
- temporary-table producer → consumer data flow;
- conservative column lineage with explicit ambiguity;
- report and dataset dependency chains;
- dynamic SQL as an explicit opaque step rather than an invented dependency.

## Supported dialects

ProcFlow v1.14.0 supports Microsoft T-SQL, IBM DB2 SQL PL, PostgreSQL
PL/pgSQL, and SQLite. Detection is automatic but can be overridden. Vendor
extensions outside these tested constructs may produce diagnostics or reduced
coverage; see [Accuracy](docs/ACCURACY.md).

## Privacy and security

Runtime analysis is local-only. Nothing is submitted to ProcFlow. Browser
storage is opt-in through **Save to this browser**; workspace export and
clipboard actions are explicit. Mermaid uses strict rendering in the security
suite, and hostile labels are escaped for diagram/XML output. Read the full
[Security and privacy](docs/SECURITY.md) policy before using sensitive data.

## Documentation

- [User guide](docs/USER_GUIDE.md) — workflows, imports, filters, workspaces,
  large inputs, and exports.
- [Accuracy](docs/ACCURACY.md) — confidence, coverage, diagnostics, and limits.
- [Architecture](docs/ARCHITECTURE.md) — pipeline, modules, and invariants.
- [Security](docs/SECURITY.md) — data handling and hostile-input boundaries.
- [Development](docs/DEVELOPMENT.md) — build, browser suites, benchmarks, and
  packaging.
- [Benchmarks](docs/BENCHMARKS.md) — scale fixtures and indicative observations.
- [Release history](docs/RELEASES.md) — versioning and release notes.
- [v1.14.0 release note](docs/releases/v1.14.0.md) — current milestone details.
- [Roadmap](ROADMAP.md) — planned convergence work.

## Contributing

Keep runtime code local-only, preserve source spans and conservative semantics,
add deterministic fixtures for behavior changes, and rebuild `dist/` before a
commit. Run the commands in [Development](docs/DEVELOPMENT.md), including the
browser and package smoke suites. Use the issue forms for anonymised parser
reports, bugs, and feature requests; never include confidential SQL.

## License

ProcFlow is released under the [MIT License](LICENSE). Mermaid is vendored under
its own MIT license in `vendor/mermaid/LICENSE`.
