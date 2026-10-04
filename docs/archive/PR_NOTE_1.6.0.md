# PR: v1.6.0 — Honest measurement

## Summary

Implements the **v1.6.0 — Honest measurement** milestone from `ROADMAP.md`
in full and nothing from v1.7.0 onwards: the E confidence re-score (per-region
signals, a versioned formula, one headline number, and a `data-band` derived
from the same formula) plus fixture-corpus metric publishing as a checked-in,
deterministic, fixture-only snapshot. The golden suite grows from 199 to 204;
fuzz (400) and UI (14 → 16) suites stay green. Layout (v1.7.0), persistence,
catalogue, and columns remain deferred.

## What's included

### Versioned confidence formula from per-region signals (E)

`analyse` (`src/ir.ts`) now scores every statement region by its resolution
state — `resolved` (1.00), `approx` (0.75, a region warning such as an opaque
source or an approximate recursion), `opaque` (0.40, dynamic/unresolved node),
or `error` (0.15, a region-scoped error) — weighted by tokens. The headline is:

```text
confidence = dialect certainty × region quality × (0.6 + 0.4 × coverage)
```

- Versioned and documented as `confidenceFormulaVersion = "1.6.0"`, with the
  per-region breakdown published on the result as `confidenceSignals`
  (`dialect`, `coverage`, `regionQuality`, `regionBreakdown`).
- The UI's health `data-band` comes from the same formula via `confidenceBand`
  (`>= 0.85` high, `>= 0.6` medium, else low), so the colour never disagrees
  with the percentage.
- Coverage alone can never raise confidence: 100 % coverage of opaque regions
  caps confidence at 0.4, satisfying "coverage alone never increases confidence
  without a corresponding correctness assertion".

### Region diagnostics for every approximate resolution (E)

- **Opaque table expressions** (`UNNEST`, `XMLTABLE`, `JSON_TABLE`,
  `GENERATE_SERIES`, …) now emit a region-scoped, span-attached
  `source_opaque` warning.
- **Partially resolved `APPLY`** targets emit a region-scoped, span-attached
  `apply_heuristic` warning. `refsIn` now tags the structured reference with
  `apply: true` so only genuine APPLY targets trigger it, never ordinary
  three-part heuristic names.
- Dynamic SQL, approximate recursion (`cte_recursion_approx`), and unresolved
  labels (`goto_unresolved`) already carried region diagnostics and are
  unchanged.

### Document-scoped findings carry no fabricated span (E)

`dialect_low_confidence` no longer receives an artificial one-character span;
like `dialect_ambiguous` it is document-scoped with `span: null`.

### Informational annotations do not inflate the findings count (E)

The Diagnostics count (UI and estate) already excluded `info` severity; the new
golden and UI assertions pin that behaviour down (a clean recursive CTE shows
its `cte_recursive` info annotation and a findings count of 0).

### Fixture-corpus metric publishing

- `tests/metrics.ts` + `tests/metrics.html` aggregate the "Metrics that matter"
  over the checked-in golden corpus: attribution (100 % by construction, proving
  no silent drops), unresolved-token rate, tail-unconsumed rate, fallback rate,
  opaque-dynamic rate, semantic-edge coverage, provenance rate, and the
  region-diagnostic-to-span ratio.
- `scripts/metrics.mjs` runs that page headlessly via `file://` (same technique
  as `file-smoke.mjs`) and either writes the snapshot (`--write`) or verifies
  the checked-in `docs/metrics-v1.6.0.json` (`npm run metrics`).
- Deterministic and fixture-only: no user inputs or runtime telemetry.
- CI gates: a new "Verify fixture-corpus metric snapshot is current" step fails
  the build when the snapshot is stale.

## Fixtures and tests

- `tests/tests.ts` — v1.6.0 blocks: versioned formula + per-region signal
  contributions (  clean/opaque/broken ordering and bands), document-scoped dialect spans,
  `source_opaque`/`apply_heuristic` region diagnostics, and
  info-not-inflating counts.
- `tests/ui-tests.ts` — data-band derives from the formula (band always matches
  the threshold implied by the shown confidence percentage) and informational
  annotations keep the findings count at 0.
- `tests/metrics.ts` / `tests/metrics.html` / `scripts/metrics.mjs` —
  deterministic fixture-corpus metric snapshot.
- `examples/dbo.v160_demo.sql` — release demo exercising the v1.6.0 outcomes:
  the per-region confidence formula (resolved/approx/opaque regions measured
  from a real script), `apply_heuristic` and `source_opaque` region warnings,
  the info-only recursive-CTE annotation, and the coverage-cannot-inflate
  guarantee; header records the measured 91 % (T-SQL) / 78 % (Detect) outcome.

## Verification

- `npm run typecheck` — passes
- `npm run build` — passes
- `npm run test:file` — passes (with `CHROME_PATH` set on this machine; Edge
  headless did not produce DOM output, Chrome did)
- Golden suite — 204/204 (was 199)
- Fuzz suite — 400 deterministic mutation cases
- UI suite — 16/16 (was 14)
- `npm run metrics` — snapshot is current; `docs/metrics-v1.6.0.json` committed
- Local-only URL check clean; `dist/` committed in sync

## Not changed / deferred (per roadmap)

- Everything from v1.7.0 onwards — layout replacement, persistence, catalogue,
  column lineage, and RDL — is out of scope for this release.
- Existing v1.1.0–v1.5.0 semantics are untouched; all prior fixtures remain
  green.
