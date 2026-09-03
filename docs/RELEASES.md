# Releases

## Convention

Each release has one canonical note at `docs/releases/vX.Y.Z.md`. Historical
`RELEASE_NOTE_*` and `PR_NOTE_*` files are retained for provenance; new release
notes do not duplicate them. The root README links the current release and
points here and to `CHANGELOG.md` for the history.

Every release should:

1. update `package.json` and `package-lock.json` together;
2. rebuild and run the typecheck, file smoke, browser suites, metrics, and
   package smoke;
3. update the versioned metrics snapshot and roadmap;
4. generate the runtime ZIP and checksum;
5. add the release note before tagging `vX.Y.Z`.

v2.0.0 added the adversarial matrix, v2 metric snapshot, final accuracy
contract, and non-destructive future-workspace rejection. See the
[final v2 contract](V2_ACCURACY_CONTRACT.md).

## Current release

[v2.0.0 — Trustworthy SQL Analysis Contract](releases/v2.0.0.md)

## Historical releases

The previous release notes and implementation notes remain in this directory,
including [v1.14.0](releases/v1.14.0.md) and [v1.13.0](RELEASE_NOTE_v1.13.0.md),
so old verification claims can be traced without rewriting history.
