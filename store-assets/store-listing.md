# Ambra Chrome Web Store listing notes

## Product

- **Name**: Ambra EPUB Reader
- **Category**: Productivity

## Short description

Import, organize, and read EPUB3 books locally in Chrome with offline storage, resume reading, bookmarks, and highlights.

Character count: 117

## Single purpose

Ambra lets users import, store, organize, and read EPUB3 e-books entirely within Chrome, using an in-house-built reading engine with no server-side reader or third-party reading dependency.

## Suggested full description

Ambra is a local-first EPUB3 reader for Chrome built from scratch for real book reading, not just file inspection.

Import EPUB books into a private on-device library, reopen them later, and keep your place automatically. Ambra supports both reflowable and fixed-layout EPUBs, accessible reading, a dedicated full-tab reader, bookmarks, highlights, saved reading progress, and polished library/reader UI.

Your library stays on your device. Ambra does not require an account, does not run analytics or ads, and only makes a narrow third-party metadata request when a book lacks its own description.

## Permission justifications

### unlimitedStorage

Ambra stores complete EPUB files, extracted cover images, and per-book reading data locally for offline use. `unlimitedStorage` prevents normal browser quota pressure from breaking larger personal libraries and keeps storage local on the device rather than requiring a remote sync service.

### downloads

Ambra uses the downloads permission only to detect when a `.epub` file has finished downloading in Chrome, so it can offer a shortcut back into Ambra’s library import flow. It does not silently read arbitrary downloads or inspect unrelated website content.

### notifications

Ambra uses notifications only to show the optional “this looks like an EPUB — add it to Ambra?” prompt after an EPUB download completes. Notifications are not used for advertising, marketing, or background engagement.

## Privacy/data-use notes for the dashboard

- **Main local data handled**: imported EPUB files, extracted metadata/cover images, reading progress, bookmarks, highlights/notes, reader preferences.
- **Where it is stored**: locally on-device in the extension’s browser storage area, primarily IndexedDB.
- **Third-party transmission**: when a book lacks its own EPUB description, Ambra may send the book’s title, author, and ISBN to `openlibrary.org` and, if needed, `en.wikipedia.org` to fetch a fallback description.
- **Not sent off-device**: EPUB file contents, reading progress, bookmarks, highlights, notes, account data, browsing history, analytics events.
- **Ads / analytics / tracking**: none found in the current codebase.
- **Sale of data**: none.
- **Account creation**: none.
- **Host permissions requested**: none.

## Privacy policy URL

Host `store-assets/privacy-policy.html` somewhere publicly reachable and paste that final URL into the Chrome Web Store dashboard.

Suggested placeholder until hosting is chosen:

`https://YOUR-DOMAIN.example/ambra/privacy-policy.html`
