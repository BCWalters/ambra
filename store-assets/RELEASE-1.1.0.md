# Ambra 1.1.0 manual feature release

This release targets the existing Public Chrome Web Store item,
`mcjkkebkhifgkkbahlcapjlnaihocogj`. The owner approved sequential implementation,
validation, protected merges, live-build refreshes, and preparation of this
manual-upload release. Preparation does not upload, submit, publish, cancel a
review, change distribution, or dispatch the historical Unlisted workflow.

This is a minor release because it includes new features. Follow the
[release-version policy](../CONTRIBUTING.md): increment minor and reset patch
when a release includes any feature; increment patch for releases containing
only fixes or improved content handling.

## What's new since 1.0.4

Copy-ready update notes, separate from the main store description:

```text
- Search your library locally by title or author.
- Enjoy a more compact popup library with three-column covers and a persistent Full library action.
- Turn reflowable pages more easily from unoccupied space near the outer edges, while preserving text selection and content interactions.
- Open unusually long reflowable chapters more responsively while their pages are prepared.
- Read more CSS-reordered figures and captions without clipped or repeated content.
- Refreshed store screenshots show the current reader, library, annotations, EPUB Inspector, and keyboard shortcuts.
```

The release includes reordered-figure pagination (#272), reflowable edge targets
(#273), cooperative foreground preparation (#274), local library search (#275),
compact-library improvements (#276), and the refreshed capture workflow (#278).
Search and compact-library labels cover all nine supported interface languages.
Search is local, temporary, and does not change book identity or stored files.
No new permissions, host access, or data migrations are introduced.

## Honest boundaries and follow-ups

- Cooperative work covers opening/replacement candidates. Visible in-place
  typography/resize reflow and narration jumps retain their synchronous path.
  Animated or unsettled-font documents retain conservative atomic measurement.
- Figure support is bounded to verified, separable layouts. Complex overlapping
  or multicolumn arrangements retain their existing fallback; this is not a
  claim of universal EPUB compatibility.
- EPUB 2 metadata-only cover declarations remain a separate import follow-up
  (#277). Do not delete/reimport a user's books as an automatic repair.
- A rare RTL-rotation CI request-count failure is tracked in #279. The unchanged
  case passed repeated local checks and the subsequent full CI runs; its cause
  remains unproven. Do not weaken that assertion or label it a fixed reader bug.
- The review invitation (#254) remains deferred. New final-package
  VoiceOver/NVDA certification has not been performed.

## Listing materials

Keep the existing name, summary, main description, icon, promo tile, category,
regions, privacy disclosures, and **Public** visibility. Replace the five store
screenshots with the reviewed exact-package set, in this order:

1. Reader with Alice, three annotations, complete Tenniel art, and mapped progress.
2. Library with 15 classic books and varied original covers.
3. EPUB Inspector docked right and locating the current passage.
4. Pinned overflowing annotations panel and a meaningful saved note popup.
5. Keyboard shortcuts above the reader.

Follow [ASSETS.md](ASSETS.md) and preserve [source credits](ATTRIBUTIONS.md).
Alice is a custom PG11 text/PG114 Tenniel-art reading copy, not an assertion that
PG11 alone contains the illustration. The sources declare public domain in the
USA, not worldwide clearance. Do not distribute the generated full EPUBs.

- Website: <https://ambraepub.org/>
- User guide: <https://ambraepub.org/en/docs/>
- Support: <https://ambraepub.org/en/docs/report-issues/>
- Privacy policy: <https://ambraepub.org/en/privacy/>

The website's immutable documentation pin is a separate deployment decision;
this release does not silently advance it.

## Build and validate clean merged source

Root package, extension package, and manifest must all be **1.1.0**.
Merge release preparation through required checks, then use clean, current
`main`. Preserve the entire previous artifact/handoff set before packaging,
which clears `dist/beta-release/artifacts`. The preserved 1.0.4 ZIP in
`dist/release-history/1.0.4/` must retain SHA-256
`30ecd5a97d37d1943bce204693f6d21255ac0b40b4478ec955a02ed978745ce5`.
Keep older release history and the separate development loader intact too.

Prepare pinned screenshot inputs before packaging. If preparation changes
tracked artwork, resolve that through a PR rather than packaging a dirty tree.

```sh
python3 store-assets/scripts/prepare-assets.py --classics
git branch --show-current
git status --porcelain
git rev-parse HEAD
node --test .github/scripts/release.test.mjs
node .github/scripts/package-extension.mjs
(cd dist/beta-release/artifacts && shasum -a 256 -c SHA256SUMS)
unzip -tq dist/beta-release/artifacts/ambra-1.1.0.zip
```

Verify `release.json`: version `1.1.0`, the merged SHA, `dirty: false`, and
`publication: "PUBLIC"`. Test the exact package via
`AMBRA_E2E_EXTENSION_PATH="$PWD/dist/beta-release/extension"`, covering reordered
figures, foreground responsiveness, edge targets, search, true native popup
sizing, fixed layout, import/storage preservation, and Save as.

Capture only after packaging, with `AMBRA_STORE_ALLOW_BROWSER=1`,
`AMBRA_STORE_RELEASE_CAPTURE=1`, `AMBRA_STORE_SOURCE_SHA="$(git rev-parse HEAD)"`,
and `AMBRA_STORE_EXTENSION_PATH="$PWD/dist/beta-release/extension"`.
The capture verifies every candidate byte against the ZIP before and after
capture and writes ignored `dist/beta-release/artifacts/store-assets/`.
Inspect all five images and provenance. Do not substitute tracked historical
PNGs or previews, and do not repackage after capture.

Back up the live unpacked build before refreshing it from the verified package;
preserve user profiles and libraries. Record actual test counts, skips, source
SHA, and integrity checks in the final artifact handoff. A source-branch test
run is not a substitute for final-package validation.

## Owner-only submission

1. Check the existing item's dashboard and pending review. Confirm 1.1.0 exceeds
   every uploaded version; stop otherwise. Do not cancel an existing review.
2. Upload only the verified `ambra-1.1.0.zip`; never patch a finished archive.
3. Replace only the approved five screenshots, preserve the remaining settings
   and Public visibility, and review/submit manually when ready.
4. Record the actual dashboard outcome separately. A package and handoff are
   not evidence of upload, submission, approval, or publication.
