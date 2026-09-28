# Ambra 1.0.1 submission preparation

This is a manual, owner-only update of the existing Chrome Web Store listing.
Version 1.0.0 is already approved and published unlisted, as reported by the
owner. Preparation does not authorize a store upload, submission, publication,
workflow dispatch, or distribution change. Keep the existing item and extension
ID, Unlisted visibility, and current regions.

## What's new in 1.0.1

- Added a table viewer with zoom and scrolling.
- Fixed background text showing through transparent images in the image viewer.
- Fixed some contents links and footnotes failing to reach their destinations.
- Adjusted the reading-position slider's focus indicator to avoid overlapping nearby controls.

These changes were merged in #227, #230, #232, and #233. The owner visually
accepted the table and scrubber fixes before release preparation.

## Source and listing

- Root package, extension package, and Chrome manifest versions are **1.0.1**.
  Internal engine, shell, and test package versions remain independent.
- The approved manifest summary is **115 characters**:

  > Read, annotate, and explore EPUBs in Chrome with a personal library, flexible reading settings, and EPUB Inspector.

- Copy the full description from [store-listing.md](store-listing.md), excluding
  the internal review notes and permission justifications.
- Permissions and the [privacy policy](privacy-policy.md) are unchanged.
- No runtime changes are part of this release-preparation change.

## Build and validate

Merge the preparation PR through the normal required CI gate. Build from clean,
up-to-date `main`, not the live unpacked extension. Preserve any previous release
handoff before packaging: the packager clears `dist/beta-release/artifacts`.

```sh
git branch --show-current
git status --porcelain
git rev-parse HEAD
pnpm typecheck
pnpm lint
node --test .github/scripts/release.test.mjs
python3 store-assets/scripts/prepare-assets.py
git status --porcelain
node .github/scripts/package-extension.mjs
```

Stop if preparation changes tracked files; resolve through a PR before the final
build. The package is isolated under `dist/beta-release/extension`, and does not
replace `apps/extension/dist`.

- Verify `release.json` records version **1.0.1**, the selected merged commit,
  and `dirty: false`.
- Verify the archive's root manifest includes the exact approved summary and
  unchanged permissions. The packager checks production entry points, assets,
  license notices, and absence of development-server code and unexpected files.
- Run the targeted table, transparent-image, encoded-fragment, and scrubber
  regressions against this exact candidate using
  `AMBRA_E2E_EXTENSION_PATH="$PWD/dist/beta-release/extension"`.
- Record commands, results, and any skips. Required CI additionally covers the
  broader reader, library, import, annotations, and Inspector regressions.

```sh
(cd dist/beta-release/artifacts && shasum -a 256 -c SHA256SUMS)
unzip -tq dist/beta-release/artifacts/ambra-1.0.1.zip
unzip -p dist/beta-release/artifacts/ambra-1.0.1.zip manifest.json
```

## Final screenshots and handoff

Follow [ASSETS.md](ASSETS.md) using only the original synthetic demonstration
books. Capture after packaging, from the exact clean merged candidate:

```sh
AMBRA_STORE_ALLOW_BROWSER=1 \
  AMBRA_STORE_RELEASE_CAPTURE=1 \
  AMBRA_STORE_SOURCE_SHA="$(git rev-parse HEAD)" \
  AMBRA_STORE_EXTENSION_PATH="$PWD/dist/beta-release/extension" \
  node store-assets/scripts/generate-images.mjs
```

Review all five screenshots, the icon, and the promo tile under
`dist/beta-release/artifacts/store-assets`. Verify `asset-provenance.json` records
release capture, version 1.0.1, the selected source SHA, and the exact ZIP hash.
Do not repackage afterward without repeating capture.

The handoff consists of `ambra-1.0.1.zip`, `SHA256SUMS`, `release.json`, final
store assets and provenance, this checklist, and the approved listing copy.
Do not put screenshots or submission notes inside the extension ZIP.

Prior owner visual/VoiceOver acceptance is not a new final-candidate
assistive-technology test. NVDA acceptance is not established. Record new human
checks separately rather than treating automated tests as human acceptance.

## Owner submission

- Confirm 1.0.1 is higher than every version uploaded to the existing item.
  If not, stop and prepare a higher version in source; never patch the ZIP.
- Upload the verified ZIP to that existing item.
- Apply the approved description and confirm the new summary from the package.
- Review the final graphics and unchanged privacy/permission disclosures.
- Preserve Unlisted visibility and existing regions.
- Submit for review only when ready; record the dashboard result separately.

Keep original EPUBs and annotation exports as backups. Do not uninstall or clear
the working extension to test: Chrome profiles and different extension IDs have
separate storage, and annotation exports are not a complete library backup.
