# Reproducible store assets

## Prepared without a browser

```sh
python3 store-assets/scripts/prepare-assets.py
```

This uses the existing Pillow installation and local Arial or DejaVu Sans fonts.
It does not install dependencies, download fonts/books, launch Chrome, build the
extension, or package/upload a release.

- `icon-store-128.png`: project artwork resized to 96×96, centered on a transparent
  128×128 canvas. The 16-pixel outside border is fully transparent.
- `promo-tile-440x280.png`: original brand tile, without an unverified accessibility
  claim.
- Ignored `.generated/*.epub`: three original demonstration publications, with
  original text and covers, complete descriptions, local resources, fixed ZIP
  timestamps, and MIT rights metadata. No personal or third-party books are used.

## Classic-book screenshot inputs

The refreshed five-scene capture requires this **explicit network opt-in**:

```sh
python3 store-assets/scripts/prepare-assets.py --classics
```

[classic-sources.json](classic-sources.json) pins 15 Project Gutenberg EPUBs
and one Tenniel illustration by SHA-256. Downloads are cached in ignored
`.generated/classics-sources/`; every reuse verifies the pin. Missing inputs
are downloaded only in this mode. A changed source fails closed: review it and
update its pin deliberately, rather than accepting new bytes automatically.
The default command remains offline and prepares the historical original demos;
it is not the input for the refreshed capture.

The script preserves the classics' text, metadata, and rights notices, replacing
cover image bytes with original Ambra typographic artwork. It checks every
prepared archive and XML document and records source/output hashes in ignored
`.generated/books.json`. Alice is a documented custom reading copy: Carroll's
PG11 text plus Tenniel's “Alice meets the Caterpillar” from PG114, inserted at
the start of chapter V. PG11 alone is not that illustrated edition.

The sources declare **public domain in the USA**, not worldwide public-domain
clearance. See [ATTRIBUTIONS.md](ATTRIBUTIONS.md) for source credits and limits.
No complete book, cached download, personal library, or generated reading copy
is committed, packaged with the extension, or uploaded as a release asset.

