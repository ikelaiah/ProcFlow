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
- `src/ui/large-input.ts` and `src/app.ts` — browser interaction and the
  large-input responsiveness policy.

## Design invariants

1. Source spans travel with analysis results so findings can be inspected.
2. Unknown, dynamic, ambiguous, and unresolved constructs remain explicit.
3. Presentation filters do not mutate analysis counts or semantic edges.
4. Export ordering and layout are deterministic for the documented graph
   classes.
5. Persistence is opt-in and local to the browser.

The v1.14 layout implementation uses bounded, deterministic placement and an
iterative graph traversal for cycle detection, avoiding a call-stack limit for
large linear or cyclic graphs. Layout is a usability guarantee for the tested
graph classes, not a claim that every arbitrary graph has crossing-free edges.
