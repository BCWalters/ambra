# Ambra 2.0.0 manual release

Prepare a new package for the existing Public Chrome Web Store item,
`mcjkkebkhifgkkbahlcapjlnaihocogj`. The owner approved 2.0.0 as the major
milestone for the refreshed UX and approved feature rollout, and requested
merging the final fixes before preparing the store build.

Preparation does not upload, submit, publish, change distribution, or dispatch
the historical Unlisted workflow. The owner performs store submission.

## What's changed since 1.1.1

Copy-ready update notes:

```text
- Refreshed the Library and reader controls with a consistent, quieter design.
- Added Continue reading, book discovery, improved book details and generated covers.
- Added drag-and-drop importing and a focused import window for the Chrome popup.
- Added first-reading page-turn guidance, recorded read-along controls and review invitations.
- Improved annotation navigation, Library reading-progress refresh and panel tooltips.
- Improved accessibility: contextual focus return, scrollable long footnotes and reliable import announcements.
```

Recorded read-along requires narration supplied by the publication; it is not
automatic speech synthesis. All approved user-facing features are enabled in
ordinary builds. `VITE_AMBRA_LOCAL_FEATURES=1` enables only developer review
simulation controls and must not be set for the store package.

The owner's abbreviated 3 October manual pass reported that core reading
seemed okay. The owner then confirmed toolbar navigation out and small-import
completion speech. The large web-download speech sequence still needs a
targeted native retest. Automated tests do not establish a full VoiceOver/NVDA
pass or accessibility certification. See the
[review](../docs/accessibility-review-2026-10-02.md) and
[walkthrough](../docs/screen-reader-walkthrough-2.0.0.md).

## Preserve the finished 1.1.1 handoff

Before running the packager, preserve the entire existing
`dist/beta-release/artifacts/` directory, including its ZIP, checksums,
metadata, handoff and screenshots, under `dist/release-history/1.1.1/`.
Verify every copied file. Do not overwrite an existing history directory
unless its contents are proven identical.

The finished 1.1.1 ZIP must retain SHA-256:

```text
484b9a901c3f56e382575d099b250d8bce1cc480ff864d30eaed4287896ccace
```

Keep older release history, live-preview backups, the separate development
loader and user libraries intact. The packager clears its current artifact
output; never run it before preserving the previous handoff.

## Validate clean merged source and package

The root package, extension package and source manifest must all be `2.0.0`.
Require protected PR validation and merge, then package from clean current
`main`:

```sh
git branch --show-current
git status --porcelain
git rev-parse HEAD
node --test .github/scripts/release.test.mjs
VITE_AMBRA_LOCAL_FEATURES=0 node .github/scripts/package-extension.mjs
(cd dist/beta-release/artifacts && shasum -a 256 -c SHA256SUMS)
unzip -tq dist/beta-release/artifacts/ambra-2.0.0.zip
```

Verify `release.json`: version `2.0.0`, the merged source SHA, `dirty: false`
and `publication: "PUBLIC"`. Inspect production entry points, unchanged
permissions and required license/notices. Reject development-server code,
profiles, private books, source maps and secrets.

Test the exact packaged directory with
`AMBRA_E2E_EXTENSION_PATH="$PWD/dist/beta-release/extension"` in isolated
profiles. Include native/focused/embedded imports, small-file and duplicate
announcements, web-download cancellation/fallback and success ordering,
Library activation progress, reader navigation/resume, annotations,
footnotes, narrow/localized controls and recorded read-along.

Record the exact source SHA, ZIP checksum, actual validation counts/skips and
remaining native-test limits in the ignored artifact handoff. Do not rebuild
or relabel a finished handoff under the same version after giving it to the
owner; further release changes need a new approved version.

## Refreshed store screenshots

Generate a new screenshot package from the exact final 2.0.0 ZIP using
[ASSETS.md](ASSETS.md). Earlier 1.1.x captures and development/test images
are not exact-2.0.0 release screenshots.

Final captures belong in `dist/beta-release/artifacts/store-assets/`, not
over the checked-in historical images. Verify provenance says `release` and
matches the clean source commit, version, candidate hash and package ZIP
checksum. Review all five screenshots at full resolution, preserve existing
composition and attribution, and retain the existing approved icon/promo
tile unless the owner requests a redesign.

## Owner-only submission

1. Confirm 2.0.0 exceeds every uploaded version in the existing dashboard.
   If not, stop and approve a newer source version; do not patch the ZIP or
   cancel an existing review automatically.
2. Upload the verified `ambra-2.0.0.zip` and the refreshed, reviewed store
   screenshots. Keep Public visibility, the existing item, approved regions,
   privacy disclosures and hosted policy.
3. Review update notes and submit manually when ready.
4. Record the dashboard outcome separately. Package preparation does not
   establish upload, submission, approval or publication.

The website's immutable documentation source pin is a separate deployment
decision; this release preparation does not change it.