The [official icon guidance](https://developer.chrome.com/docs/webstore/images)
requires the 128px icon inside the submitted ZIP. The
[manifest reference](https://developer.chrome.com/docs/extensions/reference/manifest/icons)
says that icon is used by the store and installation UI. The
[listing guide](https://developer.chrome.com/docs/webstore/cws-dashboard-listing#graphic_assets)
also lists a store-icon asset, but does not establish that an independent dashboard
override replaces the ZIP requirement. Do not depend on an unverified override.

The packaged `apps/extension/public/icons/icon128.png` uses the same padded artwork.
To synchronize it after changing the artwork, run:

```sh
python3 store-assets/scripts/prepare-assets.py --update-extension-icon
```

This leaves the 16px/48px toolbar/management icons unchanged. Normal packaging
includes the compliant icon without an ad hoc ZIP edit. The script preserves
an already-padded 128px source instead of applying padding twice. Never modify
the live development output.

## Capture only when the browser slot is available

The capture script refuses to launch unless explicitly enabled, never builds
Ambra, and refuses the live `apps/extension/dist` directory. It uses a fresh owned
profile under `.generated`, disables network access, imports only the generated
books, and captures the real application UI without replacing text or styles.
Its own profile is removed when it finishes.

For a **preview**, against an already built isolated candidate:

```sh
AMBRA_STORE_ALLOW_BROWSER=1 \
  AMBRA_STORE_EXTENSION_PATH="$PWD/dist/beta-release/extension" \
  node store-assets/scripts/generate-images.mjs
```

Do not run this while another agent/session owns the browser-validation slot.
Preview mode writes images and provenance to ignored
`store-assets/.generated/previews/`, leaving checked-in images untouched.
These editorial previews are not release acceptance. Inspect them all before
deciding the capture is ready; no raster commit is needed for script validation.
Use a fresh isolated build for a current-UX preview; the example candidate path
must not be assumed to contain the latest source. Preview provenance records
dirty source honestly and does not verify a release package.

For a final release capture, first merge
the approved runtime fixes and source-version/materials update, then build the
chosen clean `main` commit. The padded 128px source icon is already included. Prepare
the classic reading copies **before packaging**, and verify the worktree is still clean:

```sh
python3 store-assets/scripts/prepare-assets.py --classics
git status --porcelain
```

If preparation changes tracked assets (for example because local fonts differ),
resolve those changes through an asset PR before the final release, not by
silently packaging a dirty checkout. Build/package the clean commit with the
approved release process, then capture that exact already-packaged candidate:

```sh
AMBRA_STORE_ALLOW_BROWSER=1 \
  AMBRA_STORE_RELEASE_CAPTURE=1 \
  AMBRA_STORE_SOURCE_SHA="$(git rev-parse HEAD)" \
  AMBRA_STORE_EXTENSION_PATH="$PWD/dist/beta-release/extension" \
  node store-assets/scripts/generate-images.mjs
```

**Final output is ignored `dist/beta-release/artifacts/store-assets/`, not the
checked-in preview directory.** It contains all five screenshots, copies of
`icon-store-128.png` and `promo-tile-440x280.png`, and its own `asset-provenance.json`.
No final screenshot/provenance commit or recursive recapture is needed.

Release capture requires `main`, a completely clean worktree, and an asserted
SHA matching `HEAD`. It verifies the package metadata's clean source commit and
ZIP checksum, then compares every captured candidate file byte-for-byte against
that ZIP before and after capture. Final provenance records the source SHA,
candidate-tree hash, ZIP filename/checksum, manifest version, and asset hashes.
Capture explicitly requires `PUBLIC` package metadata. The shared integrity
verifier still defaults to `UNLISTED` for the historical uploader; screenshot
validation does not authorize uploads or relax that uploader's publication guard.
It does not change the ZIP, `SHA256SUMS`, or `release.json`; output guards reject
redirected/symlink directories and filenames outside the store-asset allowlist.
There is no arbitrary output-directory override.

Run packaging **before** final capture: the packager clears its artifact directory,
so repackaging would remove the captured handoff folder and require a new capture.
Final capture itself leaves the tracked worktree clean. Font/platform/browser
differences may change raster bytes, so review recaptures rather than assuming
cross-platform pixel identity.

## Five views to review

| Image                                 | Intended real UI                                            |
| ------------------------------------- | ----------------------------------------------------------- |
| `screenshot-reader-1280x800.png`      | Alice chapter V, complete Tenniel illustration, three annotations, mapped progress |
| `screenshot-library-1280x800.png`     | Current Library with Continue reading and a fifteen-book collection of original covers, including Jane Eyre, Dickens, and three French editions |
| `screenshot-inspector-1280x800.png`   | Right-docked Inspector locating the current Alice passage in real source |
| `screenshot-annotations-1280x800.png` | Pinned overflowing notes panel, three page annotations, and a saved meaningful note popup |
| `screenshot-shortcuts-1280x800.png`   | Platform-specific shortcut reference opened through Help    |

The fresh-profile capture acknowledges the real first-reading welcome before
photographing the reader, and verifies paginated mode and the white page theme
through shared **Ambra settings**. **Contents**, **Annotations**, book details,
and the toolbar's direct **Help & About** action are opened through the real UI;
selection is limited to the prepared Alice text. Ten original notes and three
bookmarks are saved through those controls. The pinned Annotations panel uses
**Show → Notes**, not the historical tabs. Capture waits for stable book-wide
page mapping, checks the complete illustration and three visible annotation
markers, verifies real notes-panel overflow and a fully visible saved-note
popup, and decodes all 15 collection covers. The current Library also contains
a separate Continue reading card; it is not counted as a sixteenth book.
The screenshot preserves the real viewport and scrolling layout, so not every
collection cover is fully visible at once. The expanded Help is checked before
opening its platform-specific keyboard-shortcut reference.
Upload in **reader, library, Inspector, annotations, shortcuts** order.
No application text,
styles, library data, or welcome preferences are replaced behind the UI.

All captures must be 1280×800, full bleed, square-cornered, and legible. The small
promo must be 440×280. Check every image visually, ensure no personal data or
browser/debug chrome appears, and verify that the provenance points to the
chosen clean candidate before upload.

Chrome's [official requirements](https://developer.chrome.com/docs/webstore/images)
(checked 2026-09-26) allow at least one and at most five screenshots, each
1280×800 or 640×400. This set uses all five at the larger size, plus the required
128×128 PNG icon and 440×280 promo. An optional marquee is not part of this set.

The five checked-in screenshots and their `asset-provenance.json` are historical
original-book **previews**: version `0.0.1`, captured
`2026-09-24T10:12:29.601Z` from clean commit
`0ab8ad3b4fe0dfaf79bf06d00a2ffd31066bdde7`. They are not current-UX or final
release images.

The approved classic-book release set preserved in
`dist/release-history/1.1.0/store-assets/` was captured
`2026-10-01T04:25:39.271Z` against verified `ambra-1.1.0.zip`, from clean commit
`4fc540143352dbd4fd5935007b3738045f671981`. The 1.1.1 handoff reused that
reviewed set explicitly, retaining its 1.1.0 provenance; it did not create exact
1.1.1 screenshots. These pre-overhaul images should not be presented as the
refreshed 2.0.0 UX. A 2.0.0 submission needs a reviewed final capture of the
merged, packaged 2.0.0 candidate, not a relabeled historical set.

New previews stay in the ignored directory, so no tracked screenshot/provenance
churn is necessary.
Historical library/reader screenshots with third-party samples retain
their [attributions](ATTRIBUTIONS.md). The new covers and commentary are original
Ambra material under MIT; incorporated classic text and Tenniel art retain their
own rights status, not an MIT relicensing. For a release upload, use only
the reviewed images and provenance from the ignored final-output directory above.
