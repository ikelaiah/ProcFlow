# proc>flow v1.1.0 — Trustworthy semantic foundation

**Release date:** 2026-08-04

This release delivers the **Trustworthy semantic foundation** milestone from the
[ROADMAP.md](../ROADMAP.md). It makes accuracy, uncertainty, and export parity
explicit in the model before expanding parser coverage in later releases.

## What's new

### Semantic edge kinds

Every graph edge now carries a recognised semantic kind:

- `control` — normal control-flow edges
- `exception` — error/exception transfer edges (dotted)
- `data` — data-flow edges (reads/writes)
- `dependency` — query dependency edges
- `call` — procedure/function call edges

Exporters derive presentation style from the edge kind rather than storing
semantic state in a presentation string.

### Node provenance

Every graph node now declares its provenance:

- `source` — derived from source SQL, carrying one or more valid source spans
- `external` — external object references with complete identity
- `synthetic` — generated nodes that declare their origin

Synthetic nodes carry a `reason` explaining why they were created.

### Structured query references

Query references are no longer bare strings. Each reference now carries:

- object name
- source span
- role (`read` / `write` / `call` / `produce`)
- resolution (`exact` / `heuristic` / `opaque`)

### Token attribution

Every body token is now attributed to one of:

- a resolved construct
- deliberately ignored syntax (semicolons, block keywords) with a named category
- an unresolved/opaque region

Unattributed input creates an unresolved node plus a region-scoped diagnostic.

### Construct coverage

A new construct-coverage statistic reports the number of constructs detected,
resolved, and opaque across branches, loops, handlers, CTEs, and source
references. The denominator is inspectable.

### Diagnostic scopes

Diagnostics now carry an explicit `document` or `region` scope. Document-scoped
diagnostics (such as dialect ambiguity) are explicitly marked and do not
receive artificial one-character spans.

### Export provenance metadata

- **Mermaid:** a `%% proc>flow provenance` comment block records node id, class,
  provenance, source span, object identity, and synthetic origin.
- **draw.io:** vertices carry `data-procflow` attributes with provenance, spans,
  and object identity; edges carry `data-procflow-kind` with the semantic edge
  kind. Edge colors are derived from the canonical edge-kind mapping.

### Canonical rendering contract

A shared canonical mapping (`CANONICAL_NODE_STYLE`, `CANONICAL_EDGE_STYLE`,
`CANONICAL_EDGE_COLOR`) is used by both Mermaid and draw.io exporters, ensuring
the two renderings never disagree about nodes, edges, labels, or edge meaning.

## What's unchanged

- The v1.0.0 fixture corpus remains structurally unchanged except for the new
  semantic metadata.
- Parser/lineage expansion, data flow, confidence re-score, and layout
  replacement are deferred to later releases per the roadmap.
- The local-only, browser-only security model is unchanged.

## Files changed

- `src/types.d.ts` — semantic model: edge kinds, node provenance, structured
  references, diagnostic scopes, token attribution, construct coverage
- `src/ir.ts` — graph builder emits edge kinds and node provenance; token
  attribution and construct coverage computed in `analyse`; dependency graph
  carries edge kinds and provenance
- `src/lineage.ts` — structured query references with spans, roles, and
  resolution; query graph nodes carry provenance; edges carry `dependency` kind
- `src/exporters.ts` — canonical rendering contract; Mermaid provenance comment
  block; draw.io provenance metadata and edge-kind attributes
- `tests/tests.ts` — new v1.1.0 fixtures for semantic edge kinds, node
  provenance, token attribution, construct coverage, structured references,
  export provenance metadata, and diagnostic scopes
- `package.json` — version bumped to 1.1.0
- `README.md` — updated for v1.1.0

## Verification

- `npm run typecheck` — passes
- `npm run build` — passes
- `npm run test:file` — passes
- Golden, fuzz, and UI browser suites — green