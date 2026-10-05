# Architecture Decision Records

An ADR records *why* a decision was made: the context, the options, the
verdict, and what it costs. Code shows *what* was built. These records stop the
same argument being had twice.

## Index

| ADR | Decision | Status | Date |
| --- | --- | --- | --- |
| [ADR-001](ADR-001-declared-evidence-query-builder.md) | The query builder uses declared foreign keys only | Accepted | 2026-09-21 |
| [ADR-002](ADR-002-query-persistence.md) | Saved queries are opt-in, versioned, and fingerprint-pruned | Accepted | 2026-09-28 |
| [ADR-003](ADR-003-aggregates-derive-group-by.md) | Aggregates derive `GROUP BY` from the remaining picks | Accepted | 2026-10-04 |

## When to write one

Write an ADR when a decision is **expensive to reverse** or **easy to
re-litigate**:

- what SQL Cartographer is allowed to assert, and what it must refuse to;
- a change to the graph vocabulary, a diagnostic code's meaning, or a file
  format;
- a new dependency, storage surface, or anything touching the local-only
  guarantee;
- a choice between two designs where the losing option had real merit.

Do **not** write one for a refactor that leaves behaviour unchanged, a bug fix,
or anything the code and tests already explain. Documentation that restates
code is debt.

## How to write one

1. Copy [TEMPLATE.md](TEMPLATE.md).
2. Name it `ADR-NNN-short-title.md`, continuing the sequence. Do not restart
   numbering and do not introduce a second scheme.
3. Fill in every section. **Alternatives Considered must contain rejected
   options with a stated reason** — that is the part future readers need.
4. Set the status to `Accepted`, or to `Superseded by ADR-NNN` when a later
   record replaces it. Never delete an old ADR; historical context is the point.
5. Add the record to the index above and link it from the doc it governs
   ([ARCHITECTURE.md](../ARCHITECTURE.md), [QUERY_BUILDER.md](../QUERY_BUILDER.md),
   or [CONTRIBUTING.md](../../CONTRIBUTING.md)).

## Lifecycle

```text
PROPOSED  →  ACCEPTED  →  SUPERSEDED | DEPRECATED
```

- **Accepted** — the decision stands and the code follows it.
- **Superseded by ADR-NNN** — a later record replaced it. Keep both; the old one
  explains what used to be true and why.
- **Deprecated** — no longer relevant, but kept for provenance.

A decision that the code has drifted from is a bug in one of the two. Either
the code is wrong or the ADR is stale; say which, and fix it in the same change.
