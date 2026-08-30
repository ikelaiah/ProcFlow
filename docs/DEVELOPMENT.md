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
  scale, and realistic-corpus checks.
- `tests/fuzz.html` — 400 deterministic mutation cases.
- `tests/ui.html` — browser interaction and large-input responsiveness.
- `tests/security.html` — hostile-input and strict-rendering checks.
- `tests/metrics.html` — the current metrics snapshot.
- `tests/firefox-smoke.html` — critical-path smoke used by the Firefox job.

For a local run:

```text
python -m http.server 8765 --bind 127.0.0.1
```

The benchmark is indicative rather than a timing gate. It covers 100 KB and
500 KB source inputs, a 100-object estate, 100/250/500-node graphs, and 25
report datasets. Reference observations are recorded in
[BENCHMARKS.md](BENCHMARKS.md).

## Packaging

```text
npm run package:runtime
npm run package:smoke
```

The package script creates `.release/procflow-v1.14.0.zip` from an explicit
allowlist and writes its SHA-256 to `.release/SHA256SUMS.txt`. The package
smoke validates archive paths, required runtime files, exclusion of development
files, and local-file startup.

## TypeScript and change discipline

The application intentionally retains global-script compatibility for the
runtime. A strict pilot covers the extracted confidence and large-input policy
modules with `tsconfig.strict.json`; the legacy global code still has a
documented strictness debt. Keep changes incremental, add deterministic tests
for behavior changes, and rebuild `dist/` before committing.

Before merging, run the full browser pages, packaging smoke, metrics check, and
the code review checklist. Keep fixtures anonymised and avoid network calls in
runtime code.
