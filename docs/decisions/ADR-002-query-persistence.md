# ADR-002: Opt-in local query persistence and versioned query files

## Status

Accepted

## Date

2026-09-21

## Context

The v2.4.0 query builder held picks and options in session memory. Closing the
tab lost the query, and there was no way to hand the SQL to another tool except
copy and paste. Users asked to keep a query and to take the statement with
them.

Existing constraints shape the answer:

- ProcFlow is local-first: no backend, no accounts, no network calls. Browser
  storage is opt-in and guarded by CI to live only in `src/workspace.ts`.
- The ERD layout already established the pattern: one saved payload per
  browser, explicit Save/Restore/Forget, plus a versioned file with a schema
  fingerprint (`erdLayoutToJSON` in `src/erd.ts`).
- The accuracy contract requires that stale or unreadable state never becomes
  a silent wrong answer.

## Decision

Ship three capabilities, all local:

1. **One saved query per browser**, under `procflow.erd.query`, written only
   by `src/workspace.ts`. Save, Restore, and Forget are explicit user actions;
   nothing is stored automatically.
2. **Versioned query files** in a pure module, `src/query-store.ts`: format
   `procflow-erd-query`, version 1, with a schema fingerprint. Foreign,
   future-version, and malformed payloads are rejected with diagnostics;
   unreadable entries inside a valid file are ignored with one informational
   diagnostic.
3. **Prune-and-report restores.** References that no longer exist in the
   current schema (tables, columns, taught joins, sorts, cross/excluded ids,
   path choices) are dropped and counted, and a fingerprint mismatch is
   reported. A restore never fails because the schema moved on.

The generated `.sql` can also be downloaded as a file; the download respects
the Comments toggle so the provenance header is included only when the user
wants it.

## Alternatives Considered

### Auto-save session state
- Pros: nothing to remember; reload just works.
- Cons: implicit storage contradicts the opt-in rule used by the workspace and
  layout; a query for one schema would reappear confusingly on another.
- Rejected: explicit Save/Restore matches the established pattern.

### A named library of multiple queries
- Pros: real query management; one browser can hold many analyses.
- Cons: needs list management, naming conflicts, deletion UX, and a storage
  schema for a feature nobody has asked for yet; the single slot plus files
  covers sharing and archiving.
- Rejected for v2.5.0; file export is the escape hatch for multiple queries.

### IndexedDB or a service worker
- Pros: larger storage, structured queries.
- Cons: new storage surface outside the CI-guarded module, more failure modes,
  no user-visible benefit for a payload measured in kilobytes.
- Rejected.

### Files only, no browser storage
- Pros: zero storage concerns; the file is the single source of truth.
- Cons: saving requires a download every time, and the common case (come back
  tomorrow on the same machine) becomes friction.
- Rejected: the opt-in browser slot is cheap and consistent with the layout.

### Store the query inside the workspace snapshot
- Pros: one snapshot restores everything.
- Cons: couples the ERD query to the flowchart workspace lifecycle; forgetting
  a workspace would silently drop a query and vice versa.
- Rejected: separate key, mirroring `procflow.erd.layout`.

## Consequences

- One saved query per browser; multiple analyses are kept as files. The
  optional name field drives export filenames (`orders-by-customer.json` /
  `.sql`) and falls back to the schema fingerprint.
- The file format is versioned from day one; a future version must add a
  migration or reject newer payloads, exactly like the workspace schema.
- Restores are honest about drift: dropped entries are counted and a changed
  schema is named in the status line, never silently applied.
- Storage stays inside the CI-guarded module, so the local-only guarantee is
  mechanically enforced rather than reviewed by eye.
