# Ambra 1.0.0 — manual Chrome Web Store resubmission

**Status: source preparation, not a submitted or final-captured release.**
This guide is a handoff for the owner, not authorization for an agent to operate
the store. Do not access the Google dashboard, dispatch a store workflow, cancel
review, upload, submit, publish, or change distribution as part of preparation.
No credentials belong in this guide, logs, issues, or chat.

## 1. Leave the existing review alone until everything is ready

- [ ] Merge the approved runtime fixes (including note layering), then this
      1.0.0 preparation, through the normal protected-branch process.
- [ ] Keep the **same existing Chrome Web Store listing and extension ID**.
      Do not create a new listing. Preserve **Unlisted**, the current regions, and
      other distribution choices; do not assume 1.0.0 means Public.
- [ ] Confirm 1.0.0 is greater than every version already uploaded/accepted for
      that item before using it. If it is not, stop and prepare a higher version
      in source; never patch the manifest inside a finished ZIP.
- [ ] Keep original EPUBs and export important annotations before changing
      installations. Annotation JSON is not a complete library/progress backup.
      Store, unpacked, and friends-beta installations can have different extension
      IDs, and Chrome profiles have separate storage: books and notes do not migrate
      automatically. Do not uninstall the working reader or clear its data to test.
- [ ] Finish the package, final screenshots, listing, privacy review, and owner
      acceptance below **before considering cancellation of a pending review**.
      A preview, friends-beta ZIP, or successful CI run alone is not this handoff.

## 2. Build and validate the exact merged candidate locally

Use the agreed release checkout on clean `main`, with existing dependencies.
Do not overwrite a live development extension. Commands below only run local
checks/builds; **do not dispatch `beta-release.yml` or run upload/publish scripts**.
Install dependencies only if a missing-dependency failure requires it, using the
frozen lockfile.

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

Stop if preparation changes tracked files: resolve through a PR and restart
from a clean merged commit. The packager builds in `dist/beta-release/extension`,
not `apps/extension/dist`, despite the historical `beta-release` directory name.
Package-only code never contacts Chrome Web Store.

- [ ] Run the relevant unit/browser regression gates on the isolated candidate;
      record the source SHA, exact commands, results, and any skips. Use
      `AMBRA_E2E_EXTENSION_PATH="$PWD/dist/beta-release/extension"` for browser tests.
- [ ] Verify `dist/beta-release/artifacts/release.json` records version `1.0.0`,
      the selected merged commit and `dirty: false`; verify `SHA256SUMS`:

  ```sh
  (cd dist/beta-release/artifacts && shasum -a 256 -c SHA256SUMS)
  unzip -tq dist/beta-release/artifacts/ambra-1.0.0.zip
  unzip -p dist/beta-release/artifacts/ambra-1.0.0.zip manifest.json
  ```

- [ ] Check the root production manifest, 128px padded icon, complete license
      notices, absence of dev-server references/maps/profiles/private books, and
      unchanged permission/host-access declarations. The root package, extension
      package, and manifest are 1.0.0; internal library/test package versions are
      independent and are not Chrome release versions.
- [ ] Smoke-test import, denied-site-access/manual fallback, saved library and
      reading position, first-run welcome, search, native Back/Forward after a jump,
      settings, bookmarks, highlight/note editing and export/import, Inspector, and
      recorded narration using an EPUB that actually supplies narration.
      The three screenshot fixtures are original MIT books, not narration fixtures.
- [ ] Record human checks honestly: the owner previously passed VoiceOver.
      That is not a new test of this final ZIP and does not establish NVDA support
      or accessibility certification. Record any new final-candidate checks and
      untested combinations without inventing evidence.

## 3. Capture and inspect all final assets

Obtain the browser-validation slot. Use [ASSETS.md](ASSETS.md) and only its
original synthetic MIT publications, never a personal or third-party library.
Capture **after** packaging; packaging again deletes the captured handoff.

```sh
AMBRA_STORE_ALLOW_BROWSER=1 \
  AMBRA_STORE_RELEASE_CAPTURE=1 \
  AMBRA_STORE_SOURCE_SHA="$(git rev-parse HEAD)" \
  AMBRA_STORE_EXTENSION_PATH="$PWD/dist/beta-release/extension" \
  node store-assets/scripts/generate-images.mjs
git status --porcelain
```

- [ ] Use only `dist/beta-release/artifacts/store-assets/` for final upload.
      Checked-in historical images and `.generated/previews/` are **not** final.
