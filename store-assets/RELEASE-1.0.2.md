# Ambra 1.0.2 manual store update

The owner confirms **1.0.1 is live and Public**. This handoff prepares an update
to that same Chrome Web Store item, not a new listing or a visibility change.
Preparation does not authorize uploading, submitting, publishing, canceling a
review, or dispatching store automation.

## What's new in 1.0.2

Copy-ready update notes, separate from the unchanged main description:

```text
- Added progress landmarks to the reading-position bar, with a Show/Hide setting.
- Corrected chapter names when previewing a reading-position jump.
- Improved pagination to keep notes and other publisher-marked blocks together when they fit on a page.
- Added eBooks.com to the library's book-discovery links.
- Updated the user guide and privacy links to the official Ambra website.
```

The landmarks and chapter-label work is in #237; pagination addresses #238.
Book discovery was added in #236. EPUB discovery scripts are contributor tooling,
not a new extension feature. Break avoidance is best effort: oversized blocks
can still split, and an explicit navigation anchor takes precedence.

## Exact store-field changes

Keep the existing name, short summary, category, regions, **Public** visibility,
screenshots, icon, promotional graphics, and all main-description prose.
Do not append the update notes above to the main description.

In the existing full description, replace only these two URL lines:

```text
User guide: https://ambraepub.org/en/docs/
Privacy: https://ambraepub.org/en/privacy/
```

The GitHub source line and feedback address remain unchanged:

```text
Source: https://github.com/BCWalters/ambra
Feedback: AmbraEPUB@outlook.com
```

Set the separate **Privacy policy URL** field to:

```text
https://ambraepub.org/en/privacy/
```

For the listing's **official website/homepage URL**, use:

```text
https://ambraepub.org/
```

For the listing's **Support URL**, use the final guide page:

```text
https://ambraepub.org/en/docs/report-issues/
```

Deploy and check that page before submitting the store update. It offers issue
reports and feature requests through GitHub, with email as an alternative.

[store-listing.md](store-listing.md) contains the approved description with the
two URL replacements. If the live dashboard prose differs, preserve that prose
and replace its URLs rather than overwriting it wholesale from this file.

The [privacy-policy.md](privacy-policy.md) disclosures and effective date are
unchanged. The website imports the policy from a pinned source commit; verify
the hosted guide and policy over HTTPS without signing in. A future policy
change requires updating the website source pin and deploying it, not only
merging the Ambra source.

## Build from the merged source

Root package, extension package, and manifest versions are **1.0.2**. The manifest
summary, permissions, host access, and existing store graphics are unchanged.
First merge the implementation and preparation through the required PR checks.
Build the final candidate only from clean, up-to-date `main`.

The packager clears `dist/beta-release/artifacts`; preserve any needed previous
handoff first. It uses an isolated extension directory and does not overwrite
the live unpacked reader at `apps/extension/dist`.

```sh
git branch --show-current
git status --porcelain
git rev-parse HEAD
node --test .github/scripts/release.test.mjs
node .github/scripts/package-extension.mjs
(cd dist/beta-release/artifacts && shasum -a 256 -c SHA256SUMS)
unzip -tq dist/beta-release/artifacts/ambra-1.0.2.zip
unzip -p dist/beta-release/artifacts/ambra-1.0.2.zip manifest.json
```

- Verify `release.json` records `version: "1.0.2"`, the merged source SHA,
  `dirty: false`, and `publication: "PUBLIC"`. The last field records the intended
  target, not proof of a dashboard action.
- Keep the archive, `SHA256SUMS`, and `release.json` together.
- Record actual lint, type, unit, release, and browser results, including skips.
  Use `AMBRA_E2E_EXTENSION_PATH="$PWD/dist/beta-release/extension"` for packaged
  extension tests. Cover progress landmarks, chapter previews, bookmarks,
  reading-position jumps, and pagination.
- Do not regenerate screenshots or promotional assets for this update.
- Keep release notes and graphics outside the extension ZIP.

## Owner-only submission

1. Confirm 1.0.2 exceeds every version already uploaded to the existing item,
   `mcjkkebkhifgkkbahlcapjlnaihocogj`. Stop if a higher version is needed; never
   patch a finished ZIP.
2. Upload the verified `ambra-1.0.2.zip` manually.
3. Apply only the URL changes above; keep the main description and images.
4. Review unchanged privacy and permission disclosures. Preserve **Public**
   visibility and existing regions, then submit when ready.
5. Record the actual dashboard outcome separately. Local packaging and passing
   CI do not mean the update was submitted or published.

The legacy Unlisted upload/publish workflow is not for this Public item. Its
artifact guard intentionally rejects `PUBLIC` candidates. Do not set
`CWS_UNLISTED_VISIBILITY_CONFIRMED=true` or dispatch that workflow for this update.

The owner previously tested the landmarks and pagination improvements. That is
not a new final-ZIP assistive-technology test or NVDA certification. Preserve
original EPUBs and annotation exports; do not uninstall or clear the working
extension to test a candidate.
