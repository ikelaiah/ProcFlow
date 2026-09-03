# ProcFlow v2.0.0 qualification tasks

## Task 1: Future workspace rejection — complete

**Acceptance criteria:** a version greater than `WORKSPACE_SCHEMA_VERSION`
returns `future_workspace_version`, no snapshot, and is not treated as migrated.

**Verification:** workspace suite, `npm run typecheck`, `npm run build`, and
`npm run test:file`.

**Dependencies:** none.

## Task 2: Adversarial semantic matrix — complete

**Acceptance criteria:** all four dialects have maintainable fixtures with
required and forbidden assertions; results identify dialect, case, assertion,
expected, and actual semantics.

**Verification:** built browser suite and metrics page.

**Dependencies:** none.

## Task 3: v2 metric snapshot — complete

**Acceptance criteria:** metric has transparent total, required, forbidden,
and per-dialect counts and passes at `1.0` from checked-in fixtures.

**Verification:** `npm run metrics:write`, then `npm run metrics`.

**Dependencies:** Task 2.

## Task 4: Final contract and release convergence — local qualification complete

**Acceptance criteria:** documents and active version references match the
implemented behavior; full local release gate is green.

**Verification:** all documented release commands.

**Dependencies:** Tasks 1-3.
