# Ambra 1.0.3 manual store update

This update targets the existing Public Chrome Web Store item,
`mcjkkebkhifgkkbahlcapjlnaihocogj`. The owner submitted 1.0.2 and requested a
verified 1.0.3 ZIP and notes for manual upload. Preparation does not upload,
submit, publish, cancel a pending review, or change distribution.

## What's new in 1.0.3

Copy-ready update notes, separate from the unchanged main description:

```text
- Improved pagination for simple, single-column tables of contents, letting them flow across pages without unnecessary table zoom controls.
- Fixed repeated image strips on the following page in some illustrated EPUBs.
- EPUB import errors now identify the affected file.
- Importing an identical EPUB now says it is already in your library, with Read now available and your saved reading data preserved.
```

The contents-table and footer-clipping fix is in #243, import feedback in #248,
and the image line-break correction in #250. Complex tables retain the table
viewer. Duplicate detection uses identical archive contents, not matching titles;
revised archives remain separate books.

The image correction does not resize illustrations or change publisher styles.
A following back link can still occupy the next page when an image fills its
page; the repeated image strip is removed.

## Store fields and release boundaries

Keep the existing name, summary, description, screenshots, icon, promotional
graphics, category, regions, and **Public** visibility unchanged. No listing
copy, privacy disclosure, permission, or host-access change is required.
Do not append these update notes to the main description.

Keep the existing official destinations:

- Website: <https://ambraepub.org/>
- User guide: <https://ambraepub.org/en/docs/>
- Support: <https://ambraepub.org/en/docs/report-issues/>
- Privacy policy: <https://ambraepub.org/en/privacy/>

The website's immutable documentation pin is a separate deployment decision;
this release preparation does not advance it.

## Build from merged source

Root package, extension package, and manifest versions must all be **1.0.3**.
First merge the release preparation through the required PR checks, then build
the final candidate from clean, up-to-date `main`.

The packager clears `dist/beta-release/artifacts`. Preserve the previous ZIP,
checksums, metadata, and handoff together before running it. The 1.0.2 handoff
has been preserved locally in `dist/release-history/1.0.2/`.
The isolated build does not overwrite the live unpacked extension in
`apps/extension/dist` or the UX-review build in `apps/e2e/.extension-build`.

```sh
git branch --show-current
git status --porcelain
git rev-parse HEAD
node --test .github/scripts/release.test.mjs
node .github/scripts/package-extension.mjs
(cd dist/beta-release/artifacts && shasum -a 256 -c SHA256SUMS)
unzip -tq dist/beta-release/artifacts/ambra-1.0.3.zip
unzip -p dist/beta-release/artifacts/ambra-1.0.3.zip manifest.json
```

Verify `release.json` records version `1.0.3`, the merged source SHA,
`dirty: false`, and `publication: "PUBLIC"`. This metadata is not evidence of
any store action. Keep the ZIP, `SHA256SUMS`, and `release.json` together.

Test the packaged extension with
`AMBRA_E2E_EXTENSION_PATH="$PWD/dist/beta-release/extension"`. Cover new and
duplicate imports, filename errors, navigation, and image rendering. Record
actual checks and skips in the final artifact handoff; source-branch validation
is not a substitute for verifying the finished package.

## Owner-only submission

1. Check the existing item's dashboard for its current version and pending
   review. Confirm 1.0.3 exceeds every version already uploaded; stop if it does
   not. Do not cancel an in-progress review as part of this preparation.
2. Upload only the verified `ambra-1.0.3.zip`, not notes or integrity files.
   Never patch a finished ZIP.
3. Preserve the existing listing, graphics, privacy/permission disclosures,
   Public visibility, and regions. Review the update, then submit when ready.
4. Record the actual dashboard outcome separately; a passing build is not a
   submitted or published release.

Do not dispatch the legacy Unlisted upload/publish workflow. Its guard
intentionally rejects Public artifacts.

The owner reviewed the table, filename-error, and image-pagination UX.
Automated tests and those reviews are not a new final-package VoiceOver/NVDA
certification. Do not uninstall the working extension or clear its library to
test this package.
