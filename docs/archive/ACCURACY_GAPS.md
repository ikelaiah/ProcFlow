# Accuracy gaps — v1.14.1 post-release audit

This report records reproduced outcomes from an adversarial synthetic corpus
run against the released v1.14.0 baseline. The corpus contains no proprietary
SQL and no external SQL dumps. It exercised 38 primary cases: 12 T-SQL, 10
PL/pgSQL, 8 DB2 SQL PL, and 8 SQLite. Follow-up minimisations confirmed the
three findings below.

The audit intentionally distinguishes an unsupported construct from a defect.
There are no open reproduced P0/P1/P2/P3 items at the end of this audit.
The three reproduced defects below are fixed in v1.14.1.

## T-SQL

No reproduced open items. Twelve cases covered nested `IF`/`ELSE`, nested
`TRY`/`CATCH`, cursor loops, `GOTO`, dynamic `EXEC`, recursive CTEs,
correlated subqueries, derived tables, `APPLY`, quoted schema-qualified names,
`MERGE`, and window expressions.

## PL/pgSQL

### PF-AUD-001 — resolved

| Field | Record |
| --- | --- |
| Severity | P1 — silent omission |
| Dialect | PL/pgSQL |
| Minimal reproduction | `SELECT * FROM app.base b JOIN LATERAL app.expand_rows(b.id) x ON true;` |
| Previous behaviour | The query graph showed `app.base` only; `app.expand_rows` disappeared. It reported 100% coverage, confidence `1`, and no diagnostic. |
| Expected behaviour | Both statically named sources remain dependency nodes. The function name is an exact syntactic identity; its rows remain subject to normal SQL semantics. |
| Source/provenance | The complete query node retained span `0..69`; the omitted source had no node, span, or provenance to inspect. |
| Fix | `refsIn` now advances past `LATERAL` and records a following named source, while retaining the existing nested-subquery handling. |
| Regression fixture | Yes — `PL/pgSQL query · LATERAL function source remains visible`. |
| Status | Fixed in v1.14.1 and verified. |

The broader PL/pgSQL set also covered nested exception blocks, labelled
`FOR`/`EXIT`/`CONTINUE`, `EXECUTE`, recursive CTEs, `UPDATE ... FROM`,
`DELETE ... USING`, `RETURNING`, quoted identifiers, and early `RETURN`.

## DB2 SQL PL

### PF-AUD-002 — resolved

| Field | Record |
| --- | --- |
| Severity | P0 — invented dependency/call |
| Dialect | DB2 SQL PL |
| Minimal reproduction | `CREATE PROCEDURE APP.PREPARED() LANGUAGE SQL BEGIN PREPARE stmt FROM statement_text; EXECUTE stmt; END` |
| Previous behaviour | ProcFlow asserted `reads statement_text` and `calls stmt`, with confidence `1` and no diagnostic. `stmt` is a prepared-statement name, not a procedure identity; `statement_text` is a statement expression/host variable, not an object reference. |
| Expected behaviour | Preserve the sequencing but render `EXECUTE stmt` as opaque dynamic SQL, report `dynamic_sql` at its span, and add neither object dependency. |
| Source/provenance | The source spans of `PREPARE` and `EXECUTE` were valid, but the estate graph fabricated external nodes for `statement_text` and `stmt`. |
| Fix | DB2 `EXECUTE` is classified as dynamic SQL (static invocation uses `CALL`); `PREPARE ... FROM` no longer passes its expression to generic `FROM` reference extraction. |
| Regression fixture | Yes — `DB2 prepared SQL stays opaque and never becomes object dependencies`. |
| Status | Fixed in v1.14.1 and verified; post-fix confidence is `0.8`, coverage remains `1`, and `dynamic_sql` is region-scoped. |

### PF-AUD-003 — resolved

