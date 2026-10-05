# Contributing

Thanks for helping. SQL Cartographer is a trust-centred tool: a diagram that is
plausible and wrong is worse than no diagram. Every change is judged against
that.

## Before you start

- Prerequisites, build commands, and the browser suites are in
  [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
- The pipeline, module boundaries, and design invariants are in
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- What the tool promises — and refuses to promise — is in
  [docs/V2_ACCURACY_CONTRACT.md](docs/V2_ACCURACY_CONTRACT.md).
- If you are about to make an architectural decision, read
  [docs/decisions/README.md](docs/decisions/README.md) first. Someone may have
  already decided this and written down why.

## The non-negotiables

These are enforced by CI and by review. They are not preferences.

1. **Runtime stays local-only.** No network calls, no telemetry, no backend.
   The only `localStorage` in the codebase lives in `src/workspace.ts`.
2. **No invented facts.** An object identity, call, dependency, column binding,
   control path, or data-flow edge is asserted only with static evidence.
   Otherwise the result is external, ambiguous, opaque, or unresolved — and it
   says so.
3. **Source spans travel with results.** Every finding must be inspectable back
   to the input.
4. **Deterministic output.** The same schema plus the same inputs produce the
   same graph, layout, and SQL. Export ordering is stable.
5. **Presentation never rewrites analysis.** Filters change what is drawn, not
   what was counted.
6. **Persistence is opt-in.** Nothing is stored until the user chooses Save.

## Making a change

### Write the test first

For any behaviour change, add a deterministic fixture that fails before the
change and passes after it. Prefer **graph-edge assertions** — required and
forbidden wires — over statement counts. Counts go up when a parser improves
and when it breaks; edges do not.

Golden fixtures live in `tests/fixtures.ts` and `tests/dialects/*.ts`. The
adversarial matrix in `tests/adversarial-matrix.ts` carries required *and*
forbidden semantic assertions; extend it when you add a node class or an
semantic edge kind.

**A changed existing golden is a reviewed accuracy correction, not a routine
fixture update.** Say in the commit why the previous graph was wrong.

### Keep changes reviewable

- Target roughly 100 changed lines. Around 300 is acceptable for one logical
  change. Above that, split it.
- Separate refactoring from feature work. A change that moves code *and* adds
  behaviour is two changes.
- Do not grow a file past ~1000 lines without decomposing it first.
- When a change touches `src/`, rebuild `dist/` in the same commit:
  `npm run build`, then commit the generated JavaScript. CI fails on stale
  `dist/`.

### Follow the module conventions

New or materially changed modules get a header in the same commit as the change:

```text
/* sql-cartographer vX.Y.Z — <role>. … */
```

`vX.Y.Z` is the release that last changed the module. New browser-facing
scripts must also be added to `scripts/package-runtime.mjs` and, where the page
needs them, to that page's ordered `<script>` list in `index.html` or
`erd.html`. Load order is the dependency contract — see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

New ADRs use the template in
[docs/decisions/TEMPLATE.md](docs/decisions/TEMPLATE.md) and continue the
numbering.

### Documentation ships with the change

If the change is user-visible, update the doc that describes that behaviour in
the same commit. If it is a decision with trade-offs, write an ADR. If it
changes what the tool asserts, update
[docs/V2_ACCURACY_CONTRACT.md](docs/V2_ACCURACY_CONTRACT.md) and
[docs/ACCURACY.md](docs/ACCURACY.md).

## Before you open a pull request

Run the full gate, the same one CI runs:

```text
npm run lint
npm run typecheck
npm run build
npm test
npm run test:file
npm run metrics
npm run package:smoke
```

`git status --porcelain -- dist` must be empty after the build. Also confirm:

- [ ] A fixture covers the behaviour change, and it fails without the fix.
- [ ] Source spans and conservative semantics are preserved.
- [ ] No network call or new `localStorage` access outside `src/workspace.ts`.
- [ ] `dist/` is rebuilt and committed.
- [ ] Docs and module headers are updated where the change made them wrong.
- [ ] Fixtures are anonymised. Never include confidential SQL.

## Reporting issues

Use the issue forms for anonymised parser reports, bugs, and feature requests.
**Never include confidential SQL.** Provide the SQL Cartographer version, the
browser, the dialect, and a minimal anonymised payload that reproduces the
problem.

Security issues go through the repository's private security reporting channel
rather than a public issue. See [docs/SECURITY.md](docs/SECURITY.md).

## Review

Every change gets reviewed on five axes before merge: correctness, readability,
architecture, security, and performance. Approve a change when it definitely
improves overall code health — perfect code does not exist. Feedback is labelled
so it is clear what is required and what is a suggestion.

## Licence

By contributing you agree that your contributions are licensed under the
[MIT License](LICENSE).
