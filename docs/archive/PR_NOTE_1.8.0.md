# PR: v1.8.0 — Usable local workspace

## Summary

Implements the **v1.8.0 — Usable local workspace** milestone from `ROADMAP.md`
in full and nothing from v1.9.0 onwards: README post-v1.0.0 item 7 — **optional
local workspace persistence** (opt-in, versioned, exportable) and
**dependency filtering** (presentation-only) — plus the updated
security/privacy documentation and the extended local-only CI check. The golden
suite grows from 206 to 207; fuzz (400) stays green; the UI suite grows from 16
to 20; workspace fixtures (13) cover save→reload identity, migration, corrupt
recovery, explicit clearing, and non-mutating filters. Catalogue rotation,
column lineage, and RDL remain deferred.

## What's included

### Opt-in, versioned, exportable workspace persistence

`src/workspace.ts` (a new runtime module loaded before `app.js`) adds a
versioned workspace schema (`WORKSPACE_SCHEMA_VERSION = 1`) and the
serialization/migration/storage layer:

- `buildWorkspaceSnapshot` / `serializeWorkspace` capture every input that can
  change the analysis — the workspace files plus the analysis/UI options — so a
  Restore reproduces an identical analysis.
- `parseWorkspace` performs corrupt-state recovery: malformed or wrong-shaped
  stored data yields an explicit error (never a crash) so the caller drops it
  and starts clean.
- `migrateWorkspace` repairs older/missing versions and missing option fields
  forward to the current schema with safe defaults.
- `readWorkspace` / `writeWorkspace` / `hasSavedWorkspace` / `clearWorkspace`
  confine browser `localStorage` access to this opt-in module — the only place
  in the runtime that touches storage.

The **Workspace** menu in `index.html` exposes Save, Restore, Export file,
Import file, and Forget. Everything is an explicit user action: the app never
writes to or restores from storage on load (verified by the release smoke test
and the extended local-only CI check).

### Presentation-only dependency filtering

`filterDependencyGraph` in `src/workspace.ts` derives a filtered copy of the
dependency graph at render time and never mutates the underlying estate graph
(the filtered node/edge arrays are fresh objects, and stats are left intact):

- edge-kind toggles (Reads / Writes / Calls) by semantic `kind`;
- node-kind toggles (External objects, Temp tables) by provenance;
- a Focus box that keeps a matching node plus its immediate neighbours.

`app.ts` applies the filter only in the **Object dependencies** scope; the
**Filter dependencies** panel is hidden elsewhere. The export (`Save draw.io` /
`Save SVG`) reflects the currently displayed (filtered) view, while the
analysis graph, confidence, coverage, and diagnostics are unchanged.

### Security / privacy and local-only documentation + CI

- The `index.html` privacy disclosure and README security table now describe
  opt-in persistence honestly: nothing is saved unless the user chooses Save,
  and saved workspaces are local-only, exportable, and clearable.
- `scripts/file-smoke.mjs` (the local-file release smoke test) now additionally
  asserts the app initialises with `data-workspace-optin="1"`, i.e. persistence
  is declared opt-in on load.
- The CI "Check runtime remains local-only" step is extended to also reject
  network-submission APIs and to confirm that `localStorage` is only touched by
  `src/workspace.ts`.

## Fixtures and tests

- `tests/workspace.ts` (+ `tests/index.html`, `tests/metrics.html` wiring) — 13
  fixture-corpus records covering round-trip fidelity, save→reload identity,
  migration (older versions and missing fields), corrupt-state recovery,
  opt-in storage round-trip + explicit clear, and non-mutating filters (edge,
  external, temp, focus, and no-match). Gates the golden page via
  `PROCFLOW_WORKSPACE_PASS`.
- `tests/ui-tests.ts` — 4 new browser tests: the filter panel shows only in
  dependency scope, filtering is presentation-only in the UI, opt-in save →
  restore reproduces an identical analysis, and forgetting is explicit.
- `tests/metrics.ts` → `docs/metrics-v1.8.0.json` — adds `workspacePassRate`
  and the `workspace` corpus count (13/13).
- `examples/dbo.v180_demo.sql` — a multi-object demo exercising both features.

## Verification

- `npm run typecheck` — passes
- `npm run build` — passes
- `npm run test:file` — passes (with `CHROME_PATH` set; includes the new
  opt-in/local-only assertion)
- Golden suite — 207/207 (was 206)
- Fuzz suite — 400 deterministic mutation cases
- UI suite — 20/20 (was 16)
- `npm run metrics` — snapshot is current; `docs/metrics-v1.8.0.json` committed
  (v1.7.0 snapshot renamed)
- Extended local-only check clean; `dist/` committed in sync

## Not changed / deferred (per roadmap)

- Everything from v1.9.0 onwards — catalogue resolution, column lineage, and
  RDL — is out of scope for this release.
- Existing v1.1.0–v1.7.0 semantics are untouched; all prior fixtures remain
  green.
