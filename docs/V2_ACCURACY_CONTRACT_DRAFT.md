# ProcFlow v2 accuracy contract — draft

> Draft only. This is a proposed compatibility and correctness contract; it
> does not promise a v2 release or broaden the current v1.14.1 feature set.

## Purpose and scope

ProcFlow is a local-first, deterministic static SQL analyser. It is not a
database compiler, an execution engine, or a database connection. The contract
defines what an analysis result means when ProcFlow can prove a relationship,
and what it must do when it cannot.

## Analysis guarantees

1. **No silent drops.** Every source region that participates in analysis is
   represented as resolved, intentionally ignored under a documented rule,
   opaque, or unresolved. Opaque and unresolved regions have a source span and
   a diagnostic unless a documented informational annotation is more fitting.
2. **No invented semantic facts.** ProcFlow must not infer an object identity,
   call, dependency, control path, column binding, or data edge from a name
   alone. When static evidence is insufficient, it uses an external/ambiguous
   identity or an opaque/unresolved region.
3. **Provenance.** Every source-derived node carries valid source span(s).
   Synthetic nodes declare why they exist. External nodes retain the complete
   referenced identity and the reference span(s), not only a final name part.
4. **Conservative degradation.** Unsupported, malformed, dynamic, or
   ambiguous SQL may reduce analysis precision, but it must not silently
   upgrade uncertainty to certainty. A failure in one region does not make
   unrelated regions untrustworthy.

## Graph semantics

The graph is one semantic model rendered by the UI and exports. Edge kinds are
stable and mutually meaningful:

| Kind | Meaning |
| --- | --- |
| `control` | A statically established possible order of execution, including labelled branch and loop outcomes. It is not a claim that every runtime execution takes the edge. |
| `exception` | A statically modelled transfer into a compatible handler or terminal error path. It is not a claim to model every database runtime error. |
| `call` | A statically identified procedure/function invocation. Dynamic statement names and prepared SQL are opaque, not calls. |
| `dependency` | A statically identified read/write/reference relationship to an object. Unverified identity stays external or unresolved. |
| `data` | A producer-to-consumer relationship with a unique, conservatively proven reaching definition. Branch or loop ambiguity must suppress the edge and explain why. |
| column/data-flow edge | A binding or transformation supported by explicit scope, projection, and source evidence. Ambiguous stars, names, or bindings remain ambiguous/opaque. |

Changing the meaning of an existing edge kind, or converting formerly opaque
data into an asserted edge without a documented correctness basis, is breaking.

## Diagnostics and confidence

- Diagnostic codes are stable identifiers, namespaced by feature where useful
  (for example `dynamic_sql`, `catalogue_conflict`, `column_opaque`).
- Severity is `error`, `warning`, or `info`. `info` describes a resolved
  construct and must not inflate warnings/errors in reviewer-facing counts.
- Region diagnostics have valid half-open source spans; document diagnostics
  explicitly use document scope and no fabricated one-character span.
- Each diagnostic states what could not be proven, what portion is affected,
  and whether the analyser deliberately stayed conservative.
- Confidence is versioned and explainable. It must not rise solely because
  tokens were consumed, and it cannot convert opaque or ambiguous regions into
  resolved facts.
- A code may be deprecated only with a compatibility mapping and at least one
  major-version notice period, except a security correction that prevents a
  false semantic claim.

## Workspace format and migrations

Workspace files carry an explicit format version. A newer ProcFlow version
must either migrate an older supported version deterministically, preserving
source text and analysis settings, or reject it with a clear, non-destructive
diagnostic. It must never reinterpret saved source text or silently discard
unknown fields. Future fields are retained when feasible; otherwise export
warns before information loss. Migration behaviour, supported source versions,
and intentional lossy migrations are documented and regression-tested.

## Export fidelity

Mermaid, SVG, and draw.io are alternate renderings of the same graph. Semantic
fidelity means that all formats preserve the selected graph's node identities,
labels, edge endpoints, edge kinds, object identity, source provenance, and
synthetic-node origin. Renderer layout and styling may differ only where they
do not change semantic interpretation. Export parity fixtures compare semantic
manifests, validate draw.io XML, and ensure exported metadata remains
traceable. An export that cannot represent a semantic attribute must label the
loss; it must not substitute a different fact.

## Security and privacy

The runtime remains local-first: no backend requirement, telemetry, automatic
SQL transmission, cloud storage, database connection, or SQL execution. Input
and export text are treated as hostile. Browser storage is opt-in; clipboard,
workspace import/export, and file access remain explicit user actions. Mermaid
and XML rendering retain strict escaping and security regression coverage.

## Compatibility and breaking changes after v2

A major-version change is required for any incompatible workspace migration,
removal or material reinterpretation of a public graph field/edge kind,
diagnostic-code removal without mapping, export metadata removal, changed
confidence formula without a versioned explanation, or altered local-first
privacy guarantees. A confirmed correction to a false semantic assertion may
be shipped in a patch release when it has a failing-first fixture, a documented
before/after rationale, and preserves uncertainty rather than fabricating a
replacement. New dialect support, execution, remote services, or telemetry are
outside this contract unless separately specified and accepted.

## Suggested v2 release evidence

- All historic regression, fuzz, browser, security, packaging, and export
  suites pass.
- Each supported dialect has realistic combination fixtures covering static,
  ambiguous, and dynamic forms.
- The adversarial semantic-assertion rate is published with its fixture matrix
  and has no unexplained regression.
- Every intentional golden correction links to a minimal reproduction and an
  accuracy rationale.
