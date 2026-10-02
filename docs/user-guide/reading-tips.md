# Reading tips

## Turn pages comfortably

In pagination, click or tap the outer margin to turn a page. Reading order reverses for right-to-left books. Fixed-layout books also accept taps near the outside page edge; the gap between pages does not turn them.

Reflowable books also accept taps in blank space farther inside the outside page edges. These zones run through the full height of the reading pane, including above and below the text. The middle of the page and the gap between pages remain inactive; text, links, images, and visible reader controls keep their own behavior.

If reader controls are showing, the first page-turning click hides them; click again to turn. Links, images, and text selection keep their own behavior.

Use **Page Down** or **Space** for the next page, and **Page Up** or **Shift+Space** for the previous page. See the [keyboard shortcuts](README.md#keyboard-shortcuts) for more options.

### Local preview: first-reading margin hints

In local builds explicitly enabled with `VITE_AMBRA_LOCAL_FEATURES=1`, closing
the first-reading welcome briefly highlights the outer margins, then leaves
small page-turn hints. Click through the hints normally: they never intercept
input or cover the text/overlap area. Narrow margins use arrows instead of
labels; margins too narrow for an arrow remain unmarked. Hints follow resizing
and right-to-left reading order. Reduced-motion preferences skip the highlight.

The first successful page turn or jump removes the hints. A boundary click
that cannot turn a page does not. To replay them, open **Help & About → Reading
tips** and close the welcome. Reloading or opening another book does not replay
an acknowledged welcome. Scrolling mode has no page-margin hints. This local
preview is off in ordinary release builds.

## Choose pagination or scrolling

Open **Ambra settings → Reading preferences → Reading mode** to choose pagination
or scrolling for reflowable books. Scrolling can be useful for continuous
screen-reader reading. Fixed-layout books retain the publisher’s layout.

Use **Alt+Shift+Page Down** for scrolling or **Alt+Shift+Page Up** for pagination (**Option** instead of Alt on Mac).

## Adjust the reading appearance

**Book options** (Aa) applies to the current book. Adjust typography and page
width for reflowable text; **Book default** preserves publisher typography.
Under **Page → Always show one page**, choose one centered page instead of a
two-page spread for reflowable pagination. Typography and this layout choice
are saved per book.

**Ambra settings** (gear) is shared across the reader, full library, and popup:

- **Interface theme:** choose **Ambra** (default), **Silver**, **Green**, **Blue**,
  or **Purple**. Light or dark interface appearance follows the browser; there is
  no separate app light/dark setting.
- **Language:** choose the interface language.
- **Reading preferences → Page theme:** choose **White**, **Sepia**, or **Dark**
  across books, independently of the interface theme. Illustrations retain
  their styling, and fixed-layout artwork is not recolored.
- **Reading preferences → Brightness:** adjust brightness.
- **Reading preferences → Reading mode:** choose pagination or scrolling.
- **Reading preferences → Page turn:** choose the page-turn effect.
- **Reading preferences → Progress landmarks:** show or hide the progress
  track's chapter bands and reading landmarks.

Reading preferences starts expanded in the reader and collapsed in the library.
These are transient settings popovers, not panels that stay beside the page.

## Look closer at images and tables

Open an image that offers zoom to inspect it in the image viewer. Scroll to zoom; drag or use arrow keys to pan. **+**, **−**, and **0** zoom in, zoom out, and fit to the window. Press **Escape** to return to reading.

For a wide table in a reflowable book, choose **Expand table** at its upper edge. Zoom and scroll in both directions without changing the reading page. See the [Table viewer guide](table-viewer.md).

## Read popup notes without losing your place

Supported footnote and endnote references open a popup beside the passage. Press **Escape** to close it. Other links may navigate normally, depending on the book. For your own notes, see [Annotations and Bookmarks](annotations-and-bookmarks.md).

For books with recorded narration, see [Read-along books](read-along-books.md).

[Back to the Ambra guide](README.md)