- [ ] Verify `asset-provenance.json`: `capturePurpose: "release"`, version
      `1.0.0`, clean source, selected SHA, ZIP name/hash matching `release.json`,
      and hashes matching all seven PNGs. The script checks the captured candidate
      byte-for-byte against the packaged ZIP before and after capture.
- [ ] Visually review **each** of the five 1280×800 screenshots (library, reader,
      annotations, Inspector, shortcuts), the 128×128 padded transparent icon, and
      the 440×280 promo. Check legibility, clipping, actual saved annotations,
      original demo content, and absence of personal data/browser-debug chrome.
- [ ] Keep images full-bleed with square corners and no extra padding.
      Chrome allows **1–5 screenshots**, each **1280×800 or 640×400**; use these five
      1280×800 PNGs. A **440×280** small promo and **128×128 PNG** icon are required.
      The icon must also be in the ZIP; a dashboard image does not replace it.
      No optional marquee is needed for this handoff.

## 4. Prepare the listing and privacy fields

- [ ] Review and copy only the intended fields/full description from
      [store-listing.md](store-listing.md), not its internal evidence notes.
      Keep the existing name and category. The 47-character short description
      comes from the manifest. Do not market this as an early beta or claim NVDA,
      EPUB certification, text-to-speech, cloud sync, or no network access.
- [ ] Verify the [canonical privacy policy](https://github.com/BCWalters/ambra/blob/main/store-assets/privacy-policy.md)
      is public without signing in and matches the candidate. No policy deployment
      is needed beyond the merged repository file.
- [ ] Declare local EPUBs, metadata/covers, progress, bookmarks, notes, and
      preferences accurately. No Ambra account, analytics, advertising, or cloud
      sync does **not** mean no data leaves the device: automatic imports contact
      download/redirect hosts; missing-description lookups can send title, author,
      and ISBN to Open Library/Wikipedia with normal request metadata.
- [ ] Review `unlimitedStorage`, `downloads`, `notifications`, `storage`, `alarms`,
      and `*://*/*`
      justifications. Do not describe broad host access as absent or optional in the
      manifest. There is no in-app description-lookup opt-out; restricting Chrome
      site access is not a guaranteed metadata-request block.
      Disclose native download pause/resume/cancellation and the local handoff
      recovery journal/alarm, not just the IndexedDB library.
- [ ] Recheck imported-book backups, annotation exports, contact/guide links,
      distribution, and every graphic against the final package.

## 5. Owner-only dashboard action — later, manually

Only after all prior gates are satisfied, the owner may open the existing item
in the intended publishing account, independently verify its current state and
ID, and decide whether its pending review needs cancellation to replace the
draft. **Do not cancel preemptively**, create a replacement listing, unpublish
the existing item, or change visibility as part of this preparation.

If the owner chooses to proceed, they manually upload the exact verified
`ambra-1.0.0.zip`, replace the listing graphics with the reviewed final handoff,
save the copy/privacy fields, and reconfirm **Unlisted** and current regions.
They then resolve dashboard warnings and explicitly choose review/publication
timing (deferred publication is available). Submission is not approval, and
approval is not proof of installation or visibility. Do not automate retries
after an ambiguous result.

After approval/publication, the owner verifies the version and an installation
from the **existing direct URL** in a separate clean Chrome profile, with no
trusted-tester allowlist, before sharing it. Preserve the prior working profile.

## Official references (checked 2026-09-26)

- [Images: icon, promo, screenshot requirements](https://developer.chrome.com/docs/webstore/images)
- [Updating an existing item, increasing versions, review and deferred publication](https://developer.chrome.com/docs/webstore/update)
- [Distribution and visibility](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution)

## Final owner handoff record (complete later, not assumed)

| Evidence                                          | Value                                                                                     |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Clean merged `main` SHA                           | Pending final release                                                                     |
| Package version / filename / SHA-256              | Pending final package                                                                     |
| Unit/type/lint/browser commands and results       | Pending final candidate                                                                   |
| Human AT checks and untested combinations         | Prior owner-reported VoiceOver pass; final-candidate record pending; NVDA not established |
| Final asset folder / provenance / visual approval | Pending clean-main capture                                                                |
| Existing item ID / Unlisted / regions verified    | Owner-only; not accessed during preparation                                               |
| Owner approval and review/publication choice      | Pending                                                                                   |
