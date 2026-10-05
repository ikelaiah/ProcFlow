# Releases

## Convention

Each release since v1.14.0 has one canonical note at `docs/releases/vX.Y.Z.md`.
Earlier releases (v1.0–v1.13) predate that convention; their duplicate
`RELEASE_NOTE_*` / `PR_NOTE_*` files, plus historical planning and audit
documents, are archived under [`docs/archive/`](archive/) for provenance. New
release notes never duplicate the archive. The root README links the current
release and points here and to `CHANGELOG.md` for the history.

## Release flow

1. Land the feature work on `main` through a pull request; CI (`Correctness`,
   `Firefox smoke`) must be green.
2. Update `package.json` and `package-lock.json` **together** in a
   `release(vX.Y.Z): ...` commit, add the release note under
   `docs/releases/vX.Y.Z.md`, add the changelog entry, refresh
   `docs/RELEASES.md`, and update the versioned metrics snapshot
   (`npm run metrics:write` after the version bump).
3. Run the local gate: `npm run typecheck`, `npm run build`,
   `npm run test:file`, `npm run metrics`, `npm run package:smoke`, and
   `npm run benchmark`.
4. After the release PR is merged, create an **annotated tag on the
   `release(vX.Y.Z)` commit** (not on the merge commit), matching the existing
   history: `git tag -a vX.Y.Z <release-commit> -m "vX.Y.Z — <title>"`, then
   `git push origin vX.Y.Z`.
5. Publish the GitHub release from that tag with the runtime ZIP and checksum:

   ```text
   gh release create vX.Y.Z \
     --title "vX.Y.Z — <title>" \
     --notes-file docs/releases/vX.Y.Z.md \
     .release/sql-cartographer-vX.Y.Z.zip .release/SHA256SUMS.txt
   ```

   Verify the uploaded ZIP digest against `.release/SHA256SUMS.txt`.
6. Rebuild `dist/` before merging any source change; the correctness workflow
   fails when the committed generated JavaScript is stale.

Release-doc drift is guarded in CI: the current version must appear in
`README.md`, `docs/USER_GUIDE.md`, `docs/ACCURACY.md`, and `CHANGELOG.md`, the
release note and metrics snapshot must exist, and `package-lock.json` must
match `package.json`.

## Current release

[v3.0.0 — Rename and identifier reset](releases/v3.0.0.md)

## Historical releases

Canonical notes, newest first:

- [v2.7.0](releases/v2.7.0.md)
- [v2.6.0](releases/v2.6.0.md)
- [v2.5.0](releases/v2.5.0.md)
- [v2.4.0](releases/v2.4.0.md)
- [v2.3.0](releases/v2.3.0.md)
- [v2.2.0](releases/v2.2.0.md)
- [v2.1.0](releases/v2.1.0.md)
- [v2.0.0](releases/v2.0.0.md)
- [v1.14.1](releases/v1.14.1.md)
- [v1.14.0](releases/v1.14.0.md)

Pre-v1.14.0 release and implementation notes are archived in
[`docs/archive/`](archive/). Historical verification claims stay traceable
there without cluttering the current documentation.





