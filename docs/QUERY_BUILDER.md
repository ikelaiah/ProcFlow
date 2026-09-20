# ERD query builder

The query builder lives on `erd.html`. Toggle **Query builder**, tick columns
on the table cards, and a floating window shows the SQL, the join plan, and
anything the declared DDL cannot connect. This document explains how the plan
is chosen, what is guaranteed, and what is deliberately out of scope. The
decision record is [ADR-001](decisions/ADR-001-declared-evidence-query-builder.md).

## The declared-evidence rule

Every join comes from a declared `PRIMARY KEY`, `UNIQUE`, or `FOREIGN KEY`
constraint parsed from the DDL. ProcFlow never infers a relationship from a
column name, a query body, or a convention like `*_id`. Two consequences:

- If the database has an implicit relationship that was never declared, the
  builder cannot see it. It says so and lets you teach the join.
- If two declared paths reach the same table, both are shown and you choose.

## How joins are chosen

The schema becomes an undirected graph: tables and views with declared columns
are nodes, declared foreign keys are edges. External (unresolved) targets and
objects without declared columns are not selectable; they are listed with the
reason in the picker notes.

Path cost prefers declared evidence over teaching:

| Edge | Weight | Meaning |
| --- | --- | --- |
| Exact foreign key | 1 | The target table is declared in this DDL |
| Name-matched foreign key | 3 | The target resolved by unique last name only; shown with a warning |
| Taught join | 5 | You supplied the condition; never used while a declared path exists |

The plan grows a join tree from the first picked table (the `FROM` table). At
each step the closest remaining picked table is attached along a shortest path;
tables on that path that you did not pick become **bridge tables** — they are
joined and tagged, but their columns are never selected. Because ties keep
declaration order, the same schema plus the same picks always produce the same
plan and SQL.

When several shortest paths tie, the plan lists them under "Two declared paths
reach …". The first declared constraint is used until you pick another; the
choice only changes which constraint is followed, never invents an edge.

## Join direction and row policy

Direction matters more than most builders admit. The policy is **preserve** by
default:

| Attachment | Default | Why |
| --- | --- | --- |
| Child → parent, required FK | `INNER JOIN` | Every child row has a parent; nothing is lost |
| Child → parent, nullable FK | `LEFT JOIN` | Some child rows have no parent; keep them as NULLs |
| Parent → child (any FK) | `LEFT JOIN` | Parents may have no children; keep them |

**Strict** mode uses `INNER JOIN` everywhere, and each join card has its own
INNER/LEFT switch. Every card also carries a sentence explaining the direction,
optionality, and whether the join can repeat rows. A one-to-many traversal adds
a plan warning; when it does, a tip offers `DISTINCT`.

## Unjoinable picks

A pick the declared graph cannot connect to the `FROM` table becomes a problem
card, and the table gets a coral ring on the diagram. There are exactly three
resolutions, and none of them is silent:

1. **Teach the join.** Provide a column pair, type a predicate, or click two
   columns on the diagram. The plan and the SQL header label it
   `taught join — not declared`, and the explanation states that ProcFlow
   cannot verify it.
2. **CROSS JOIN.** Explicit opt-in for a cartesian product, labelled in the SQL
   with a row-count warning.
3. **Leave the columns out.** They are removed from the query, and the SQL
   header names them under `Not included` with the reason.

Unjoined picks are never dropped from the SQL without that header note, and a
cartesian product is never produced silently.

## Self joins

Two clicks on the same table in teaching mode create a self join. The table is
added twice: the primary alias and a `_2` alias (for example `customer` and
`customer_2`). The join card then lists your picked columns from that table and
lets you tick which ones read from the second copy. The SQL header documents
the alias as `second copy, self join: <columns>`. Only one self join per table
is applied; a second one is reported and ignored.

Self joins only apply to a table that already has a picked column. A self join
on an unpicked table is ignored with a warning.

## SQL emission

The generated SQL is dialect-quoted for T-SQL, PostgreSQL, DB2, and SQLite, and
is read-only: copy it and edit where you run it. Options:

- **Dialect** — identifier quoting only; the plan itself is dialect-neutral.
- **Distinct** — collapses duplicate rows, including duplication introduced by
  one-to-many joins.
- **Rows** — `TOP n` (T-SQL), `LIMIT n` (PostgreSQL, SQLite), or
  `FETCH FIRST n ROWS ONLY` (DB2).
- **Sorts** — the arrow on a picked-column chip cycles ascending, descending,
  and off. Only picked columns can be ordered.
- **Comments** — the provenance header: alias map, join constraints, options,
  warnings, and anything left out.

Aliases are derived from table names (`dbo.OrderHeader` → `orderheader`) with
deterministic `_2` suffixes on collision, and duplicate column names across
tables are aliased (`customer_email`, `appuser_email`). Syntax highlighting is
purely visual: the concatenated token text is byte-identical to the SQL, so
Copy always copies the raw statement.

## What it never does

- No inferred joins, ever. Column names are not evidence.
- No silent cartesian products and no silent row caps.
- No execution, validation, or connection to a database.
- No multiple instances of the same table except the explicit self-join copy.
- No persistence: picks and options are session state; only ERD layouts are
  saved (opt-in).

## Verification

The engine is covered by the golden query-builder suite in `tests/query.ts`
(join graph, pathfinding and alternatives, bridges, policies, taught and self
joins, disconnected selections, dialect quoting, options, highlighting
round-trip, determinism, and a 1,000-table chain). The interaction layer is
covered by `tests/erd-ui.html`. See
[DEVELOPMENT.md](DEVELOPMENT.md) for how to run both.
