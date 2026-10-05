# ADR-NNN: Title

## Status

Accepted

## Date

YYYY-MM-DD

## Context

What is the question this record answers? What constraints, contracts, or prior
decisions does it have to respect? State the problem, not the solution. Link the
docs that constrain the answer — usually
[ACCURACY.md](../ACCURACY.md) and the
[V2 accuracy contract](../V2_ACCURACY_CONTRACT.md) for anything that touches
what SQL Cartographer asserts.

## Decision

What was chosen, stated plainly and unambiguously. If the decision changes what
the tool asserts, name the invariant it introduces and where it is enforced
(a test, a CI guard, a documented contract).

## Alternatives Considered

Use one `###` heading per alternative, and end each with an explicit verdict.
An ADR without rejected alternatives is a description, not a decision record.

### Alternative name

- Pros: …
- Cons: …
- Rejected: one line saying why. If the alternative was rejected only for now,
  say so — it may return.

## Consequences

- What becomes easier, and what becomes harder.
- What is now enforced mechanically rather than by review.
- What a future contributor must do to stay consistent with this decision.
