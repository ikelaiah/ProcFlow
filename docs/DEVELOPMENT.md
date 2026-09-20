# Development

## Prerequisites

- Node.js 22 (the CI baseline) and npm.
- A current Chromium, Firefox, or Edge browser for browser suites.
- Python 3 for the simple static server used by headless checks.

## Build and tests

```text
npm ci
npm run typecheck
npm run build
npm run test:file
npm run benchmark
npm run metrics
```

The generated `dist/` tree is the browser runtime. Serve the repository root
and open these pages:

- `tests/index.html` — golden, parity, layout, workspace, catalogue, report,
  scale, realistic-corpus, and the v2.4.0 query-builder engine checks.
- `erd.html` — the schema DDL / entity relationship diagram page.
- `tests/fuzz.html` — 400 deterministic mutation cases.
- `tests/ui.html` — browser interaction and large-input responsiveness.
- `tests/erd-ui.html` — ERD query-builder interaction: query mode, on-card
  picking, join and problem cards, teaching by clicks, self joins, SQL options,
  highlighting, resize, Find, and the only-used filter.
- `tests/security.html` — hostile-input and strict-rendering checks.
- `tests/metrics.html` — the current metrics snapshot.
- `tests/firefox-smoke.html` — critical-path smoke used by the Firefox job; it
  loads both `index.html` and `erd.html`.

For a local run:

```text
python -m http.server 8765 --bind 127.0.0.1
```

### Adding a browser suite

1. Add `tests/<name>.html` with a summary paragraph, a results `<pre>`, and a
   hidden iframe pointed at the page under test.
2. Add `tests/<name>.ts` that waits for the iframe load, records
   `{name, pass, detail}` entries, sets `document.body.className` to `pass` or
   `fail`, and writes the summary. It compiles to `dist/tests/<name>.js`.
3. Register the script in the HTML shell and add a
   `run_suite <name> http://127.0.0.1:8000/tests/<name>.html` line to the
   correctness workflow.
4. Prefer deterministic waits (`setTimeout`, `requestAnimationFrame`); the CI
   runner uses Chromium's virtual time budget, not wall-clock sleeps.

The benchmark is indicative rather than a timing gate. It covers 100 KB and
500 KB source inputs, a 100-object estate, 100/250/500-node graphs, and 25
report datasets. Reference observations are recorded in
[BENCHMARKS.md](BENCHMARKS.md).

## Packaging

```text
npm run package:runtime
npm run package:smoke
```

The package script creates `.release/procflow-v<package.json version>.zip`
from an explicit allowlist and writes its SHA-256 to `.release/SHA256SUMS.txt`.
The package smoke validates archive paths, required runtime files, exclusion of
development files, and local-file startup. Do not change the package version
or overwrite a historical release checksum until the corresponding release
contract and qualification evidence are complete.

## TypeScript and change discipline

The application intentionally retains global-script compatibility for the
runtime. A strict pilot covers the extracted confidence and large-input policy
modules with `tsconfig.strict.json`; the legacy global code still has a
documented strictness debt. Keep changes incremental, add deterministic tests
for behavior changes, and rebuild `dist/` before committing.

Module headers follow one convention for new and materially changed modules:
`/* proc>flow vX.Y.Z — <role>. … */`, where `vX.Y.Z` is the release that last
changed the module. Update the header in the same commit as the change;
historical headers are migrated when the file is next touched. New
browser-facing scripts must also be added to `scripts/package-runtime.mjs` and,
where the page needs them, to the page's ordered `<script>` list.

Before merging, run the full browser pages, packaging smoke, metrics check, and
the code review checklist. Keep fixtures anonymised and avoid network calls in
runtime code.
