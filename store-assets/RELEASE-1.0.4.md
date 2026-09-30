# Ambra 1.0.4 manual store update

This update targets the existing Public Chrome Web Store item,
`mcjkkebkhifgkkbahlcapjlnaihocogj`. The owner submitted 1.0.2, explicitly skipped
publishing 1.0.3, and approved the content corrections for a verified 1.0.4
manual-upload package. Preparation does not upload, submit, publish, cancel a
pending review, or change distribution.

## What's new since 1.0.2

Copy-ready update notes, separate from the unchanged main description:

```text
- Fixed missing artwork in EPUBs that use responsive images.
- Fixed clipped illustrations inside image-only links.
- Improved pagination of simple oversized figures so their images and captions remain readable.
- Fixed repeated prose lines in paragraphs with wrapping inline text.
- Improved pagination for simple, single-column tables of contents without unnecessary table zoom controls.
- Fixed repeated image strips on the following page in some illustrated EPUBs.
- EPUB import errors now identify the affected file.
- Importing an identical EPUB now says it is already in your library, with Read now available and saved reading data preserved.
```

The responsive resource correction is in #262 and the linked-image, simple-figure
and wrapping-prose corrections are in #265. The earlier contents-table,
image-line-break and import-feedback fixes from #243, #250 and #248 are included
because 1.0.3 was not published. Revised archives remain separate books even
when their titles match; complex tables retain their viewer.

These content corrections do not rewrite publisher CSS, resize illustrations,
relax footer clipping, or change continuous-scroll measurement. Fitting figures
remain together. Image-only links include their painted image bounds rather than
just their short line boxes. Wrapping prose normalization is limited to ordered,
disjoint baseline text bands; it does not sort arbitrary mixed content.

## Explicitly deferred known limitations

The owner approved these exclusions from 1.0.4 in release tracker #263:

- **#264: complex CSS-reordered figures/captions.** A caption that precedes its
  image in DOM order but renders below it can still be clipped in an oversized
  table-style figure. The narrow normal-flow correction does not attempt a
  general visual-order/DOM-anchor rewrite.
- **#260: foreground responsiveness for unusually long chapters.** Opening,
  resizing or changing typography can still block the UI. A cooperative
  prototype improved responsiveness, but safe adoption requires stable
  disclosure state, snapshot-preserving scheduling and staged reflow/anchoring.

These are open limitations, not resolved defects. Do not claim universal EPUB
compatibility or that every kind of figure and inline layout has been fixed.

## Store fields and release boundaries

Keep the existing name, summary, main description, screenshots, icon,
promotional graphics, category, regions and **Public** visibility unchanged.
No new permissions, host access or privacy disclosures are required. Do not
append these update notes to the main description.

- Website: <https://ambraepub.org/>
- User guide: <https://ambraepub.org/en/docs/>
- Support: <https://ambraepub.org/en/docs/report-issues/>
- Privacy policy: <https://ambraepub.org/en/privacy/>

The website's immutable documentation pin remains a separate deployment
decision; this release does not advance it.

## Build from clean merged source

Root package, extension package and manifest versions must all be **1.0.4**.
Merge the content and release-preparation PRs through required checks first.
Build the final package from clean, up-to-date `main`.

The packager clears `dist/beta-release/artifacts`. Preserve the skipped final
1.0.3 ZIP, checksums, metadata and handoff together in
`dist/release-history/1.0.3/` before running it. Its ZIP checksum must remain
`8beff11643d61753b1205432aba01af68cce477a344bb44a0e065340733caa0f`.
Keep the existing 1.0.2 and 1.0.3 candidate history too. Never run a candidate
build over the only copy of a previous release.

The isolated release build must not overwrite `apps/extension/dist`,
`apps/e2e/.extension-build`, or user profiles/libraries.

```sh
git branch --show-current
git status --porcelain
git rev-parse HEAD
node --test .github/scripts/release.test.mjs
node .github/scripts/package-extension.mjs
(cd dist/beta-release/artifacts && shasum -a 256 -c SHA256SUMS)
unzip -tq dist/beta-release/artifacts/ambra-1.0.4.zip
unzip -p dist/beta-release/artifacts/ambra-1.0.4.zip manifest.json
```

Verify `release.json` records version `1.0.4`, the merged source SHA,
`dirty: false` and `publication: "PUBLIC"`. This metadata is not evidence of a
store action. Keep the ZIP, `SHA256SUMS` and `release.json` together.

Test the exact packaged extension using
`AMBRA_E2E_EXTENSION_PATH="$PWD/dist/beta-release/extension"`. Cover the new
image/figure/prose regressions, responsive images, navigation and fixed layout,
plus imports, duplicate feedback and saved-data preservation. Record actual
checks, skips, integrity and source metadata in the final artifact handoff.
Source-branch validation is not a substitute for testing the finished package.

## Owner-only submission

1. Check the existing item's dashboard for its current version and pending
   review. Confirm 1.0.4 exceeds every uploaded version; stop if it does not.
   Do not cancel a review as part of this preparation.
2. Upload only the verified `ambra-1.0.4.zip`, not notes or integrity files.
   Never patch the finished archive.
3. Preserve listing settings, graphics, privacy/permission disclosures, Public
   visibility and regions. Review and submit manually when ready.
4. Record the actual dashboard outcome separately. A passing build or handoff
   is not a submitted or published release.

Do not dispatch the legacy Unlisted workflow, which intentionally rejects
Public artifacts. Owner content review and automated tests are not a new
final-package VoiceOver/NVDA certification. Do not uninstall the working
extension or clear its library to test this package.
