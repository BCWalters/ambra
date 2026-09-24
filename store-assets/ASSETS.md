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
  AMBRA_STORE_EXTENSION_PATH="$PWD/dist/reader-ui-dismissal" \
  node store-assets/scripts/generate-images.mjs
```

Do not run this while another agent/session owns the browser-validation slot.
Preview mode updates checked-in `store-assets/` images and provenance; those
editorial previews are not release acceptance.

For the final capture, first merge the reader-dismissal fix and build the chosen
clean `main` commit, including the approved 128px source-icon update. Prepare
the original fixtures **before packaging**, and verify the worktree is still clean:

```sh
python3 store-assets/scripts/prepare-assets.py
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
It does not change the ZIP, `SHA256SUMS`, or `release.json`; output guards reject
redirected/symlink directories and filenames outside the store-asset allowlist.
There is no arbitrary output-directory override.

Run packaging **before** final capture: the packager clears its artifact directory,
so repackaging would remove the captured handoff folder and require a new capture.
Final capture itself leaves the tracked worktree clean. Font/platform/browser
differences may change raster bytes, so review recaptures rather than assuming
cross-platform pixel identity.

## Five views to review

| Image | Intended real UI |
| --- | --- |
| `screenshot-library-1280x800.png` | Library with original demo covers |
| `screenshot-reader-1280x800.png` | Original prose and reading controls |
| `screenshot-annotations-1280x800.png` | Actual saved highlight, bookmark, and annotation controls |
| `screenshot-inspector-1280x800.png` | Actual EPUB source in Inspector |
| `screenshot-shortcuts-1280x800.png` | Platform-specific shortcut reference opened through Help |

All captures must be 1280×800, full bleed, square-cornered, and legible. The small
promo must be 440×280. Check every image visually, ensure no personal data or
browser/debug chrome appears, and verify that the provenance points to the
chosen clean candidate before upload.

The five checked-in screenshots have been regenerated from original demo books.
Check checked-in `asset-provenance.json` for their status: **preview** is not a final
release capture even if application changes were committed while preparing the
assets. Historical library/reader screenshots with third-party samples retain
their [attributions](ATTRIBUTIONS.md). The new generated prose, covers, and original
screenshots are Ambra project material under MIT. For a release upload, use only
the reviewed images and provenance from the ignored final-output directory above.
