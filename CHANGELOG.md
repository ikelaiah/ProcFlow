# Changelog

All notable released ProcFlow changes are recorded here. Detailed verification
evidence belongs in the canonical release note under `docs/releases/`.

## v2.0.0 — Trustworthy SQL Analysis Contract

- Added the cross-dialect adversarial semantic qualification matrix and its
  fixture-only `dialectAdversarialSemanticAssertionRate` metric.
- Reject newer and corrupt saved workspace schemas without coercion, mutation,
  or automatic deletion.
- Finalised the v2 accuracy and compatibility contract.

## v1.14.1 — Targeted correctness patch

- Preserved named PL/pgSQL `LATERAL` sources.
- Kept DB2 `PREPARE`/`EXECUTE` dynamic SQL opaque instead of asserting an
  object read or procedure call.
- Preserved unique sequential DB2 `SESSION.` temporary-table data flow.

See [the v1.14.1 release note](docs/releases/v1.14.1.md) and the
[accuracy audit](docs/ACCURACY_GAPS.md) for the reproductions and verification
record.
