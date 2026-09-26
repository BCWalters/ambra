# Ambra Privacy Policy

Effective date: 2026-09-26

Ambra is a local-first EPUB3 reader for Chrome. It lets users import, store, and read EPUB books in the browser without creating an account and without sending reading activity to Ambra-operated servers.

## What Ambra stores locally on your device

Ambra stores the following data locally in an on-device IndexedDB database named `ambra-library`:

- imported EPUB files you add to your library;
- book metadata extracted from those files, such as title, author, identifier, and cover image;
- reader state such as resume position, bookmarks, highlights, notes, and library sort order;
- reader preferences such as theme, font, layout, animation, and locale settings; and
- when available, a fetched fallback book description plus its source attribution link.

This data is stored on your device so the extension can work offline and reopen your library and reading progress later. Ambra does not upload this local library data to Ambra servers because Ambra currently does not operate any sync or cloud account service.

For automatic download imports, Ambra also keeps a small recovery journal in
`chrome.storage.local`. It contains download, tab, and document identifiers,
timestamps, and handoff status, not book contents or browsing-history logs.
Settled handoffs are removed. A local recovery alarm helps restore paused
downloads if the import tab closes or the background worker restarts.

## When data leaves your device

### Importing books from websites

When Chrome starts a likely EPUB download and Ambra has access to the source
website, Ambra can open its Library and fetch the download URL to import the book
automatically. The website and any redirect destinations receive the requested
URL (including any query parameters) and normal browser network metadata.
Ambra does not upload your existing library to that website.

Ambra can pause the original Chrome download while its Library imports the EPUB.
After successful import, it cancels a redundant in-progress download and removes
its canceled download record. If import fails or the handoff is abandoned, Ambra
attempts to resume Chrome's download; when Chrome cannot resume it, retry in
Chrome Downloads. The Library's Cancel action cancels the active import and
its pending native download. A download that has already finished is retained.
If access is withheld, Chrome's normal download remains available and you can
import the file manually.

### Looking up missing descriptions

When you open a book without its own EPUB description (`dc:description`), Ambra
may make one or more requests for a fallback description from:

- `openlibrary.org` (Open Library), and if needed
- `en.wikipedia.org` (Wikipedia).

For that request, Ambra sends only the minimum book-identifying fields needed to look up a description:

- title,
- author/creator, and
- ISBN, if the book provides one.

Ambra does **not** send the EPUB file itself, the book’s text contents, reading progress, bookmarks, highlights, notes, or any browsing history as part of this lookup. The description lookup is used only to show a missing book summary inside Ambra. The result, if one is found, is stored locally with the book’s metadata.

Like any direct web request, these services also receive standard network
metadata such as your IP address and browser headers. Ambra does not use these
requests for advertising, profiling, or cross-site tracking. Description lookup
is automatic when an eligible book opens, not only when you open Book Details;
there is currently no dedicated lookup opt-out setting.

### Links you open

Library discovery links, description attribution links, and external links you
choose to open navigate to third-party websites. Those websites have their own
privacy policies. Reading an imported book does not require an Ambra account or
an Ambra-operated server.

## Chrome Web Store User Data Policy and Limited Use

Ambra's use of user data complies with the
[Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/policies#protecting-user-privacy),
including the Limited Use requirements. Ambra uses and transfers user data only
as necessary for its disclosed single purpose of reading and working with your
EPUB library, as described in this policy. Ambra does not sell user data or use
or transfer it for advertising, determining creditworthiness, or lending.

## What Ambra does not do

- no analytics SDKs or usage-tracking services;
- no advertising or ad targeting;
- no sale of personal data;
- no remote account system;
- no cloud sync or backup service; and
- no analytics collection of your browsing history. Chrome download events are
  examined locally to recognize EPUB downloads; unrelated downloads are not
  imported or transmitted to Ambra.

## Chrome permissions used by the extension

- **unlimitedStorage**: allows large local book libraries to be stored on-device without normal browser quota pressure.
- **downloads**: lets Ambra recognize EPUB downloads, start the automatic import
  described above, pause/resume the native download during handoff and recovery,
  cancel it after import or an explicit user cancellation, and offer a library
  shortcut for a completed EPUB download.
- **notifications**: lets Ambra show an “add this EPUB to Ambra?” prompt for
  completed EPUB downloads.
- **storage**: stores the local download-handoff recovery journal described above.
- **alarms**: schedules local recovery checks while download handoffs are pending.
  These checks are not analytics or advertising and stop when no handoffs remain.
- **Website access (`*://*/*`)**: allows HTTP/HTTPS EPUB downloads from different
  websites and redirect hosts, and the description lookups above. The extension
  does not inject content scripts into ordinary websites. You can restrict site
  access in Chrome; automatic imports then require access or manual file import.

## Your choices

- You can remove books and their associated reading data from the library.
  This does not delete your original EPUB or copies in Downloads.
- You can restrict Ambra's website access in Chrome and use **Import EPUB** with
  local files instead of automatic web imports.
- You can ignore download notifications or control notifications through your
  browser/operating system.
- Reading offline prevents description lookups from reaching external services.
  There is currently no in-app lookup opt-out. Chrome site-access controls govern
  automatic import permissions, but do not guarantee that metadata requests to
  public APIs are blocked.
- You can uninstall the extension through Chrome to remove its local data.
  Ambra provides no cloud backup; retain original files and any exported notes.

## Changes to this policy

If Ambra’s data practices change materially, this policy should be updated before the new behavior is released.

## Contact

Project home and issue tracker: <https://github.com/BCWalters/ambra/issues>

If you choose to send feedback by email or post an issue, the recipient and
hosting service receive what you submit. Public issues are visible to others.
The About pane's environment-information copy action writes to your clipboard;
it does not automatically send a report. Review and redact information before
sharing it, especially book contents, notes, local paths, or download links.
