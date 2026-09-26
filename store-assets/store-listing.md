# Ambra 1.0.0 Chrome Web Store listing notes

Prepared for the existing listing's **manual, owner-only resubmission**.
Follow [RESUBMISSION.md](RESUBMISSION.md); this file does not authorize a
dashboard action, workflow dispatch, upload, review cancellation, or submission.

## Product

- **Name**: Ambra EPUB Reader
- **Category**: Productivity > Tools (the saved dashboard category).
- **Distribution**: Unlisted. Anyone with the installation URL can install;
  the listing does not appear in store search or browsing. Share the URL with
  friends; no trusted-tester allowlist is required. Preserve the existing
  visibility and regions. A Public launch requires a separate explicit decision.

## Short description

A polished, accessible EPUB3 reader for Chrome.

Character count: 47. This read-only dashboard summary comes from the uploaded
package's manifest `description`; it is not separately editable listing copy.
Accessibility is not a certification; compatibility varies with the publication
and assistive technology.

## Single purpose

Ambra lets users read and work with their EPUB library in Chrome: import and organize books, navigate and annotate their content, and inspect the files that make up a publication.

## Suggested full description

Read comfortably. Keep your thinking alongside the text. Look deeper when you need to.

Ambra brings a personal EPUB library and an integrated EPUB Inspector to Chrome.

MAKE ROOM FOR READING

- Import saved EPUBs into an on-device library, browse covers, search and sort your collection, and return to your saved position.
- Read reflowable and fixed-layout books in a dedicated full-tab reader. Adjust text, page width, brightness, and reader/page themes; choose pagination, a single-page view, or scrolling for reflowable books. Fixed-layout artwork keeps its page design.
- DRM-protected EPUBs are not supported.
- Find passages with book search, the table of contents, bookmarks, and the reading-position control.
- Use Chrome's native Back and Forward buttons to return after jumps from search, contents, bookmarks, notes, or links. Ordinary page turns and scrolling update the current stop rather than filling your history.
- Listen to recorded narration with synchronized highlighting when the EPUB includes it. This is not automatic text-to-speech.

KEEP YOUR NOTES

- Highlight passages, add text notes, and bookmark places to revisit. Browse saved passages in the bookmarks and highlights panel; bookmark ribbons on the progress bar help you find your place once pagination is ready.
- Export and import EPUB Annotations 1.0 JSON to back up or share annotations separately from the book. Use the same book or edition for best results; compatibility with other annotation tools varies.

EXPLORE THE EPUB

- Browse a publication's files, metadata, reading order, and resource inventory in EPUB Inspector.
- Read highlighted source and preview supported images, audio, and video.
- From the reader, locate a selected passage or current reading position in source, then use Show in book to return from a source element to the page.
- Find supported static references to an image or stylesheet, with source snippets and line numbers.

Inspector is read-only: it does not change your book, edit EPUBs, or replace EPUBCheck or an accessibility audit.

HELP WHEN YOU NEED IT

- Start with a short welcome to reading, and reopen reading tips from Help & About.
- Open shared Help & About from the Library, reader Settings, or Book details. Settings groups appearance, reading modes, and language choices in keyboard-navigable flyouts.
- See platform-specific keyboard shortcuts, including book search, bookmarks, page navigation, reading-mode selection, and the shortcut popup. You can disable Ambra shortcuts with one local preference.
- Open the user guides on GitHub, review diagnostics before sharing them, and send feedback by email or GitHub issue. Diagnostics are not sent automatically.

LOCAL-FIRST, WITH CLEAR NETWORK DISCLOSURES

Your library stays in your browser profile. Ambra does not require an account or run analytics or ads. It can fetch EPUB downloads from websites for automatic import. When you open a book missing a description, it may send title, author, and ISBN to Open Library or Wikipedia for a summary. There is currently no in-app lookup opt-out; see the privacy policy for details.

Keep original EPUBs and annotation exports as backups. Ambra has no cloud sync, and removing the extension or clearing its data can remove your local library. Different Chrome profiles or extension IDs do not automatically share books or notes.

Designed for keyboard and screen-reader use. Compatibility varies by book, browser, and assistive technology. Ambra does not claim complete EPUB conformance or certified accessibility.

User guide: https://github.com/BCWalters/ambra/blob/main/docs/user-guide/README.md
EPUB Inspector guide: https://github.com/BCWalters/ambra/blob/main/docs/user-guide/epub-inspector.md
Source: https://github.com/BCWalters/ambra
Privacy: https://github.com/BCWalters/ambra/blob/main/store-assets/privacy-policy.md
Feedback: AmbraEPUB@outlook.com

### Internal claim/review notes (not listing copy)

The owner reports that human VoiceOver acceptance passed before this preparation.
Do not relabel that completed check as pending, or invent its OS/browser versions.
The source version bump and screenshots are not a new final-candidate AT test.
NVDA acceptance is not established; do not claim it, universal screen-reader
compatibility, certified accessibility, or complete EPUB conformance. Automated
keyboard, accessibility-tree, and native-event checks are not substitutes for
human AT testing. Record any final-candidate checks separately in the handoff.
Keep the existing listing identity; do not create a parallel beta listing.

## Permission justifications

### unlimitedStorage

Ambra stores complete EPUB files, extracted cover images, and per-book reading data locally for offline use. `unlimitedStorage` prevents normal browser quota pressure from breaking larger personal libraries and keeps storage local on the device rather than requiring a remote sync service.

### downloads

Ambra recognizes likely EPUB downloads at creation and completion. With website
access, it can pause the native download, open the Library, and import the
download URL. Successful import cancels the redundant in-progress download and
removes its canceled record; failure or an abandoned handoff attempts to resume
Chrome's download. The Library also lets the user cancel an active import and its
pending native download. Completed downloads are retained and can trigger a
library-import notification. It does not read arbitrary downloaded files.

### notifications

Ambra uses notifications only to show the optional “this looks like an EPUB — add it to Ambra?” prompt after an EPUB download completes. Notifications are not used for advertising, marketing, or background engagement.

### storage

Ambra keeps a small local recovery journal for automatic EPUB imports in
`chrome.storage.local`: download/tab/document identifiers, timestamps, and
handoff status. It lets a restarted worker recover a paused download instead
of stranding it. This is separate from the IndexedDB book library and is not
cloud sync or browsing-history collection.

### alarms

Ambra schedules a local recovery check while download handoffs are pending.
It restores eligible paused downloads after failed or abandoned imports, retries
transient recovery failures, and clears the alarm when the journal is empty.
It is not a marketing notification, analytics timer, or remote polling service.

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
- **Where it is stored**: the library is in local IndexedDB `ambra-library`;
  download handoff/recovery identifiers and status use `chrome.storage.local`.
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

Follow [RESUBMISSION.md](RESUBMISSION.md) and [ASSETS.md](ASSETS.md). New captures
use only the original synthetic publications produced by the asset generator.
Do not submit a draft capture as evidence of a clean merged release candidate.
Historical official-sample screenshots retain their [attributions and CC
license notices](ATTRIBUTIONS.md); replacing current images does not relicense
historical copies.

The padded `icon-store-128.png` is prepared for store use. The official guidance
also requires a 128px icon inside the submitted ZIP. The source-controlled
128px icon already uses that padded artwork, as described in [ASSETS.md](ASSETS.md).
Leave 16px/48px icons alone. Do not manually modify a final ZIP or assume an independent
dashboard upload replaces its manifest icon.
