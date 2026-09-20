# ADR-001: Declared-evidence-only query builder

## Status

Accepted

## Date

2026-09-21

## Context

The ERD page already parses DDL into a conservative model of declared tables,
columns, and keys. The next step was to let a user pick columns and get runnable
SQL. That forces a decision about what may become a join.

ProcFlow's standing contract (see [ACCURACY.md](../ACCURACY.md) and the
[V2 accuracy contract](../V2_ACCURACY_CONTRACT.md)) is that diagrams assert only
statically evidenced facts, stay deterministic, and run entirely in the
browser. A query builder that guesses joins would violate that contract more
visibly than a diagram ever could: wrong SQL returns wrong data.

The practical constraint is that many real schemas contain implicit
relationships — matching columns with no `FOREIGN KEY` — and users still want
to query them.

## Decision

Build the join graph from declared foreign keys only, and make every other case
explicit:

1. Paths prefer exact foreign keys (weight 1) over name-matched ones (3) over
   user-taught joins (5); a declared path always wins over a taught one.
2. Equal-cost paths are surfaced as a choice; the first declaration is the
   deterministic default.
3. Tables the declared graph cannot reach become problems with exactly three
   resolutions: a taught join labelled "not declared" everywhere, an explicit
   `CROSS JOIN`, or exclusion with the omitted columns named in the SQL header.
4. A cartesian product is never produced silently.
5. The generated SQL is read-only and derived; editing happens where it runs.

The full behavior is documented in [QUERY_BUILDER.md](../QUERY_BUILDER.md).

## Alternatives Considered

### Infer joins from column-name conventions
- Pros: works on undeclared schemas with no user input; familiar from ORM
  tooling.
- Cons: silently wrong when names collide or mean different things; violates
  the no-invented-facts contract; impossible to distinguish "correct" from
  "plausible".
- Rejected: the failure mode is bad SQL that looks authoritative.

### Automatic `CROSS JOIN` for disconnected picks
- Pros: always produces runnable SQL; never blocks the user.
- Cons: a cartesian product over production tables is a foot-gun; the row count
  is invisible in the SQL.
- Rejected: an explicit opt-in keeps the user in control.

### Editable SQL panel as the source of truth
- Pros: full flexibility; no need for taught joins.
- Cons: the panel would drift from the plan; re-picking columns could not
  safely update an edited statement; provenance labels would become lies.
- Rejected: keep SQL derived; copy it out to edit.

### Require a taught join before selecting a disconnected column
- Pros: guarantees every generated statement is complete.
- Cons: blocks exploratory picking; users learn what is missing only at the
  end.
- Rejected: problems are surfaced continuously instead, with one-click
  resolutions.

### Server-side or LLM-assisted join inference
- Pros: could resolve implicit relationships at scale.
- Cons: breaks local-only processing, determinism, and offline use.
- Rejected: out of scope for a static browser application.

## Consequences

- Users on schemas without declared keys must teach joins or add constraints;
  the builder tells them exactly which table and why.
- Name-matched foreign keys remain usable but carry a warning and a heavier
  path weight.
- One instance per table is modelled, except the explicit self-join copy;
  multi-instance aliasing beyond that is future work.
- Taught joins and self joins are never presented as verified facts, in the
  plan, the diagram, or the SQL header.
- The engine is deterministic and covered by golden fixtures plus a committed
  browser suite, so the contract can be enforced in CI rather than by review.
