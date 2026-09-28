# Progress landmarks

**Settings > Progress landmarks** has two options:

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
- Blue bookmark ribbons remain in their own lane below the track, even when
  progress landmarks are hidden.

The footer matches the 56-pixel top toolbar in both settings.

The slider's accessible description reports available reading boundaries.
While pagination finishes, the centered status reads "Mapping your book…".

## When less is shown

Markers wait for the current layout's complete page count. They use the same
book-wide page scale as seeking, including links to sections within a chapter.
Changing font size, window size, or layout can change both positions and detail.
The seek popup uses the destination's measured TOC section, including when
several chapters share one EPUB content file.

The bar uses the TOC's leaf chapters first, then its top-level groups.
Linked parent headings are not counted again as chapters. Where reading
landmarks declare a range, TOC entries before the start or at/after the back
matter are excluded from these candidates. A single wrapper around the reading
work is ignored as a grouping level, even when it has front/back matter siblings.
A level is shown when it has at most 100 distinct targets in reading order.
There is no minimum gap: short chapters keep their actual positions, even if
nearby ticks visually merge on a narrow screen. A flat TOC with more than 100
targets is not sampled: its chapter marks are omitted. Missing targets or
backwards navigation also prevent that level from being shown.

Reading landmarks take priority over nearby chapter ticks. If the two reading
boundaries themselves would overlap, only the start is shown.

No title matching or first/last-file guesses are used. Books without EPUB3
semantic landmarks (including NCX-only books) may therefore have chapter marks
but no reading boundaries. An unspecified end is left unmarked rather than
presenting a guess as fact. Fixed-layout positions use page-level precision.
