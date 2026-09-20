# Architecture

ProcFlow is a static browser application. The runtime is a set of ordered
classic scripts compiled from TypeScript with `module: none`; the browser does
not need a backend, package manager, or database connection.

## Pipeline

```text
SQL / files / catalogue / RDL
            |
       tokenizer
            |
 dialect detection -> dialect parser -> IR + spans + diagnostics
            |                         |
       confidence                 lineage / catalogue / report graph
            |                         |
       app state -------------- exporters and deterministic layout
                                      |
                         Mermaid / SVG / draw.io / workspace
```

The main boundaries are:

- `src/tokenizer.ts` — tokenisation and source positions.
- `src/dialects.ts` — dialect detection and parser selection.
- `src/ir.ts` — AST, analysis, attribution, and semantic graph construction.
- `src/analysis/confidence.ts` — confidence scoring and health bands.
- `src/lineage.ts`, `src/columns.ts`, and `src/columnflow.ts` — query and
  column lineage.
- `src/catalogue.ts` — explicit catalogue resolution.
- `src/report.ts` — report/dataset import and graph construction.
- `src/exporters.ts` — graph layout, Mermaid, SVG, draw.io, and narration.
- `src/workspace.ts` — opt-in browser persistence and presentation filters.
- `src/schema.ts` and `src/erd.ts` — declared-constraint schema IR, ERD layout,
  and layout files for the ERD page.
- `src/query.ts` — ERD query builder: join-graph pathfinding over declared
  foreign keys and dialect-quoted SQL emission.
- `src/ui/erd-page.ts` and `src/ui/erd-query.ts` — ERD interaction, query-mode
  checkboxes and overlay highlighting, the join plan, and the floating SQL
  window.
- `src/ui/large-input.ts` and `src/app.ts` — browser interaction and the
  large-input responsiveness policy.

The ERD query builder follows declared foreign-key evidence only. Picked
columns that the declared graph cannot connect become explicit problems with
three resolutions: teach the join by hand (labelled "not declared" in the plan
and SQL), opt into a CROSS JOIN, or leave the columns out. It never silently
produces a cartesian product, and it never drops a pick from the SQL without
naming it in the provenance comment. See
[QUERY_BUILDER.md](QUERY_BUILDER.md) and
[ADR-001](decisions/ADR-001-declared-evidence-query-builder.md).

```text
DDL -> schema IR -> query join graph -> join plan (paths, bridges, problems)
                                            |-> SQL options -> dialect SQL
                                            |-> decoration -> cards / overlay
```

`src/query.ts` is pure and DOM-free: graph construction, shortest-path
selection, plan building, SQL emission, and the highlighting tokenizer.
`src/ui/erd-query.ts` owns the panel state and events; `src/ui/erd-page.ts`
consumes the decoration contract (`erdQueryPanelState`) to draw checkboxes,
plan highlights, and problem rings.

## Design invariants

1. Source spans travel with analysis results so findings can be inspected.
2. Unknown, dynamic, ambiguous, and unresolved constructs remain explicit.
3. Presentation filters do not mutate analysis counts or semantic edges.
4. Export ordering and layout are deterministic for the documented graph
   classes.
5. Persistence is opt-in and local to the browser.
6. Query-builder joins use declared foreign-key evidence only; unjoinable picks
   stay explicit, and a cartesian product is never silent.

The v1.14 layout implementation uses bounded, deterministic placement and an
iterative graph traversal for cycle detection, avoiding a call-stack limit for
large linear or cyclic graphs. Layout is a usability guarantee for the tested
graph classes, not a claim that every arbitrary graph has crossing-free edges.
