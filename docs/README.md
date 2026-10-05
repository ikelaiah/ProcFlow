# Documentation

SQL Cartographer turns SQL into diagrams for control flow, query structure,
object dependencies, column lineage, report dependencies, and entity
relationship diagrams. It runs entirely in the browser.

This page is the map. Start with the row that matches you.

## Start here

| You want to… | Read |
| --- | --- |
| See what the tool does | [README](../README.md) quick start, then open `index.html` |
| Learn the workflows | [USER_GUIDE.md](USER_GUIDE.md) |
| Understand a diagram | [USER_GUIDE.md — Reading the diagram](USER_GUIDE.md#reading-the-diagram) |
| Build SQL from a schema | [QUERY_BUILDER.md](QUERY_BUILDER.md) |
| Contribute | [CONTRIBUTING.md](../CONTRIBUTING.md) → [DEVELOPMENT.md](DEVELOPMENT.md) |

## Guides

- [USER_GUIDE.md](USER_GUIDE.md) — first run, reading the diagram, database
  review, the ERD query builder, reports, catalogues, large inputs, workspaces,
  and exports.
- [QUERY_BUILDER.md](QUERY_BUILDER.md) — how the join plan is chosen, bridge
  tables, self joins, join direction and row policy, SQL emission, aggregates,
  and what the builder deliberately never does.

## Reference

- [ACCURACY.md](ACCURACY.md) — what is measured, the confidence formula, and
  the conservative-semantics rules.
- [V2_ACCURACY_CONTRACT.md](V2_ACCURACY_CONTRACT.md) — the stable guarantees:
  no silent drops, no invented facts, traceability, and the meaning of every
  node provenance and edge kind.
- [SECURITY.md](SECURITY.md) — data handling, rendering boundaries, and the
  hostile-input policy.
- [GLOSSARY.md](GLOSSARY.md) — the vocabulary the docs and the UI share.
- [BENCHMARKS.md](BENCHMARKS.md) — scale fixtures and indicative timings
  (historical baseline).

## Contributing and releasing

- [CONTRIBUTING.md](../CONTRIBUTING.md) — how to make a change and what the
  project requires of one.
- [DEVELOPMENT.md](DEVELOPMENT.md) — prerequisites, build, browser suites,
  adding a suite, packaging, and the module-header convention.
- [ARCHITECTURE.md](ARCHITECTURE.md) — the pipeline, the module boundaries and
  load-order contract, the graph vocabulary, and the design invariants.
- [RELEASES.md](RELEASES.md) — the release flow and the canonical note index.

## Decisions

Architecture Decision Records capture *why*, not *what*. Read
[decisions/README.md](decisions/README.md) for the index and the template.

| ADR | Decision |
| --- | --- |
| [ADR-001](decisions/ADR-001-declared-evidence-query-builder.md) | The query builder uses declared foreign keys only |
| [ADR-002](decisions/ADR-002-query-persistence.md) | Saved queries are explicit, versioned, and fingerprint-pruned |
| [ADR-003](decisions/ADR-003-aggregates-derive-group-by.md) | Aggregates derive `GROUP BY` from the remaining picks |

## History

- [CHANGELOG.md](../CHANGELOG.md) — concise release history and qualification status.
- [releases/](releases/) — one canonical note per release since v1.14.0.
- [archive/](archive/) — pre-v1.14.0 notes and historical planning documents,
  kept for provenance. Historical documents retain the old project name
  *ProcFlow* on purpose. See [archive/README.md](archive/README.md).
- [ROADMAP.md](../ROADMAP.md) — the v1.x / v2.0 accuracy workstreams. **Historical**;
  all of it shipped.

## Conventions

- Diagrams in these docs are [Mermaid](https://mermaid.js.org/). GitHub renders
  them inline. Small diagrams that stay legible as plain text are left as
  `text` blocks.
- Every version reference in a current document names the version it describes.
  Historical documents are not retro-updated.
- Links are relative and file-relative, so the docs work in the repository and
  in a rendered clone.
