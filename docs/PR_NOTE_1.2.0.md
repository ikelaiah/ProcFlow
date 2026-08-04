# PR: v1.2.0 — Trust statement boundaries

## Summary

This PR implements the **v1.2.0 — Trust statement boundaries** milestone from
`ROADMAP.md`. It ships Workstream A (statement-boundary hardening) in full,
plus the E boundary diagnostics (`dialect_ambiguous`, bracket/block balance)
with correct document/region scope. No existing golden changed: the fixture
corpus grew and every prior case remains structurally identical.

## What's included

### Statement boundaries (`src/dialects.ts`)

- Semicolons remain authoritative boundaries when present.
- Omitted semicolons are now split by dialect-aware statement grammar and
  control keywords; a newline is no longer required. Previously
  `newStatementHere` demanded a newline, so one-line semicolon-free statements
  such as `SET @x = 1 PRINT @x SELECT @x` collapsed into a single statement.
  They now parse into three statements.
- The SQLite `SELECT RAISE(...)` idiom stays one statement (`RAISE` does not
  split when it directly follows `SELECT`).
- The pre-existing `INSERT…SELECT`, `UPDATE…OUTPUT`, `MERGE`, and
  `CASE`-expression continuation guards are preserved.

### Number lexing (`src/tokenizer.ts`)

- `0x` / `0X` hexadecimal literals (`0x1F`, `0x1_000`).
- PostgreSQL-style underscore digit separators (`1_000`, `1_000_000`).
- Leading-point fractions (`.5`) and trailing-point forms (`1.`) besides the
  existing `1.5` exponent forms.
- Dotted object names (`dbo.t`) and `..` ranges are unaffected.

### Diagnostics (`src/ir.ts`, `src/dialects.ts`)

- New `dialect_ambiguous` document-scoped warning on low-confidence detection
  ties (auto mode, several dialects tied). It carries no artificial span.
- New `unexpected_end` region-scoped warning when a block-terminating keyword
  (`END`, `ELSE`, …, `UNTIL`) has no matching opener, reported alongside
  `unconsumed_input`.
- Existing bracket/paren balance, `unterminated_identifier`, and `missing_end`
  diagnostics are asserted with region scope and valid spans.

### Detection guardrail (`src/dialects.ts`, `src/types.d.ts`)

- `detectDialect` now reports `tied` (top scores equal), which drives the
  `dialect_ambiguous` guardrail.

### Token-attribution fix (`src/ir.ts`)

- Attribution now marks by token identity instead of raw span. The previous
  span-based marking could hide filtered semicolons inside an unresolved
  region, so attribution did not always account for every body token. The
  fuzz suite now asserts the accounting invariant: resolved + ignored +
  unresolved + opaque always equals the body-token total, every edge has a
  recognised kind, and every node carries provenance.

### Fixtures (`tests/tests.ts`, `tests/boundary.ts`, `tests/fuzz.ts`)

- New `tests/boundary.ts` with:
  - `PROCFLOW_RANGE_FIXTURES` — exact statement source ranges for terminated
    and valid unterminated statements across all four dialects, including the
    one-line semicolon-free cases;
  - new golden `PROCFLOW_FIXTURES` for `CREATE VIEW … WITH`, CTE-starting view
    bodies, `ALTER TRIGGER`, and semicolon-free one-line T-SQL.
- `tests/tests.ts` gained range-running plus direct assertions for number
  lexing, `dialect_ambiguous`, bracket/block balance diagnostics, and the
  hardened `findBody` headers (`CREATE VIEW … WITH`, `ALTER` object headers,
  multi-object scripts without `GO`).
- `tests/fuzz.ts` added the token-attribution, edge-kind, and provenance
  invariants.

## Verification

- `npm run typecheck` — passes
- `npm run build` — passes
- `npm run test:file` — passes
- Golden suite — 156/156
- Fuzz suite — 400 deterministic mutation cases pass
- UI suite — 13/13
- Corpus metrics on the expanded fixture set: tail-unconsumed rate 0.00 %;
  unattributed-token rate 4.95 % (down from 5.05 % on the prior corpus);
  zero unknown-node fallbacks.

## Deferred (per roadmap)

- Procedural parsing completeness (Workstream B)
- Query lineage accuracy (Workstream C)
- Data flow and dependency accuracy (Workstream D)
- Confidence re-score and layout replacement (v1.6.0 / v1.7.0)
- Catalogue, columns, and RDL (v1.9.0+)
