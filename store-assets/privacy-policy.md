# Ambra Privacy Policy

Effective date: 2026-09-21

Ambra is a local-first EPUB3 reader for Chrome. It lets users import, store, and read EPUB books in the browser without creating an account and without sending reading activity to Ambra-operated servers.

## What Ambra stores locally on your device

Ambra stores the following data locally in an on-device IndexedDB database named `ambra-library`:

- imported EPUB files you add to your library;
- book metadata extracted from those files, such as title, author, identifier, and cover image;
- reader state such as resume position, bookmarks, highlights, notes, and library sort order;
- reader preferences such as theme, font, layout, animation, and locale settings; and
- when available, a fetched fallback book description plus its source attribution link.

This data is stored on your device so the extension can work offline and reopen your library and reading progress later. Ambra does not upload this local library data to Ambra servers because Ambra currently does not operate any sync or cloud account service.

## When data leaves your device

Ambra makes one limited third-party network request in the current codebase. If a book does not include its own EPUB description (`dc:description`), Ambra may request a short fallback description from:

- `openlibrary.org` (Open Library), and if needed
- `en.wikipedia.org` (Wikipedia).

For that request, Ambra sends only the minimum book-identifying fields needed to look up a description:

- title,
- author/creator, and
- ISBN, if the book provides one.

Ambra does **not** send the EPUB file itself, the book’s text contents, reading progress, bookmarks, highlights, notes, or any browsing history as part of this lookup. The description lookup is used only to show a missing book summary inside Ambra. The result, if one is found, is stored locally with the book’s metadata.

Like any direct web request, Open Library or Wikipedia will also receive standard network metadata such as your IP address and user-agent information from your browser connection. Ambra does not use these requests for advertising, profiling, or cross-site tracking.

## What Ambra does not do

- no analytics SDKs or usage-tracking services;
- no advertising or ad targeting;
- no sale of personal data;
- no remote account system;
- no cloud sync or backup service; and
- no collection of your web browsing activity outside the extension’s own book-reading features.

## Chrome permissions used by the extension

- **unlimitedStorage**: allows large local book libraries to be stored on-device without normal browser quota pressure.
- **downloads**: lets Ambra notice when an EPUB download finishes so it can offer a shortcut back into your library import flow.
- **notifications**: lets Ambra show that optional “add this EPUB to Ambra?” prompt.

## Your choices

- You can remove books from the library inside Ambra.
- You can disable or ignore the optional EPUB download notification flow.
- You can choose not to use books that trigger fallback description lookups.
- You can uninstall the extension at any time through Chrome.

## Changes to this policy

If Ambra’s data practices change materially, this policy should be updated before the new behavior is released.

## Contact

Project home and issue tracker: <https://github.com/BCWalters/ambra/issues>