| Field | Record |
| --- | --- |
| Severity | P1 — missing data-flow edge |
| Dialect | DB2 SQL PL |
| Minimal reproduction | `DECLARE GLOBAL TEMPORARY TABLE SESSION.WORK (ID INTEGER); INSERT INTO SESSION.WORK SELECT ID FROM APP.SOURCE_ROWS; SELECT ID FROM SESSION.WORK;` |
| Previous behaviour | Control edges remained, but the unique producer-to-consumer `data` edge was absent (`dataflow: 0`), with confidence `1` and no diagnostic. |
| Expected behaviour | `INSERT INTO SESSION.WORK` → `SELECT ... FROM SESSION.WORK` carries a `data` edge labelled `SESSION.WORK` when the producer is unique and sequential. |
| Source/provenance | Both source statements had valid spans; the omitted relationship had no graph representation. |
| Fix | The reaching-definition flow recognises DB2 `SESSION.` global temporary-table names in addition to T-SQL `#` names. |
| Regression fixture | Yes — `DB2 graph · session temporary-table producer feeds consumer`. |
| Status | Fixed in v1.14.1 and verified. |

The remaining DB2 cases covered `ATOMIC` blocks, `EXIT`/`CONTINUE` handlers,
labels with `LEAVE`/`ITERATE`, cursors, recursive CTEs, `MERGE`, conditional
`SIGNAL`/`CALL`, and prepared execution.

## SQLite

No reproduced open items. Eight cases covered trigger `WHEN`, nested
`EXISTS`, recursive CTEs, `UPDATE ... FROM`, `DELETE`/`INSERT RETURNING`,
`RAISE(ABORT, ...)`, quoted identifiers, and savepoint control.

## Cross-dialect / core IR

No reproduced open items. The audit verified that static dynamic-SQL forms
already handled by the product (`EXEC(@q)`, `EXEC @q`, and PL/pgSQL `EXECUTE
q`) remain opaque and span-attached. DB2 prepared execution now follows the
same conservative rule.

## Column lineage

No reproduced open items. The corpus included stars, duplicate-looking names,
CASE expressions, aggregations/windows, aliases, correlated subqueries, and
quoted identifiers. Representative ambiguous cases reported the existing
`column_opaque`/`column_flow_opaque` signals rather than invented bindings.

## Dependencies

No reproduced open items after PF-AUD-001 and PF-AUD-002. The audit checked
same-looking objects in separate quoted schemas, CTE identity, static calls,
and dynamic execution. Static identity must remain exact or external; dynamic
SQL must not create a call or dependency edge.

## Reports / RDL

No newly reproduced item. Existing RDL, shared/embedded dataset, report graph,
and export fixtures remained part of the release verification. This audit did
not add third-party report definitions.

## Diagnostics / confidence

No reproduced open P2 item. Representative unresolved regions answer the
review questions: dynamic SQL reports `dynamic_sql` with a region span and a
clear statement that internals are not resolved; malformed input reports an
unresolved region; low-confidence detection is document-scoped. The resolved
findings above demonstrate an important metric limitation: 100% attribution
and even confidence `1` did not detect a missing LATERAL source, a fabricated
DB2 call, or an omitted DB2 temporary-table data edge.

## Metric assessment

The published v1.14.1 snapshot remains internally current: attribution,
semantic-edge coverage, provenance, diagnostic-span coverage, export parity,
and traceability are all `1`; unresolved-token rate is `0.043447`; opaque
dynamic rate is `0.005111`; and the corpus totals 2,739 tokens across 278
statement regions. These measures are valuable invariants, but they are not a
semantic oracle. In particular, they did not catch a valid source omitted by a
recognised query construct or an incorrect interpretation of a recognised
statement form.

For v2, add a **dialect adversarial semantic-assertion rate**: pass rate for a
small, versioned matrix of realistic combinations that asserts required and
forbidden object, call, data, and opaque edges by dialect. It complements
rather than replaces the current edge-fixture pass rate: the matrix must
include both positive static cases and unsafe/dynamic cases such as DB2
`PREPARE`/`EXECUTE`. This detects the defect class that attribution and generic
coverage cannot see.
