# Security policy

The canonical security and privacy policy for SQL Cartographer lives in
**[docs/SECURITY.md](../docs/SECURITY.md)**. Please read it before reporting.

## Reporting a vulnerability

Report security issues through GitHub's **private security reporting** channel
for this repository (Security → Report a vulnerability), not through a public
issue.

Include:

- the SQL Cartographer version,
- the browser and version,
- the dialect in use,
- a **minimal anonymised payload** that reproduces the problem,
- reproduction steps.

**Never include confidential SQL.** The runtime is local-only — SQL Cartographer
has no backend and never transmits your input — but a reproduction payload is
still yours to anonymise.

## Scope

SQL Cartographer runs entirely in the browser with no backend, sign-in, or
network submission path. The relevant attack surfaces are the parser, the
diagram exporters, and the rendering boundaries around untrusted SQL text.
Labels are escaped before Mermaid and XML output, Mermaid renders with
`securityLevel: 'strict'` in the security suite, and hostile labels and
attributes are covered by checked-in fixtures.

Organisations embedding the app should add a Content Security Policy and serve
it from a trusted location. See [docs/SECURITY.md](../docs/SECURITY.md#rendering-boundaries).

## Release verification

Runtime archives are store-only ZIPs with a deterministic entry list and a
SHA-256 checksum in `.release/SHA256SUMS.txt`. Verify the checksum and the
release tag before distributing an archive. GitHub Actions are pinned to
immutable commit SHAs.
