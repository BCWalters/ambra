# EPUB Inspector — from the page to the source

A book is more than the page on screen. Ambra’s integrated EPUB Inspector puts its structure, source, and resources within easy reach—useful for authors and publishers investigating a book, and for curious readers who want to look inside.

Inspect the EPUB where you read it, without first unpacking the archive or hunting through a separate folder. Open **EPUB Inspector** from a book’s details in the library or reader.

## See the whole book

- **Files:** browse archive members and file sizes, with the package document, container descriptor, table of contents, and cover identified.
- **Source and media:** read syntax-highlighted markup, CSS, JavaScript, and JSON; preview images and browser-supported audio/video. Fonts and other binary resources are identified rather than displayed as text.
- **Metadata:** inspect publication details and OPF metadata entries.
- **Spine and manifest:** see the declared reading order and resource inventory, including paths, media types, and properties.
- **Less hunting:** follow supported local source links to other files in the archive, return with Back, and use line wrapping or full screen for longer source files.

## Connect reading and source

When opened from the reader, the Inspector links the reading experience to the underlying content:

- **Locate current passage** finds the source element for the selected passage, or the current visible reading position when there is no selection.
- **Show in book** takes a selected source element back to its reading location and closes the Inspector. Without an element selection, it opens the readable file’s start.

Move between a layout problem and its markup without losing context. This on-demand, two-way navigation works with readable spine documents when inspecting from the reader; library inspection focuses on the files themselves.

## Follow a resource’s references

For an **image or stylesheet**, **Find references** lists uses found in supported markup and CSS within the archive. Results include a source path, snippet, and original-source line number. Open one to inspect the source and highlight the reference where mapping is available; Back returns to the results.

This helps answer practical debugging questions: Which pages use this image? Where is this stylesheet linked or imported?

## Investigate without changing the book

The Inspector is a **read-only inspection and debugging aid**, not an EPUB editor or a replacement for EPUBCheck or a complete accessibility audit. Reference finding covers supported static references, not dynamically computed JavaScript uses; an empty list is not proof that a resource is unused.

Your imported EPUB remains unchanged by inspection. Use your authoring tools to make repairs and appropriate validation tools to check the result.

[Back to the Ambra guide](README.md) · [Source and feedback](https://github.com/BCWalters/ambra)
