# Ambra Chrome Web Store listing notes

## Product

- **Name**: Ambra EPUB Reader
- **Category**: Productivity
- **Distribution**: Unlisted. Anyone with the installation URL can install;
  the listing does not appear in store search or browsing. Share the URL with
  friends for the initial beta; no trusted-tester allowlist is required.
  Change to Public in the dashboard when ready for a listed launch.

## Short description

Import, organize, and read EPUB3 books locally in Chrome with offline storage, resume reading, bookmarks, and highlights.

Character count: 117

## Single purpose

Ambra lets users import, store, organize, and read EPUB3 e-books entirely within Chrome, using an in-house-built reading engine with no server-side reader or third-party reading dependency.

## Suggested full description

Ambra is a local-first EPUB3 reader for Chrome built from scratch for real book reading, not just file inspection.

Import EPUB books into an on-device library, reopen them later, and keep your place automatically. Ambra supports both reflowable and fixed-layout EPUBs, a dedicated full-tab reader, bookmarks, highlights, saved reading progress, and recorded narration in compatible books.

Your library stays on your device. Ambra does not require an account or run analytics or ads. It can fetch EPUB downloads from websites for automatic import. When you open a book missing a description, it may send title, author, and ISBN to Open Library or Wikipedia for a summary. See the privacy policy for network activity and controls.

This is an early unlisted beta. Keyboard and accessibility-tree checks are automated;
live VoiceOver/NVDA testing remains pending. Do not claim certified accessibility
or exact virtual-cursor reading-position support.

## Permission justifications

### unlimitedStorage

Ambra stores complete EPUB files, extracted cover images, and per-book reading data locally for offline use. `unlimitedStorage` prevents normal browser quota pressure from breaking larger personal libraries and keeps storage local on the device rather than requiring a remote sync service.

### downloads

Ambra recognizes likely EPUB downloads at creation and completion. With website
access, it opens the Library and imports the download URL. The native download
continues until import succeeds; Ambra may then cancel the redundant download
and erase its canceled download record. Completed downloads are retained and can
trigger a library-import notification. It does not read arbitrary downloaded files.

### notifications

Ambra uses notifications only to show the optional “this looks like an EPUB — add it to Ambra?” prompt after an EPUB download completes. Notifications are not used for advertising, marketing, or background engagement.

### Website access (`*://*/*`)

EPUB download links can originate on arbitrary HTTP/HTTPS websites and redirect to
other download hosts. Host access permits Ambra's extension page to fetch those
books and query Open Library/Wikipedia for missing descriptions. It does not
inject content scripts into ordinary sites. If a user withholds site access,
automatic import falls back to Chrome's download/manual file import. This broad
permission must be declared and justified in the store dashboard, not described
as absent or optional in the manifest.
Restricting Chrome site access is not a guaranteed metadata-lookup opt-out:
public APIs may still receive requests. Reading offline prevents lookups from
reaching those services; there is currently no in-app lookup opt-out.

## Privacy/data-use notes for the dashboard

- **Main local data handled**: imported EPUB files, extracted metadata/cover images, reading progress, bookmarks, highlights/notes, reader preferences.
- **Where it is stored**: locally on-device in an IndexedDB database named `ambra-library`.
- **Third-party transmission**: automatic imports request the EPUB download URL
  from its website/redirect hosts; when an opened book lacks a description, Ambra
  may send title, author, and ISBN to `openlibrary.org` and, if needed,
  `en.wikipedia.org`. These destinations receive normal request metadata.
- **Not uploaded by Ambra**: EPUB contents, reading progress, bookmarks,
  highlights, notes, or browsing-history logs.
- **Ads / analytics / tracking**: none found in the current codebase.
- **Sale of data**: none.
- **Account creation**: none.
- **Host permissions requested**: `*://*/*` (HTTP/HTTPS).
- Dashboard disclosures must reflect the metadata requests even though Ambra
  operates no server. Do not equate "no analytics" with "no data leaves the device."

## Privacy policy URL

The public repository's rendered Markdown policy is the canonical policy.
Paste this direct URL into the Chrome Web Store dashboard's privacy policy field:

<https://github.com/BCWalters/ambra/blob/main/store-assets/privacy-policy.md>

Google's [privacy policy requirements](https://developer.chrome.com/docs/webstore/program-policies/privacy/)
require an accessible policy link, not a separate website. Keep the repository
public and the file at this stable path. Policy updates go through an Ambra PR
and are visible at this URL after merge to `main`; no second deployment or HTML
copy is required. Before submission, verify the rendered policy without signing
in and check that its disclosures and effective date match the candidate.

## Release assets

Follow [BETA_RELEASE.md](BETA_RELEASE.md). Existing official-sample screenshots
require [source attributions and CC license notices](ATTRIBUTIONS.md), not a
blanket MIT claim. Include those notices with the listing if using these images;
see the public-domain jurisdiction caveat. Prefer capturing the actual candidate
with original synthetic books, not a developer's personal library.
