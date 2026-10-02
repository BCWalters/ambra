# Ambra Library

Keep your EPUBs together and reopen a book at your saved reading position.

## Compact or full library

The extension popup uses a compact cover-and-metadata list whose books scroll
independently. **Find books** and **Import book** remain above the collection,
including when the library is empty. Choose **Open library in new tab** for a
full browser tab with more room; this is available before your first import.

The full library uses larger covers and offers **Continue reading** when a
previously opened book is available. Search and **Sort** stay together in both
views. Covers preserve the original artwork without cropping it.
The Continue reading card highlights your most recently read book, its author,
and saved progress. Choose **Continue reading** to reopen it at your saved
position, or its information button for Book details. The book also remains
in the collection; searching temporarily hides the resume card.

## Browse your library while reading

Choose **Library**, immediately after **Contents** in the reader toolbar, to open
a left-side library panel. The collection loads when you first open the panel.
Opening it, searching, or sorting does not reload the current book or change your
reading position.

- Choose the current book to close the panel and return to reading without a reload.
- Choose another book to save your current position, then open that book in the
  same reader tab. If saving fails, Ambra stays in the current book and reports
  the problem.
- Use **Close** or **Escape** to dismiss the panel, or **Open library in new tab**
  for the full library. Opening another reader reference panel replaces this one.

The panel retains its search and ongoing imports while temporarily closed.
To remove the book currently open in this reader, open the full library and
close its reader tab first.

## Add a book from your device

Choose **Import book**, whether the library is empty or populated. Select EPUB
files from your device, then open a book to read. **Sort** offers **Date added
(newest first)**, **Date added (oldest first)**, **Title (A–Z)**, and **Author (A–Z)**. The saved sort order is shared
by the full library, popup, and in-reader panel.

If an import fails, the error includes the file name when available, so you can identify it when importing several books.

Importing the same EPUB again shows **Already in your library**, with **Read now** to open the existing copy. Your reading position, bookmarks, and annotations stay unchanged. An EPUB with different file contents is added separately, even if its title is the same.

## Search your library

Use **Search title or author** above your books in the compact library, full
library tab, or reader panel. Each word can match part of a title or author, in any order.
Search ignores capitalization and accents in Latin-alphabet text; for example,
`verne voyage` can find *Voyage au centre de la Terre* by Jules Verne.

Results retain your selected sort order. Use the clear button or press **Escape**
in the search field to show all your books again. Search only filters local
library metadata: it does not search inside books or contact book websites.
The query is temporary and is cleared when the library page closes or reloads.

## Find new books on the web

Choose **Find books** above the collection, including in an empty library. In the
full library, this opens a centered dialog; **Close** or **Escape** dismisses it.
From the compact popup or reader panel, it opens the full library in a new tab
with discovery already open. Source links open in a new tab:

- **Standard Ebooks:** choose **Advanced epub** for formatted classics.
- **Project Gutenberg:** choose an **EPUB** or **EPUB3** download.
- **ReadBeyond:** choose **Download** for [read-along EPUBs](read-along-books.md) with recorded narration.
- **[eBooks.com](https://www.ebooks.com/drm-free-epub):** buy a DRM-free EPUB edition and download it after purchase.

Ambra can import EPUB downloads directly into your library. If that fails, save the EPUB to your device and choose **Import book**.

To save a library book to your device, open **Book details → Publication details** and choose **Save as…** beside **File name**.

## Check book details

Open **Book details** for a description, or expand **Publication details** for rights and accessibility information. The [EPUB Inspector](epub-inspector.md) lets you explore the original metadata and files.

If a book has no description, opening **Book details** also checks Open Library
and then Wikipedia for a fallback, without opening the book in the reader.
This sends only its title, author, and ISBN, not the EPUB or reading history.
Found descriptions are saved locally with a source link and appear in the open
panel automatically. The EPUB's own description always takes priority. Offline
or unmatched books remain usable without a description; unsuccessful lookups
are limited to three attempts, shared with the reader.

**Remove from library** is at the bottom of Book details. You can also press
**Delete** or **Backspace** on a focused book to request removal. Confirmation
names the book and initially focuses **Cancel**. Removal deletes that library
copy's saved position, bookmarks, highlights, and notes, not the original EPUB
on your device.

Ambra is available in the [Chrome Web Store](https://chromewebstore.google.com/detail/ambra-epub-reader/mcjkkebkhifgkkbahlcapjlnaihocogj). See the official [privacy policy](https://ambraepub.org/en/privacy/) for privacy details.

[Back to the Ambra guide](README.md)
