# Ambra 3.0.0 manual release

Owner-approved milestone: the official start of Ambra's EPUB conformance
improvement effort. The owner will upload the ZIP for review. Preparation
does not upload, submit, publish, change Public distribution, cancel another
review, or replace an existing unpacked extension.

## Update notes

```text
- Launches Ambra's official EPUB conformance improvement effort, with a transparent initial report of automated and manual testing, known limitations, and continuing work.
- Includes improved EPUB layout, packaged fonts and resource handling, metadata, navigation, and standalone SVG support.
- Adds the approved compact Library experience and clearer recorded-narration position actions: Restart page audio and Jump to selection.
```

Do not describe this as complete EPUB 3.4 support or certification. Product
version 3.0.0 is a milestone, not a statement of EPUB specification coverage.

## Initial findings and accepted limitations

The [initial conformance report](../docs/epub-conformance.md) documents:

- Historical hosted baseline: 63 pass / 1 fail across 64 required criteria
  on the exact assessed 2.2.0 package; native JPEG XL remains unsupported.
- Manual reader kit: 58 pass / 9 fail / 2 specifically not applicable /
  11 blocked or unresolved, with explicit self-assessment disclosure and
  unknown environment details preserved.
- Narration navigation, mixed-layout blank pages, default RTL progression,
  fixed-layout zoom, data images, packaged iframes and non-scripted fallback
  limitations. See its issue-linked failure table.
- Separate SVG/narration/error-recovery UX follow-ups.

The owner explicitly approved shipping this initial milestone without
completing the backlog. Full-conformance completeness remains unsatisfied;
no runner gate is weakened and no old observation is promoted to a new
3.0.0 conformance result. Accepted partial coverage is not a reason to bypass
ordinary protected production validation.

`lay-pp-layout-duplication` tests EPUBCheck, not Ambra. It is out of scope,
not pending validator work or a release blocker.

## Validate the final package

The root package, extension package and source manifest must agree on
`3.0.0`. Internal unpublished engine/shell/test package versions retain their
existing independent versions.

Require protected PR validation and merge. Package from a clean checkout of
the exact merged source in an isolated worktree, not the live Dev output:

```sh
git status --porcelain
git rev-parse HEAD
node --test .github/scripts/release.test.mjs
VITE_AMBRA_LOCAL_FEATURES=0 node .github/scripts/package-extension.mjs
(cd dist/beta-release/artifacts && shasum -a 256 -c SHA256SUMS)
unzip -tq dist/beta-release/artifacts/ambra-3.0.0.zip
```

Use a fresh isolated output directory so no previous artifact handoff is
overwritten. Verify `release.json` records version `3.0.0`, the actual source
SHA, `dirty: false`, `publication: PUBLIC` and the ZIP checksum.
Verify the packaged manifest has the production name Ambra EPUB Reader,
version `3.0.0`, unchanged permissions and production entry points.
The packager includes required license/notices and rejects dev-server code,
source maps, unexpected files and redirected output.

Keep the assessed 2.2.0 archive, its historical report and the user's test
profile unchanged. No new listing art or screenshots are requested;
retained screenshot provenance remains historical.

## Owner-only upload

1. Check the existing Public item's dashboard version and current review
   state. Confirm 3.0.0 exceeds every uploaded version.
2. Upload only the verified `ambra-3.0.0.zip` to item
   `mcjkkebkhifgkkbahlcapjlnaihocogj`. Keep existing visibility, permissions
   disclosures, listing configuration and screenshot set.
3. Use the update notes above, review the dashboard, and submit manually.
4. Record the actual upload/review/publication outcome separately. A prepared
   ZIP does not establish store submission or approval.
