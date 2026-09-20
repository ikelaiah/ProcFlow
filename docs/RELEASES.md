# Releases

## Convention

Each release has one canonical note at `docs/releases/vX.Y.Z.md`. Historical
`RELEASE_NOTE_*` and `PR_NOTE_*` files are retained for provenance; new release
notes do not duplicate them. The root README links the current release and
points here and to `CHANGELOG.md` for the history.

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
     .release/procflow-vX.Y.Z.zip .release/SHA256SUMS.txt
   ```

   Verify the uploaded ZIP digest against `.release/SHA256SUMS.txt`.
6. Rebuild `dist/` before merging any source change; the correctness workflow
   fails when the committed generated JavaScript is stale.

Release-doc drift is guarded in CI: the current version must appear in
`README.md`, `docs/USER_GUIDE.md`, `docs/ACCURACY.md`, and `CHANGELOG.md`, the
release note and metrics snapshot must exist, and `package-lock.json` must
match `package.json`.

## Current release

[v2.4.1 — Query builder hardening and release discipline](releases/v2.4.1.md)

## Historical releases

The previous release notes and implementation notes remain in this directory,
including [v2.3.0](releases/v2.3.0.md) and
[v1.14.0](releases/v1.14.0.md), so old verification claims can be traced
without rewriting history.

