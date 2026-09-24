# Ambra Chrome Web Store listing notes

## Product

- **Name**: Ambra EPUB Reader
- **Category**: Productivity > Tools (the saved dashboard category).
- **Distribution**: Unlisted. Anyone with the installation URL can install;
  the listing does not appear in store search or browsing. Share the URL with
  friends for the initial beta; no trusted-tester allowlist is required.
  Change to Public in the dashboard when ready for a listed launch.

## Short description

A polished, accessible EPUB3 reader for Chrome.

Character count: 47. This read-only dashboard summary comes from the uploaded
package's manifest `description`; it is not separately editable listing copy.
The beta assistive-technology limitations below still apply.

## Single purpose

Ambra lets users read and work with their EPUB library in Chrome: import and organize books, navigate and annotate their content, and inspect the files that make up a publication.

## Suggested full description

Read comfortably. Keep your thinking alongside the text. Look deeper when you need to.

Ambra brings a personal EPUB library and an integrated EPUB Inspector to Chrome.

MAKE ROOM FOR READING

- Import saved EPUBs into an on-device library and return to your saved position.
- Read reflowable and fixed-layout books in a dedicated full-tab reader. Adjust text and themes; choose pagination or scrolling for reflowable books.
- DRM-protected EPUBs are not supported.
- Find passages with book search, the table of contents, bookmarks, and the reading-position control.
- Listen to recorded narration with synchronized highlighting when the EPUB includes it. This is not automatic text-to-speech.

KEEP YOUR NOTES

- Highlight passages, add text notes, and organize bookmarks with labels.
- Export and import EPUB Annotations 1.0 JSON to back up or share annotations separately from the book. Use the same book or edition for best results; compatibility with other annotation tools varies.

EXPLORE THE EPUB

- Browse a publication's files, metadata, reading order, and resource inventory in EPUB Inspector.
- Read highlighted source and preview supported images, audio, and video.
- From the reader, locate a selected passage or current reading position in source, then use Show in book to return from a source element to the page.
- Find supported static references to an image or stylesheet, with source snippets and line numbers.

Inspector is read-only: it does not change your book, edit EPUBs, or replace EPUBCheck or an accessibility audit.

HELP WHEN YOU NEED IT

- Open shared Help & About from the Library, reader Settings, or Book details.
- See platform-specific keyboard shortcuts, including book search, bookmarks, page navigation, reading-mode selection, and the shortcut popup. You can disable Ambra shortcuts with one local preference.
- Open the user guides on GitHub, review diagnostics before sharing them, and send feedback by email or GitHub issue. Diagnostics are not sent automatically.

LOCAL-FIRST, WITH CLEAR NETWORK DISCLOSURES

Your library stays in your browser profile. Ambra does not require an account or run analytics or ads. It can fetch EPUB downloads from websites for automatic import. When you open a book missing a description, it may send title, author, and ISBN to Open Library or Wikipedia for a summary. There is currently no in-app lookup opt-out; see the privacy policy for details.

Keep original EPUBs and annotation exports as backups. Ambra has no cloud sync, and removing the extension or clearing its data can remove your local library.

This is an early unlisted beta. Screen-reader support is still being tested; compatibility varies by book, browser, and assistive technology. Ambra does not claim complete EPUB conformance or certified accessibility.

User guide: https://github.com/BCWalters/ambra/blob/main/docs/user-guide/README.md
EPUB Inspector guide: https://github.com/BCWalters/ambra/blob/main/docs/user-guide/epub-inspector.md
Source: https://github.com/BCWalters/ambra
Privacy: https://github.com/BCWalters/ambra/blob/main/store-assets/privacy-policy.md
Feedback: AmbraEPUB@outlook.com

### Internal claim/review notes (not listing copy)

Live VoiceOver/NVDA acceptance remains pending. Automated keyboard, accessibility-tree,
and native-event checks are not a substitute. Do not claim exact virtual-cursor
reading-position support or silently mark the runbook's manual acceptance gate passed.
The initial Unlisted listing keeps the product name above; a separate parallel
testing listing would need the Chrome beta-name/description treatment.

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

Follow [BETA_RELEASE.md](BETA_RELEASE.md) and [ASSETS.md](ASSETS.md). New captures
use only the original synthetic publications produced by the asset generator.
Do not submit a draft capture as evidence of a clean merged release candidate.
Historical official-sample screenshots retain their [attributions and CC
license notices](ATTRIBUTIONS.md); replacing current images does not relicense
historical copies.

The padded `icon-store-128.png` is prepared for store use. The official guidance
also requires a 128px icon inside the submitted ZIP. Prefer the minimal approved
source-controlled 128px icon update described in [ASSETS.md](ASSETS.md), leaving
16px/48px icons alone. Do not manually modify a final ZIP or assume an independent
dashboard upload replaces its manifest icon.
