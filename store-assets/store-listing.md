# Ambra 1.0.2 Chrome Web Store listing notes

Prepared for the existing listing's **manual, owner-only update**.
Follow [RELEASE-1.0.2.md](RELEASE-1.0.2.md); this file does not authorize a
dashboard action, workflow dispatch, upload, review cancellation, or submission.

## Product

- **Name**: Ambra EPUB Reader
- **Category**: Productivity > Tools (the saved dashboard category).
- **Distribution**: Public. The owner confirms version 1.0.1 is live and Public.
  Preserve the existing listing, visibility, and regions.

## Short description

Read, annotate, and explore EPUBs in Chrome with a personal library, flexible reading settings, and EPUB Inspector.

Unchanged from the published 1.0.1 package. For 1.0.2, keep the main description
and existing images; only the guide/privacy URLs below change.

Character count: 115. This read-only dashboard summary comes from the uploaded
package's manifest `description`; it is not separately editable listing copy.

## Single purpose

Ambra lets users read and work with their EPUB library in Chrome: import and organize books, navigate and annotate their content, and inspect the files that make up a publication.

## Suggested full description

Read your favorite books right in your browser. Adjust the reading experience to suit you, highlight passages, and take notes as you read.

Authors and publishers can use the integrated EPUB Inspector to explore a book's files, inspect its content, and investigate issues without leaving the reader.

Ambra supports advanced EPUB3 features, including annotation import and export, and publisher-provided annotations.

MAKE YOURSELF AT HOME

Import your EPUBs, browse your library, and pick up where you left off. Adjust text size, page width, brightness, and page and reader themes. Choose paginated or scrolling reading for reflowable books, or enjoy fixed-layout publications with their original page design.

Find your way with book search, the table of contents, bookmarks, and a reading-position slider. After jumping to another passage, use Chrome's Back and Forward buttons to retrace your steps.

TAKE NOTES IN THE MARGINS

Highlight passages, add notes, and bookmark places worth returning to. Export and import your annotations to back them up or share them separately from the book.

Annotation exchange uses EPUB Annotations 1.0 JSON. Use the same book or edition for best results; compatibility with other tools varies.

READ-ALONG BOOKS

When a book includes recorded narration, listen with synchronized text highlighting. Ambra supports EPUB Media Overlays, which link the book's narration to its text. It plays narration supplied with the EPUB; it does not generate text-to-speech.

EXPLORE WHAT'S INSIDE

For curious readers, authors, and publishers, EPUB Inspector connects the reading experience with the files behind it. Browse metadata and publication resources, inspect highlighted source, preview supported media, and move between passages in the reader and their source.

Inspector is read-only. It does not edit EPUBs or replace EPUBCheck or an accessibility audit.

YOUR LIBRARY, ON YOUR DEVICE

No account, ads, or analytics. Your books and reading data are stored in your Chrome profile, with no cloud sync.

Ambra can import EPUB downloads from websites. For books missing a description, it may send the title, author, and ISBN to Open Library or Wikipedia to find a summary. There is currently no in-app opt-out for these lookups; see the privacy policy for details.

Keep your original EPUBs and exported annotations as backups. Removing Ambra or clearing its data can remove your library.

BEFORE YOU START

- DRM-protected EPUBs are not supported.
- Keyboard navigation and screen-reader support are built into the reader; compatibility varies by publication, browser, and assistive technology.

User guide: https://ambraepub.org/en/docs/
Source: https://github.com/BCWalters/ambra
Privacy: https://ambraepub.org/en/privacy/
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

The official website hosts the canonical public policy URL.
Paste this direct URL into the Chrome Web Store dashboard's privacy policy field:

<https://ambraepub.org/en/privacy/>

Google's [privacy policy requirements](https://developer.chrome.com/docs/webstore/program-policies/privacy/)
require an accessible policy link. [privacy-policy.md](privacy-policy.md) remains
the source of truth in this public repository. The `BCWalters/ambra-site`
website imports it from an immutable Ambra commit; do not edit a separate HTML
copy. After an approved policy change merges, update the website's source pin
and deploy it before publishing the changed behavior. Merging an Ambra PR alone
does not update the website. Before submission, verify the hosted policy and
user guide over HTTPS without signing in, and check that the policy's disclosures
and effective date match the candidate. Updating these sources does not authorize
a live dashboard change or extension submission.

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
