# Security and privacy

ProcFlow is local-first. In the shipped runtime, SQL, catalogue data, reports,
and diagrams are processed in the browser. There is no backend, sign-in,
database connection, telemetry, or network submission path.

## Data handling

- Opening the app does not write cookies, `sessionStorage`, IndexedDB, or
  `localStorage`.
- **Save to this browser** is the only opt-in local persistence path.
- Workspace export is an explicit JSON download; workspace import is an
  explicit local file action.
- Clipboard actions occur only when the user requests a copy.

The runtime still handles untrusted text. Do not paste secrets into a shared
screen, browser profile, or exported workspace without following your
organisation's policy.

## Rendering boundaries

- Mermaid rendering uses `securityLevel: 'strict'` in the security fixture.
- Labels are escaped before Mermaid and XML output.
- Provenance metadata is encoded when it contains markup-sensitive characters.
- Draw.io output is parsed as XML in tests and is not executed as HTML.
- Security fixtures cover hostile labels and attributes including script,
  event-handler, `javascript:`, and `foreignObject` payloads.

The browser's own file and clipboard permissions remain outside ProcFlow's
control. Organisations embedding the app should add an appropriate Content
Security Policy and serve it from a trusted location.

## Release verification

The release workflow pins GitHub Actions to immutable commit SHAs, runs the
security suite, and runs the local-file package smoke. Runtime archives are
store-only ZIPs with a deterministic entry list and a SHA-256 checksum in
`.release/SHA256SUMS.txt`. Verify the checksum and the release tag before
distributing an archive.

Report security issues without including confidential SQL. Provide the
ProcFlow version, browser, a minimal anonymised payload, and reproduction
steps; use the repository's private security reporting channel when the issue
itself is sensitive.
