# Book Navigation

## Use the contents or search

Open the **Table of contents** from the reader toolbar and choose an entry to jump there. Entries come from the book, so its named chapters may differ from its reading-order sections.

Open **Search**, or press **Mod+F**, and enter at least three characters. Choose a result to return to that passage in the book. Pin the panel if you want to keep it open while reading.

**Alt+Page Up / Alt+Page Down** move to the previous / next section: a reading-order file, not necessarily a named chapter. Left/Right follow the book’s reading direction, turning pages in pagination and moving between sections in scrolling mode.

Here, **Mod** means Command on Mac or Control elsewhere; **Alt** is Option on Mac. See all [keyboard shortcuts](README.md#keyboard-shortcuts).

## Go to a page or percentage

1. Focus the book or a reader toolbar button.
2. Press **Mod+G** for a page, or **Mod+Shift+G** for a percentage.
3. Enter a whole number and press **Enter**. **Escape** dismisses the dialog and returns to reading.

**Go to** is a numeric dialog, not a toolbar menu or a Book details control. Pages run from 1 to the measured book-wide page count; page entry is unavailable while that count is being measured. These are pages in your current layout, so changing text size or page width can change the numbers.

Percentages run from 1 to 100. They use the same positioning as the progress bar, with coarse section-based positioning until pagination is ready.

Both commands require reflowable pagination. Scrolling and fixed-layout content show an explanation instead of changing reading mode. Text fields, selections, widgets, and other dialogs retain their own keyboard controls.

## Move along the progress bar

In pagination, click or drag the reading-position control to move through the book, or focus it to use its keyboard controls. Keyboard focus appears around the thumb. Scrolling mode uses its native scrollbar instead.

Once book-wide pagination is ready:

- Chapter bands show the unread portion at each chapter’s relative length.
- A green indicator marks the start of the main text when the publisher declares it. Declared front and back matter appear darker.
- Small blue ribbons mark your [bookmarks](annotations-and-bookmarks.md). Browse them by name in **Bookmarks and highlights**.

Positions update when text size, window size, or layout changes, and mirror for right-to-left books. While measurement is in progress, you may see **Mapping your book…**.

Use **Settings → Progress landmarks → Show / Hide** to control chapter bands and reading landmarks across books. Hiding them leaves bookmark ribbons and seeking available. Large or unusual tables of contents may show less detail; books without declared reading landmarks may have no reading-boundary markers. See [Progress landmarks](progress-landmarks.md) for details.

## Return after a jump

Use Chrome’s **Back** and **Forward** buttons to revisit reading locations. Completed jumps from contents, section navigation, search, bookmarks, highlights, notes, in-book links, Go to, and a released progress-bar drag are remembered. There are no separate history buttons in the reader.

Ordinary page turns and scrolling update your current stop rather than creating new ones. If you jump from A to B and read on to C, **Back** returns to A and **Forward** returns to C. A new jump after Back replaces the forward branch.

Changing text size or layout, cancelled or unsuccessful jumps, and popup footnotes do not add history stops. Locations follow the book’s content rather than old page numbers.

This reading history survives a refresh but ends when you close the tab. Library and other real pages remain ordinary browser navigation. Saved reading progress and bookmarks are separate from this tab’s history.

[Back to the Ambra guide](README.md)
