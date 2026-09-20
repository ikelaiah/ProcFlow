# ADR-003: Aggregates derive GROUP BY from the remaining picks

## Status

Accepted

## Date

2026-09-21

## Context

The query builder selects detail rows. The most common analytical follow-up is
"group these rows and count/sum them" — orders per customer, revenue per
product, and so on. The feature has to fit a builder with no predicate editor
and no expression language, and it must stay explainable.

Three questions had to be answered:

1. How does the user mark a column as aggregated?
2. What becomes the `GROUP BY` list?
3. How does the file format carry the new state without breaking v2.5.0
   files?

## Decision

1. **Per-picked-column aggregate selector.** Each picked-column chip gains a
   small selector with `—`, `COUNT`, `COUNT DISTINCT`, `SUM`, `AVG`, `MIN`,
   `MAX`. There is no expression editor and no `COUNT(*)`; `COUNT(column)`
   ignores NULLs, which the documentation states.
2. **`GROUP BY` is the non-aggregated picks, in pick order.** Choosing an
   aggregate never asks a second question; the remaining columns group the
   result automatically. If every pick is aggregated, `GROUP BY` is omitted.
3. **`DISTINCT` yields to `GROUP BY`.** With any aggregate present, the
   Distinct toggle is disabled and the generated SQL drops `DISTINCT`, with a
   provenance note explaining that `GROUP BY` already collapses rows.
4. **Ordering may target the aggregate expression.** A sort on an aggregated
   column emits `ORDER BY COUNT(...) DESC` rather than a column reference.
5. **File format version 2.** `aggregates` is a new options field; version-1
   files are still accepted and migrate forward with an empty map, exactly as
   the workspace schema migrates. Version 3+ is rejected.

The plan and SQL stay deterministic: aggregates are a keyed map
(`entityId|COLUMN` → function) in selection order, expressions always get a
deterministic alias (`count_orderheader_orderid`), and unknown functions are
ignored rather than guessed.

## Alternatives Considered

### A HAVING / predicate builder
- Pros: filters on aggregates are common (`HAVING COUNT(*) > 5`).
- Cons: requires an expression and comparison UI that the builder deliberately
  does not have; half a predicate language is worse than none.
- Rejected for v2.6.0; the generated SQL is copy-ready and editable where it
  runs.

### Explicit GROUP BY selection
- Pros: maximum control, including grouping by a column that is not selected.
- Cons: a second multi-select for a decision that is almost always "group by
  everything else"; more UI, more invalid states.
- Rejected: derive it, and document the rule.

### `COUNT(*)` as a separate row-count aggregate
- Pros: the classic row count.
- Cons: needs a synthetic selection not tied to a column, which the chip model
  has no place for.
- Rejected: `COUNT` on the primary key counts rows; the docs say so.

### Window functions (`OVER (PARTITION BY ...)`)
- Pros: detail rows plus aggregates, no row collapse.
- Cons: a second query paradigm with its own education burden; the builder's
  one-job contract is grouping.
- Rejected for v2.6.0.

### Bump the file format without migration
- Pros: less code.
- Cons: breaks queries saved with v2.5.0, violating the persistence contract.
- Rejected: accept v1, migrate to v2 on read.

## Consequences

- Aggregates are easy to reach and hard to get wrong: one selector per column,
  and the group list is never silently surprising.
- `HAVING`, window functions, and `COUNT(*)` remain out of scope and are
  documented as such.
- The provenance header now records `Grouped by` and `Aggregates` lines, so a
  copied statement explains itself.
- Query files remain backward compatible; the version field earns its keep on
  its first real change.
