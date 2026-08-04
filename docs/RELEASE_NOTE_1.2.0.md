# proc>flow v1.2.0 — Trust statement boundaries

**Release date:** 2026-08-05

This release delivers the **Trust statement boundaries** milestone from the
[ROADMAP.md](../ROADMAP.md) (Workstream A in full, plus the E boundary
diagnostics it ships). Statement splitting no longer depends on newline
position, semicolons are authoritative, numbers lex more completely, and
uncertain dialect detection reports an explicit tie guardrail.

## What's new

### Grammar-driven statement boundaries

- Semicolons are authoritative boundaries when present, in every dialect.
- When a dialect permits omitted semicolons, statements are split by
  dialect-aware control keywords and statement grammar. A newline that used to
  be mandatory is now only a low-priority recovery hint.
- One-line semicolon-free T-SQL/DB2/PL-pgSQL sequences now parse into distinct
  statements (`SET @x = 1 PRINT @x SELECT @x` → three statements).
- The existing `INSERT…SELECT`, `UPDATE…OUTPUT`, `MERGE`, recursive-CTE, and
  `CASE`-expression continuation rules are preserved, and SQLite's
  `SELECT RAISE(...)` expression stays a single statement.

### Number lexing

- `0x1F`, `0X1f`, `0x1_000` hexadecimal literals.
- `1_000`, `1_000_000` underscore digit separators.
- `1.` and `.5` fractional forms in addition to `1.5` exponents.
- Dotted object names and `..` ranges are unaffected.

### Boundary diagnostics

- `unexpected_end` (region) — a block-terminating keyword such as `END` with no
  matching opener.
- `dialect_ambiguous` (document) — automatic detection ties at low confidence;
  no artificial span is fabricated.
- Bracket/paren balance, `unterminated_identifier`, and `missing_end`
  diagnostics are now asserted with region scope and valid spans.

### Token-attribution accounting

- Attribution marks by token identity, so hidden semicolons inside unresolved
  regions are no longer lost. The invariant resolved + ignored + unresolved +
  opaque equals the body-token total holds across the whole corpus and is now
  enforced by the fuzz suite, alongside recognised edge kinds and node
  provenance.

## What's unchanged

- Every existing golden fixture keeps its structure and assertions; the corpus
  only grew.
- Parser/lineage expansion, data flow, confidence re-score, and layout
  replacement are deferred to later releases per the roadmap.
- The local-only, browser-only security model is unchanged.

## Files changed

- `src/tokenizer.ts` — number lexing: `0x`, separators, `1.`/`.5`
- `src/dialects.ts` — `newStatementHere` newline demotion; `RAISE`/`SELECT`
  guard; `detectDialect.tied`; `unexpected_end` source support
- `src/ir.ts` — `dialect_ambiguous` and `unexpected_end` diagnostics; token
  identity attribution
- `src/types.d.ts` — `DialectDetection.tied`; `RangeFixture`
- `tests/boundary.ts` — new range fixtures and boundary goldens
- `tests/tests.ts` — range runner and v1.2.0 assertions
- `tests/fuzz.ts` — attribution, edge-kind, and provenance invariants
- `tests/index.html` — loads `tests/boundary.js`
- `package.json` — version bumped to 1.2.0
- `README.md` — updated for v1.2.0

## Verification

- `npm run typecheck` — passes
- `npm run build` — passes
- `npm run test:file` — passes
- Golden suite — 156/156
- Fuzz suite — 400 deterministic mutation cases
- UI suite — 13/13
- Corpus: tail-unconsumed rate 0.00 %; unattributed-token rate 4.95 % (was
  5.05 % on the prior 90-fixture corpus); no unknown-node fallbacks.

See [RELEASE_NOTE_v1.2.0.md](../RELEASE_NOTE_v1.2.0.md) for the release
summary and [README.md](../README.md) for usage.
