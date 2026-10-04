# proc>flow v1.8.0 — Usable local workspace

**Release date:** 2026-08-08

ProcFlow v1.8.0 makes the browser workspace usable across sessions. You can
**persist** your work so a reload brings back an identical analysis, and you
can **filter** the object-dependency diagram down to the objects that matter.

Persistence is optional, opt-in, versioned, and exportable. Nothing is saved
to your browser unless you choose **Save to this browser** in the **Workspace**
menu, and saved workspaces are local-only, clearable, and portable as a JSON
file. Dependency filtering is presentation-only: it changes the view you look
at and export, never the underlying analysis graph or its confidence, coverage,
and diagnostics.

The release remains local-first: SQL is analysed entirely in the browser and is
not uploaded, executed, or automatically persisted.

## Highlights

- **Opt-in workspace persistence.** The **Workspace** menu lets you Save to
  this browser, Restore a saved workspace, Export/Import a workspace file, and
  Forget a saved workspace. A Restore replays the exact files and analysis
  options, so **save → reload produces an identical analysis**.
- **Versioned and migratable.** Stored workspaces carry a schema version;
  older or incomplete snapshots migrate forward with safe defaults instead of
  being dropped.
- **Corrupt-state recovery.** Malformed or unreadable stored data is recovered
  cleanly — ProcFlow starts fresh rather than crashing or misloading.
- **Dependency filtering.** In **Object dependencies** scope, the
  **Filter dependencies** panel toggles Reads/Writes/Calls edge kinds and
  External/Temp node kinds, plus a Focus box that keeps an object and its
  direct neighbours. Filtering is presentation-only — the analysis graph is
  never changed.
- **Honest local-only guarantees.** The privacy disclosure, README, release
  smoke test, and CI now state and verify that nothing is written to or
  restored from storage on load; storage is confined to the opt-in
  persistence module.

## Correctness baseline

- TypeScript type-checking and a clean generated build;
- 207 golden, graph, dependency, exporter, provenance, boundary, diagnostic,
  confidence, export-parity, layout, and workspace tests;
- 400 deterministic mutation cases;
- 20 browser interaction and local-runtime tests;
- workspace persistence/filtering fixtures 13/13, export parity 20/20, layout
  budgets 11/11, export traceability 69/69; and
- the fixture-corpus metric snapshot in `docs/metrics-v1.8.0.json`: 100 %
  attribution, 100 % semantic-edge coverage, 100 % provenance, 100 % region-span
  ratio, 100 % export-parity, 100 % export-traceability, 100 % layout budgets,
  and 100 % workspace pass rate.

GitHub Actions also checks that generated JavaScript is current, the vendored
Mermaid runtime remains pinned, runtime application files contain no external
URLs or network-submission APIs, browser storage is confined to the opt-in
persistence module, the local-file smoke test passes, and the metric snapshot
is current.

## Compatibility and upgrade notes

- **No automatic migration of your data — because there wasn't any.** ProcFlow
  still does not persist anything unless you opt in. When you next use
  **Save to this browser**, a v1.8.0-versioned snapshot is written; earlier
  releases never wrote one.
- Exported `.drawio` files from v1.7.0 remain valid; nothing in the export
  format changed.
- The local-only browser security model is unchanged.

## Security and privacy (v1.8.0)

- Nothing is uploaded, executed, or sent to any API.
- **Workspace persistence is opt-in and local:** a saved workspace lives only
  in this browser's `localStorage`, is written only when you choose
  **Save to this browser**, and is removed by **Forget saved workspace**.
- Saved workspaces are exportable as a JSON file and importable again, so they
  never become locked to a single browser.
- The runtime touches storage in exactly one place — the opt-in persistence
  module — and the release smoke test and CI assert that nothing is read or
  written on load.

## Known limitations

- Parsing is heuristic rather than compiler-grade.
- Dynamic SQL remains opaque.
- Persistence uses the browser's `localStorage`; clearing browser site data
  removes a saved workspace, and a saved workspace is not shared across
  different browsers, profiles, or machines unless you export/import the file.
- Catalogue resolution, column lineage, and RDL remain scheduled for later
  releases.

Verify critical dependencies, execution paths, transaction behavior, and
security conclusions against the original SQL and target database.

See [README.md](../README.md) for usage and development guidance.
