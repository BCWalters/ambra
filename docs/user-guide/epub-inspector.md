# EPUB Inspector — from the page to the source

Explore the files, images, and metadata inside an EPUB without unpacking it. For authors and publishers, EPUB Inspector connects what you see on the page with the source behind it.

## Open EPUB Inspector

- **In the reader:** move to the top edge to reveal the toolbar. Click the book
  title or **Book details**, the book-shaped information control near
  **Ambra settings** and **Help & About**.
- **In the Library:** use the book's **Book details** action, available with its
  cover and metadata in the full library, popup, and reader Library panel.

Both open **Book details**. Choose **EPUB Inspector** near the bottom of that panel; scroll down if needed.

[![EPUB Inspector open over Alice's Adventures in Wonderland, showing the EPUB file list, metadata tabs, and a preview of John Tenniel's Caterpillar illustration.](images/inspector-overview.png)](images/inspector-overview.png)

## See the whole book

- **Files:** browse the EPUB’s contents and preview images, audio, and video.
- **Source:** read syntax-highlighted markup and stylesheets, and follow links between files.
- **Metadata, Spine, and Manifest:** inspect publication details, reading order, and the resource inventory.

## Connect reading and source

Use **Dock left** or **Dock right**, beside the Close button, to inspect source alongside the book. **Popover view** and **Full screen** are also available.

When Inspector is opened from the reader:

- **Locate current passage** finds the source for your selection or current reading position.
- **Show in book** takes you from a source element back to its reading location.

Move between a passage and its markup without leaving the book.

## See the visible page boundaries

In the reader's Inspector **Files** tab, the source for a visible reflowable
page automatically includes markers such as **[39 start]** and **[39 end]**.
They identify the exact source boundaries of the current one or two pages,
including breaks within paragraph text. For a cross-chapter spread, browse
either chapter's file to see its markers. Page numbers match Ambra's
book-wide reader footers, not printed page labels. While those numbers are
being calculated, the markers appear as **[start]** and **[end]** and update
automatically once the numbers are ready.

Opening Inspector brings the current page's start marker into view
automatically. Explicit source navigation, such as **Locate current passage**
or opening a reference, keeps its own target instead.

During paginated reading, Inspector uses original source rather than
pretty-printed XML (line endings are normalized). Markers are annotations:
copying source does not include their labels, and the EPUB remains unchanged.
They update when the reader turns a page or repaginates, including after
docking Inspector or changing the window size. Scroll and fixed-layout
views have no markers or additional notices.

These are actual Ambra DOM boundaries, not an explanation of why a break
occurred or a prediction for other readers. The end is exclusive. CSS-reordered
content may occupy disjoint source ranges, so the markers do not necessarily
enclose every element painted on a page. If a boundary cannot be mapped
reliably, Inspector reports an error rather than guessing.

[![EPUB Inspector docked to the right of the reader, displaying highlighted XHTML source alongside the corresponding Alice chapter.](images/inspector-source.png)](images/inspector-source.png)

## Follow a resource’s references

For an image or stylesheet, choose **Find references** to see where the book uses it. Open a result to inspect that source location.

This answers questions such as “Which pages use this image?” and “Where is this stylesheet linked?”

## Investigate without changing the book

Inspector is **read-only**: your EPUB remains unchanged. It is not an editor or a replacement for EPUBCheck or an accessibility audit. Reference finding covers supported static markup and CSS, not dynamically computed JavaScript uses.

Screenshots use a credited demonstration copy combining Lewis Carroll's text
with John Tenniel's Caterpillar illustration from Project Gutenberg, not the
Standard Ebooks edition. See [screenshot sources and capture status](screenshots.md).

[Report Issues / Request Features](report-issues.md) · [Back to the Ambra guide](README.md) · [Source](https://github.com/BCWalters/ambra)
