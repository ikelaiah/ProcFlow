# Glossary

The vocabulary the documentation and the UI share. If a term here is used
without definition elsewhere, that is a bug — please report it.

## Analysis

| Term | Meaning |
| --- | --- |
| **Attribution** | Every analysed body token is classified as consumed, intentionally ignored, or unresolved. Nothing is silently dropped. |
| **Coverage** | The percentage of body tokens the parser consumed. High coverage cannot turn opaque dynamic SQL into a resolved fact. |
| **Confidence** | A versioned headline: dialect certainty × token-weighted region quality × `(0.6 + 0.4 × coverage)`. Formula version `1.6.0`. |
| **Source span** | A half-open `[start, end)` character range in the input. Every finding carries one so it can be inspected back to the source. |
| **Opaque region** | A region SQL Cartographer cannot resolve — typically dynamic SQL or an ambiguous construct. It is drawn and diagnosed explicitly rather than guessed at. |
| **Diagnostic** | A structured `error` / `warning` / `info` note with a stable code, a message, and a document or region scope. |
| **Estate** | The set of objects a script defines or references, with their relationships. |
| **Provenance** | Where a fact came from. See *node provenance*. |
| **Declared evidence** | A fact stated in the input DDL — a `PRIMARY KEY`, `UNIQUE`, or `FOREIGN KEY` constraint. Column names are never evidence. |

## Graph

| Term | Meaning |
| --- | --- |
| **Node provenance** | `source` (parsed from your input), `external` (referenced but not defined here), or `synthetic` (derived by SQL Cartographer, origin declared). |
| **Edge kind** | `control`, `exception`, `data`, `dependency`, or `call`. Each asserts exactly one thing and refuses to assert more — see [V2_ACCURACY_CONTRACT.md](V2_ACCURACY_CONTRACT.md). |
| **Semantic Graph** | The analysis result: nodes and edges with source spans and diagnostics. Exporters read it without mutating it. |
| **Construct coverage** | Per-construct counts of detected / resolved / opaque, so a reviewer can see *what kind* of uncertainty exists rather than a single number. |
| **Token attribution** | Connecting a diagnostic or diagram node back to the exact input characters that produced it. |

## Query builder

| Term | Meaning |
| --- | --- |
| **Join graph** | Tables and views with declared columns as nodes, declared foreign keys as edges. Undirected, purely from DDL. |
| **Join plan** | The tree of joins the builder will emit: the `FROM` table, the attached tables, their bridges, and any problems. |
| **Bridge table** | A table on the path between two picked tables that you did not pick. It is joined and tagged, and its columns are never selected. |
| **Taught join** | A join you supplied because the declared graph had no path. Labelled `taught join — not declared` in the plan and the SQL; SQL Cartographer states it cannot verify it. |
| **Self join** | Two picks on the same table. It is added twice as `table` and `table_2`, and you choose which picked columns read from the second copy. |
| **Problem card** | A picked table the declared graph cannot reach. It always has exactly three resolutions: teach the join, opt into `CROSS JOIN`, or leave the columns out. |
| **Row policy** | The rule choosing `INNER` versus `LEFT` per join so rows are preserved by default. See [QUERY_BUILDER.md](QUERY_BUILDER.md#join-direction-and-row-policy). |
| **Fingerprint** | A short deterministic hash of the schema, used to prune stale entries from a restored saved query and to key layout files. |

## Reports and catalogues

| Term | Meaning |
| --- | --- |
| **Dataset** | A query inside an SSRS/RDL report. Embedded datasets contribute analysed SQL; shared and unresolved datasets stay explicit with diagnostics. |
| **Catalogue** | Explicit object-resolution input — JSON or a line format. Only exact full-name matches and explicit synonyms resolve; partial, conflicting, or ambiguous matches stay external with a diagnostic. |
| **RDL** | Report Definition Language, the SSRS report XML format. |

## Persistence

| Term | Meaning |
| --- | --- |
| **Opt-in persistence** | Nothing is written to browser storage until you choose Save. Three independent keys: workspace snapshot, ERD layout, and one saved query. Forgetting one never drops the others. |
| **Workspace** | A portable JSON snapshot of files, options, catalogue, and report. Schema-versioned; older schemas migrate deterministically, newer ones are rejected rather than guessed at. |
| **Stale pruning** | On restore, references that no longer exist in the schema are dropped, counted, and reported — never silently applied. |
