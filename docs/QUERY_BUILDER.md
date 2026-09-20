# ERD query builder

The query builder lives on `erd.html`. Toggle **Query builder**, tick columns
on the table cards, and a floating window shows the SQL, the join plan, and
anything the declared DDL cannot connect. This document explains how the plan
is chosen, what is guaranteed, and what is deliberately out of scope. The
decision records are
[ADR-001](decisions/ADR-001-declared-evidence-query-builder.md),
[ADR-002](decisions/ADR-002-query-persistence.md), and
[ADR-003](decisions/ADR-003-aggregates-derive-group-by.md).

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

## Aggregates and grouping

Each picked-column chip has a small selector: `—`, `COUNT`, `COUNT DISTINCT`,
`SUM`, `AVG`, `MIN`, `MAX`. Choosing one turns that column into an aggregate
expression; **every other picked column becomes the `GROUP BY` list, in pick
order**. If every pick is aggregated, `GROUP BY` is omitted and the query
returns one row.

```sql
SELECT
  customer.[Email],
  COUNT(orderheader.[OrderId]) AS count_orderheader_orderid
FROM [dbo].[Customer] AS customer
LEFT JOIN [dbo].[OrderHeader] AS orderheader
  ON customer.[CustomerId] = orderheader.[CustomerId]
GROUP BY customer.[Email];
```

- Aggregate expressions always get a deterministic alias
  (`count_orderheader_orderid`, `sum_orderline_quantity`).
- Sorting an aggregated column orders by the expression:
  `ORDER BY COUNT(orderheader.[OrderId]) DESC`.
- `DISTINCT` is redundant with `GROUP BY`: the toggle is disabled while an
  aggregate is set, and the provenance header says the clause was ignored.
- The header records both lists — `Grouped by: …` and `Aggregates: …` — so a
  copied statement explains itself.
- A plan tip warns that `SUM`/`AVG` over a one-to-many join can multiply
  unless the detail rows are pre-aggregated.

Limits, stated plainly: there is no `HAVING` clause, no window functions, and
no `COUNT(*)` — `COUNT(column)` ignores NULLs, so count a `NOT NULL` key for
row counts. `GROUP BY` covers picked columns only. See
[ADR-003](decisions/ADR-003-aggregates-derive-group-by.md).

## Saving, exporting, and restoring

Picks and options are session state by default. The **Query** menu keeps them
across reloads and moves them between machines, all locally:

- **Save to this browser** stores one query under `procflow.erd.query`.
  **Restore saved** brings it back; **Forget saved** removes it. Nothing is
  stored automatically, matching the ERD layout and workspace rules.
- **Export query file** writes a versioned JSON file. **Import query file**
  reads one back.
- **Download .sql** writes the statement as a file, respecting the Comments
  toggle. The name field (optional) drives both filenames; without it, the
  schema fingerprint is used.

The file format is small and stable:

```json
{
  "format": "procflow-erd-query",
  "version": 2,
  "fingerprint": "f971b08a",
  "name": "orders by customer",
  "selections": [{"entityId": "DBO.ORDERHEADER", "column": "OrderId"}],
  "manual": [], "cross": [], "excluded": [],
  "joinTypes": {}, "pathChoices": {},
  "options": {"dialect": "tsql", "comments": true, "distinct": false,
              "rowLimit": 0, "onlyUsed": false, "sorts": [],
              "aggregates": {}}
}
```

Version-1 files (written before aggregates existed) still load: the missing
field migrates to an empty map on read. Files from a newer version are rejected
with a diagnostic rather than guessed at.

Restoring is never blocked by drift. References that no longer exist — tables,
columns, taught joins, sorts, cross/excluded ids, path choices — are dropped
and counted, and a changed schema is named in the status line ("Restored
"orders by customer": 6 picks · dropped 2 stale entries · schema changed.").
Foreign formats, future versions, and malformed JSON are rejected with a
diagnostic instead. See
[ADR-002](decisions/ADR-002-query-persistence.md) for why the store is one
explicit slot per browser rather than an auto-saved library.

## What it never does

- No inferred joins, ever. Column names are not evidence.
- No silent cartesian products and no silent row caps.
- No execution, validation, or connection to a database.
- No multiple instances of the same table except the explicit self-join copy.
- No `HAVING`, window functions, or `COUNT(*)`; aggregate support is `GROUP BY`
  over picked columns only.
- No automatic storage: a query is saved only when you choose Save, and only
  one saved query exists per browser. Layouts and queries are independent
  keys, so forgetting one never drops the other.

## Verification

The engine is covered by the golden query-builder suite in `tests/query.ts`
(join graph, pathfinding and alternatives, bridges, policies, taught and self
joins, disconnected selections, dialect quoting, options, highlighting
round-trip, determinism, a 1,000-table chain, and query-store round-trip,
rejection, pruning, fingerprint, and storage records). The interaction layer is
covered by `tests/erd-ui.html` (query mode, picking, teaching, self joins,
options, resize, Find, only-used filter, import, and browser save/restore). See
[DEVELOPMENT.md](DEVELOPMENT.md) for how to run both.
