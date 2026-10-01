# Progress landmarks

**Ambra settings > Reading preferences > Progress landmarks** has two options:

- **Show** (default): chapter bands and available reading landmarks.
- **Hide**: a plain progress bar without chapter bands or reading landmarks.

The setting applies across books and is remembered. Changing it does not
seek, repaginate, or change your saved reading position. The reader's existing
auto-hide behavior still applies to the entire progress bar. Scrolling mode
still uses its native scrollbar, without this progress bar.

## Reading the bar

Alternating chapter bands appear inside the unread portion of the progress
track. The completed portion stays solid. The current chapter's remaining band
begins at the thumb, followed by the next chapters at their actual relative
lengths. Bands follow the thumb during seeking and mirror for right-to-left books.

- A **green indicator** marks a publisher-declared start of the main text
  (`bodymatter`). Everything before it forms one darker front-matter band.
- Declared **back matter** (`backmatter`) has the same darker fill, without a
  separate end marker. It is an inferred end of reading, not a declaration of
  where to stop reading.
- Theme-colored bookmark flags remain in their own clickable lane below the
  track, even when progress landmarks are hidden. A single flag goes directly
  to its saved location. A count-marked flag opens a chooser for nearby
  bookmarks; a large group also offers **Show all bookmarks**.

The slider's accessible description reports available reading boundaries.
The actual-position readout stays separate from the destination preview near
the thumb. When ready, it shows the book-wide page count and percentage;
remaining pages in the current reading-order section may be available sooner.
While pagination finishes, Ambra can show "Mapping your book…" after you hide
and reveal the controls, rather than showing a guessed page count.

## When less is shown

Markers wait for the current layout's complete page count. They use the same
book-wide page scale as seeking, including links to sections within a chapter.
Changing font size, window size, or layout can change both positions and detail.
The seek popup uses the destination's measured TOC section, including when
several chapters share one EPUB content file.

The bar tries individual TOC chapters first, then broader top-level groups.
Parent headings are not counted again as chapters, and declared front/back
matter is kept separate from the main reading range. Very large TOCs may show
groups or only reading landmarks rather than every chapter. Missing targets
or entries out of reading order can also reduce the detail shown. Short chapters
keep their actual positions, even when nearby marks visually merge on a narrow
screen.

Reading landmarks take priority over nearby chapter ticks. If the two reading
boundaries themselves would overlap, only the start is shown.

Reading boundaries come from the book's declared landmarks, not guesses based
on chapter titles. Books without EPUB3 semantic landmarks (including NCX-only
books) may therefore have chapter marks but no reading boundaries. An
unspecified end is left unmarked. Fixed-layout positions use page-level precision.

[Back to Book Navigation](book-navigation.md#move-along-the-progress-bar) · [Back to the Ambra guide](README.md)
