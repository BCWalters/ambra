# Ambra design system

**Version 0.2 - approved direction, 2026-10-01.**

This document specifies the target UX reviewed with the owner in the
[interactive prototype](design-prototype/README.md). It is not a claim that the
current extension implements that UX. The production reference is 1.1.1, source
`e0a2d1c512878208729a07182aa6fbd66cd6af49`, with validation follow-up
`0a39e11513c68f475bc24b3bee7ec98b32cbede3`.

[Design discussion #286](https://github.com/BCWalters/ambra/issues/286) contains
the decision history; [roadmap #289](https://github.com/BCWalters/ambra/issues/289)
tracks implementation. This document supersedes conflicting v0.1 proposals and
earlier prototype iterations. Change an approved interaction explicitly, not as
an incidental styling cleanup. Prototype omissions never authorize removing an
existing feature.

## Reviewed features: Library import and review invitation

The owner accepted the local drag-and-drop, page-turn guidance, review-dialog
presentation, and focused import-window experience. The first three remain
behind `VITE_AMBRA_LOCAL_FEATURES=1` pending release rollout; merging their
implementation does not enable them in store packages or expose simulation
controls there. CI verifies both the ordinary package and an isolated flagged
build. The native file-selection handoff below also applies to ordinary builds.

- **Import book** in Chrome's action popup opens a focused 480×560 import window,
  not the full Library. Lead with a prominent **Choose EPUB files...** action,
  retain progress/error/duplicate feedback, and omit unrelated Library controls
  and review prompts. After import, **Read now** and **Open library** return to
  the originating normal browser window and close the importer. Disable in-app
  exit actions during a batch. Full-tab and in-reader imports remain direct.
  No new extension permissions are needed.
- The owner reproduced native chooser closure in both the original 1.0.0 package
  and store 1.1.1 on macOS, so the recent overhaul is not its cause.
  [Chrome documents action-popup closure on focus loss](https://developer.chrome.com/docs/extensions/develop/ui/add-popup);
  use a [persistent browser window](https://developer.chrome.com/docs/extensions/reference/api/windows)
  rather than unsupported keep-alive or automatic-chooser tricks. The explicit
  chooser click remains necessary in this design; OS-native behavior still
  requires manual verification.
- Every active Library view is a local-file drop target, including the native
  popup and in-reader compact Library. Highlight it only during a
  file drag, retain keyboard-accessible **Import book**, and reuse the existing
  import/duplicate/error pipeline. Keep embedded highlighting inside its panel
  and detach drop handlers while that panel is closed.
- Invite feedback in the full Library, never over the reader. The owner's
  revised local prototype uses a modal asking **Are you loving Ambra?**,
  deferred during imports, searches, or other Library tasks.
  The focused import window has no invitation.
  **Yes, I love it!**
  leads to a store-review invitation; **Not really** offers feedback by email
  to the existing support address; **Not sure yet** postpones for three days.
  Escape, close, and backdrop dismissal also postpone rather than trapping
  keyboard users. Keep the standard modal focus trap and return focus to Import.
- Both follow-ups have one filled primary action and no competing footer Close
  button; the title-bar close control and Escape remain available. The negative
  response keeps **Help us improve Ambra**, uses a short invitation to email
  suggestions, and emphasizes **Share feedback by email**. The positive response
  keeps **That's great!**, separates its thank-you into a second paragraph, and
  emphasizes **Write a review**.
- Selecting either Yes or Not really permanently stops reminders, whether or
  not the user follows the subsequent link. This sentiment-based review routing
  remains a pre-publication decision: the Chrome Web Store's
  [spam-and-abuse policy](https://developer.chrome.com/docs/webstore/program-policies/spam-and-abuse)
  prohibits manipulating ratings. It does not explicitly discuss this exact
  flow; this local prototype is not a claim of policy approval.
- Proposed eligibility is three distinct local reading days plus reaching
  halfway through a book. A day counts only when a saved reading position
  changes, not on import or simply reopening a book. This is a heuristic,
  not evidence that every preceding page was read.
- Keep only three date strings, a halfway flag, a permanent stop flag, and the
  next permitted prompt timestamp in local prototype preferences. Neither the
  yes/no sentiment nor book identities are stored or transmitted. Reserve the
  three-day reminder window atomically before opening, so another tab or an
  abandoned dialog does not immediately repeat it. Terminal responses win over
  later postponements from stale tabs. Preserve earlier previews' stop flags.
- The full Library's **Local prototype controls** can simulate eligibility,
  simulate a new reader, reset the simulated invitation, advance the simulated
  clock by three days, or restore real
  eligibility. Simulation stays in memory and never edits reading history or
  the real invitation record. These developer controls are explicitly English
  and local-build-only; the invitation and drop overlay use all nine locales.

## 1. Principles and ownership

- Quiet, bookish, coherent, and functional. Avoid cutesy in-app copy, redundant
  metadata, competing filled actions, and decorative controls without a task.
- Publication content is primary. Ambra chrome must not recolor authored content,
  crop publication images, rewrite saved highlight colors, or change pagination,
  CFIs, selection ownership, reading history, or book/tab ownership incidentally.
- Keep Fluent UI and existing helpers/providers. The engine stays dependency-free
  and framework-independent. Extract shared patterns only when there are real
  consumers; do not add a replacement UI framework or a universal wrapper with
  many boolean switches.
- Preserve all existing import/export, duplicate handling, Save as, Inspector,
  accessibility metadata, diagnostic, localization, and error-recovery features,
  even where the study disconnects or omits them.
- No backend, account, analytics, telemetry, or new remote-content dependency.
  Prototype controls and assets are not production application architecture.

## 2. Visual foundations

### Interface versus publication appearance

One Ambra-wide interface theme applies to the full library, native popup, reader
chrome, panels, settings, and portalled surfaces. Preserve the named choices:
**Ambra (default), Silver, Green, Blue, Purple**. Light/dark follows browser
appearance; do not add a separate app light/dark preference.

The Ambra accent takes its direction from the owned icon. Exact palette values
remain implementation candidates, subject to contrast/state checks. Semantic
tokens, not copied prototype hex values or fixed bookmark blue, drive:

- primary action background/foreground and hover/pressed states;
- text, subdued text, surfaces, borders, selected surfaces, links, and focus;
- sliders, bookmark indicators, and other Ambra-owned functional accents;
- documented surface elevation, spacing, radius, density, and motion roles.

Bridge tokens into existing Fluent providers, portals, and Ambra-owned UI in
other documents. Page theme/brightness remain separate from interface appearance.
Semantic error/warning/status colors and user-selected highlight inks retain
their meanings. Forced-colors rendering must remain usable.

Use the existing 4/8/12/16/24px spacing vocabulary and small documented optical
exceptions. Compact and comfortable are deliberate density variants. Decorative
glyph size is not hit-target size. Meet WCAG 2.2 AA target-size requirements;
prefer larger touch targets where space permits. Reduce motion without changing
reading geometry to animate chrome.

Keep at least 160px for a compact Library collection. In short windows or at
high zoom, let the outer Library scroll rather than compressing its books
behind the sticky search/sort controls.

Compound Fluent Input/SearchBox controls own focus on their rounded outer
wrapper. Do not add the generic focus-ring backing shadow to the inner text
field; it produces a second, square inset box. Preserve Fluent's matching
underline and forced-colors wrapper outline for pointer and keyboard focus.

### Interface typography

Use the prototype's native-system-first font stack:
`-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`. Shared Fluent
typography tokens carry it to Library, reader chrome, panels, controls, and
portals, including numeric UI text. Body text is 14px/21px; compact captions
are 12px/18px and ordinary button emphasis is 550. Keep deliberate heading
hierarchy and compact control sizing rather than making every label the same
size. Generated cover artwork retains its decorative serif; interface headings
such as Continue reading use the system font. Do not change EPUB fonts,
publication styles, or the user's reading-font choice.

### Action vocabulary

| Role | Treatment and contract |
| --- | --- |
| Primary | One dominant filled action per task group, such as Import or Play. |
| Secondary | Bordered/neutral alternative, including full-library expansion. |
| Utility | Quiet labeled or icon action, with visible focus and hover feedback. |
| Stateful | Actual toggle/radio/checkbox semantics; focus and selection are distinct. |
| Destructive | Explicit wording, appropriate danger semantics, existing confirmation. |
| Navigation | Link semantics, with new-tab behavior named when relevant. |

Reuse standard Fluent glyphs: Library, Contents, book-with-an-i for Book details,
circled question mark for Help, gear for Ambra settings, and Aa for Book options.
Do not use a generic information icon for both book details and app help.
Icon-only variants retain accessible names and tooltips. Focus must be visible on
the control itself, including over arbitrary covers, not only in a tooltip.

## 3. Library: full tab, compact popup, reader panel

### Collection and navigation

- Full library: Continue reading, followed by the searchable/sortable collection.
- Continue reading is a full-width, softly theme-tinted resume card: 72x108px
  cover, small uppercase section label, prominent book title, author, bounded
  progress track, and a bordered **Continue reading** action. Put Book details
  at the right of the percentage row beneath the track, matching collection
  cards; keep the reading action separate. Wrap the action row on narrow screens, and use real saved progress
  without inventing chapter metadata. The collection remains below it.
- The import action reads **Import book** in every Library presentation, with
  translated equivalents. Supported files remain EPUB; discovery instructions,
  recovery messages, and the file picker retain that format guidance.
  Progress sits beneath covers. Search and Sort stay together.
- Compact popup: a readable cover-and-metadata list, not the old three-column
  cover grid. Keep Find books and Import together above the collection, including
  empty/small libraries. The book list scrolls independently; preserve actual
  native-popup sizing and validate the normal 360x480 and 320px presentations.
- Compact popup and in-reader library have a visible Sort action beside Search.
  All three views share the current library ordering: Newest added, Oldest added,
  Title A-Z, Author A-Z. Reuse existing persistence rather than inventing
  independent per-surface preferences. Filtering retains the selected order.
- Reader Library opens a left-side browsing panel without replacing/reloading the
  reader or changing position. Full-page and popup Library retain existing
  new-tab opening behavior; embedded Library deliberately owns this reader tab.
  Reuse metadata/cover/database helpers; do not mount a
  second full LibraryApp or load EPUB buffers merely to browse.
- Mount the embedded library view on first use, then retain it while hidden so
  imports, filtering, and sort state survive panel switches. Returning to the
  current book only closes the panel and restores content focus. Selecting a
  different book first awaits a successful reading-position checkpoint, then
  navigates this reader tab; failure leaves the current book open with an error.
  During embedded imports, other-book activation is unavailable with the import
  status as context, rather than abandoning in-flight work on navigation.
  Current-book return and closing the panel remain available.
- Keep **Open library in new tab** as an explicit secondary escape hatch in
  compact/reader contexts. Library browsing is not browser fullscreen.
- Compact Library search/sort retains a 12px opaque gap below the sticky
  controls, so scrolling book rows never run directly into the search field.

### Covers, titles, metadata, and removal

- Generated covers have a 2:3 ratio. Real artwork is contained without cropping,
  distortion, recoloring, or losing its native aspect ratio.
- Generated covers use a serif title, author, small diamond ornament, inset
  outline, and subtle spine shading. A stable FNV-1a hash of the normalized
  title selects one of five complementary colors: sage, violet, muted rose,
  slate blue, or ochre. Color is independent of interface theme, sort order,
  book ID, and reading progress. Keep full metadata accessible outside the
  bounded decorative cover, including at compact sizes.
- Real and generated covers share restrained asymmetric corner treatment:
  approximately 3px spine-side and 7px outer-side in the study.
- Real artwork has no visible frame or fill around its reserved 2:3 slot.
  Round and thinly outline the actual aspect-ratio-preserving image, not its
  letterboxed slot, so light covers remain distinct from the Library background.
  Keep the keyboard focus indicator on the open-book control.
- Reserve two title lines and one author line, with ellipsis. Full titles remain
  in the accessible open-book name and untruncated Book details.
- Show an empty progress track and **Not started** for unread books; author,
  progress, and details rows should align across cards. Recorded progress keeps
  its percentage, including 0%. A saved reading position without a known
  percentage shows **Started**, not a fabricated percentage or unread status.
- Direct Book details action, not duplicate details actions in an overflow menu.
  Retain file size and publisher alongside author without repeating the author.
  Other existing publication/identifier/accessibility metadata remains available.
- No new multiselect mode or selection toolbar. Delete/Backspace on a focused
  book requests single-book confirmation; it must not intercept typing,
  composition, modifier chords, repeated keys, or another dialog.
- Remove from library also appears at the bottom of Book details. Confirmation
  names the book, explains loss of saved state/annotations, distinguishes the
  original EPUB on disk, and initially focuses Cancel. Restore focus to the
  next/previous item in displayed order or an appropriate empty-state control.
- EPUB Inspector follows publication details as a left-aligned, filled primary
  action using the interface theme and typography in both Library and reader.
  Library removal stays last below a divider, separate from the non-destructive
  inspection action. Both buttons share the left content edge at their natural
  widths; Inspector is primary and removal is secondary. Keep existing Inspector availability and
  focus-return behavior.
- No Trash/undo promise. Prototype Reset sample is not an app recovery feature.

### Discovery and empty states

Full-library Find books opens a centered modal with focus management, Close,
Escape, and focus restoration, not an anchored popover. Do not let backdrop
interaction click through. Compact Find books opens the full library in a new
tab with discovery open. Preserve Standard Ebooks, Project Gutenberg, ReadBeyond,
and eBooks.com as the four sources.

Use the restrained original open-book illustration, a smaller compact treatment,
**No books yet**, and one functional instruction. Existing Import/Find books
controls remain in their normal positions; no duplicated empty-only actions.
Hide zero-count/storage statistics. In a populated library, show count/storage
once in the footer; show a filtered count only while searching. No-result,
import-progress, cancellation, duplicate, and failure states remain explicit.

## 4. Settings, Help, and Book details

Settings are transient anchored popovers, not persistent reference panels.

| Scope | Entry and ownership |
| --- | --- |
| Ambra settings | Gear in library/popup/reader. Interface theme, language, page theme, brightness, reading mode, animation, and progress landmarks remain Ambra-wide. |
| Book options | Separate Aa control in the reader. Per-book typography/layout includes font, size, spacing, content width, and existing book-local layout choices. Reset affects only book-local values. |
| Help & about | Separate persistent help-first control opening a dismissible dialog. Full-library labels can reduce to named icons in compact layouts. |
| Book details | Direct book-with-an-i action opening contextual metadata, not app settings/help. Non-pinnable in the agreed reader hierarchy. |

Do not reclassify a preference because of where its control appears. Reader Ambra
settings leads with expanded Reading preferences and focuses Page theme; library
and popup lead with interface preferences and initially collapse Reading
preferences. This changes presentation only, not values or persistence.
Opening settings dismisses the neighboring Help tooltip immediately and keeps it
hidden while settings owns focus; the first Escape belongs to settings.

Help leads with the guide, keyboard shortcuts, issue reporting, feedback, and
privacy-conscious diagnostic copying. About is an always-expanded section with
version, creator, privacy, and source links; only standards/open-source credits
remain a disclosure. Help shape Ambra uses a plain divided section and quiet
feedback links rather than a nested card or full-width call to action. Keep
spacing compact without duplicating the email destination as a separate line
or hiding diagnostic privacy guidance.
Preserve explicit copy-failure feedback and existing diagnostic redaction.

## 5. Reader hierarchy, panels, and navigation

The Contents button keeps the visible label **Contents** in both states; its
tooltip/accessibility label switches between **Show contents** and **Hide contents**.

- Toolbar starts **Contents, then Library**, retaining visible labels where
  possible. After the title, order commands **Search, Book options, Annotations,
  Book details, Ambra settings, Help, Bookmark**. Annotations keeps its visible
  label alongside Contents/Library when the reader pane is wider than 800px;
  narrower panes retain all commands as accessible icons.
- Stack the current chapter below the book title, centered when both fit and
  independently ellipsized when space is tight. Keep the toolbar height stable;
  chapter text must not compete horizontally with the title.
- When the remaining title region is under 80px, hide its redundant title action
  rather than leave an invisible tab stop. Book details stays available by icon;
  move focus there if a resize hides the focused title.
- **One reference panel per side.** Opening another panel preserves a pinned
  panel on the opposite side; an unpinned opposite panel still closes.
  Same-side panels replace one another: left, Contents and Library; right,
  Annotations, Search, and Book details. Budget both docks together, retaining
  at least 320px for reading. If both panels cannot fit side by side with at
  least one dock, temporarily show only the most recently opened panel. Restore
  the other when room returns without resetting its pin preference, drafts, or filters.
- Contents and Annotations share their existing pin preference; Search has its
  independent preference. Pinned panels dock and remain across navigation;
  unpinned panels are temporary flyouts dismissed by navigation, outside click,
  or Escape, with focus restoration. Do not invent pin capabilities for Library
  or Book details. Define responsive library overlay geometry during its phase.
- Dock only when the actual available row, after any Inspector dock, can fit the
  reference panel and at least 320px of reading space. Otherwise use an overlay
  without changing the remembered pin preference; restore docking when room
  returns. Keep the disabled pin action focusable with a localized explanation,
  and preserve focus, drafts, filters, and results while resizing.
- The study starts reference panels pinned only to facilitate layout review.
  That is not a change to production defaults or persisted pin state.
- Keep one authored navigation-label string. Do not infer chapter numbers or
  fabricate a separate chapter-number label. TOC shows known book-wide page
  numbers, right-aligned and included accessibly; unknown numbers are omitted.
  Do not append page numbers to the stored/navigation label.
  Without an authored section label, omit it from the title area and seek preview;
  saved bookmark/search labels can fall back to the publication title. The
  frontmatter fallback is the localized Start of book label, not a spine number.
  While page counts are pending, the seek preview shows its target percentage
  and counting status, not a guessed chapter ordinal based on the spine.
- Preserve search semantics and matching/navigation engine. The study uses
  literal, case-insensitive search with a three-character minimum only as a
  representative UI; it is not an engine replacement.
- Preserve existing toolbar/progress auto-hide, focus/reveal/dismissal behavior.
  Hiding chrome must not reflow or repaginate a book. The study keeps chrome
  visible for review, not as a proposed runtime behavior.
- Keep Ambra's page/count information in progress chrome, not a duplicate
  decorative page number inside the book. Never hide publication-authored numbers.
- Preserve first-tap dismissal, native text/selection ownership, full-height
  outer-edge targets, no-gutter navigation, shortcut ownership, location/CFI,
  and reader/history lifecycle guarantees.

## 6. Annotations and note editing

Use **Annotations** consistently in toolbar and panel. Keep Import and Export.
One compact **Show** dropdown replaces wrapped filter chips:
All annotations, Highlights, Notes, Bookmarks, with live counts. Noted highlights
also belong to Highlights; Notes is an overlapping subset, not a disjoint type.

Notes lead with **Your note**, the reader's own words, and a visible Edit note
action. The quotation is smaller and quieter; location/navigation comes last.
Plain highlights have Add note, not an empty note block.

Inline editing has explicit Save/Cancel. Drafts survive panel/filter changes.
Escape cancels only the editor and respects composition. Blank new notes cannot
save; clearing an existing note removes the note while retaining the highlight.
Restore focus to the edit action, or Show if the updated item leaves the current
filter. Render note text literally, including multiline text. Preserve the real
annotation mutation/import/export lifecycle; the in-memory study is not storage.
In the in-book highlight popup, Close stands alone in the header. Put the
explicitly labelled Delete highlight action below the editor, separated by a
divider, rather than beside Close or the note's Save/Cancel actions.

## 7. Read-along

Read-along is a primary capability of a book with recorded media overlays, not a
settings/search utility:

- Automatically expose its controls when recorded narration is available.
  **Initially paused; never autoplay.** No separate toolbar Listen entry.
- Books without media overlays show no audio UI.
- Expanded strip below progress: Read along and speed upper-left; position
  actions and Collapse upper-right; centered prominent Play/Pause with secondary
  Previous/Next in their own transport row.
- Keep visible labels for Previous, Play/Pause, Next, Speed, position actions,
  and Collapse/Expand, including in narrow layouts. Wrap rather than replacing
  these labels with icons. Short visible labels retain descriptive accessible
  names; reserve alternate-label space to avoid layout jumps on playback or
  selection changes.
- Collapse retains persistent compact Play/Pause and Expand, not dismissal.
- Preserve speed, previous/next, Return to narration, and position selection.
  Exact default label: **Listen from this page**; selected text changes it to
  **Listen from selection**. Return appears only once narration has been requested
  and browsing has moved away from its position.
- Reuse real playback, media-overlay, highlight, fixed-layout, seek, failure, and
  lifecycle behavior. The study plays no audio and simulates control states only.

Automatic paused visibility is an intentional behavior change from explicit
Listen-to-open. Collapse is ephemeral to this reader opening: reopening starts
expanded and paused. Collapsing never pauses playback or cancels a pending audio
load, and does not write the retired discovery-notice preference. Playback errors
remain visible in either presentation.

Panels above the read-along strip use its measured height, including changes
caused by collapse, localization, or an error. Panels already inside the reduced
content pane must not subtract that space twice.

## 8. Progress scrubber and bookmarks

- Nearly the full available reader width, with modest margins; no 400px cap and
  no side chapter label consuming track width. Preserve keyboard fine adjustment.
- Resting information describes the actual current page/count/percentage and
  pages remaining in its chapter. It stays unchanged while dragging.
- Destination chapter/page appears in a preview attached just above the thumb,
  constrained horizontally at the edges. Release commits navigation; cancelled
  pointer/keyboard interactions do not seek. Use real measured/estimated position
  semantics and never claim precision the engine does not yet have.
- Preserve chapter boundaries/upcoming bands and progress-landmark preferences.
  Do not label every chapter inline. Preserve fixed-layout, RTL progression,
  scrolling-mode policy, fast seek, pending/error, and asynchronous seek contracts.
- Bookmark flags sit **below** the track, with a hit area separate from scrubbing.
  Empty bookmark-lane space does not seek. An isolated flag directly navigates to
  the saved bookmark location, exactly as its Annotations entry does, not merely
  an approximate page fraction.
- Bookmark density never adds rows or footer height. Screen-space collisions
  produce a counted group centered on its position range, including the count
  badge in overlap calculations. Wider layouts can separate groups again.
- Clicking a group opens a compact chooser showing count/range and at most five
  distinct destinations. Larger groups expose **Show all bookmarks**, opening
  Annotations temporarily filtered to Bookmarks. A later command-bar opening
  restores the user's last explicit filter (All annotations by default), rather
  than retaining the shortcut's filter. Explicit choices made during the visit
  are still remembered. Keep this fallback visible without scrolling
  the popup. The visual badge can cap at 99+; accessible counts remain exact.
- Preserve separate saved targets even when multiple bookmarks share a rendered
  page. Use existing safe label/excerpt information to disambiguate where
  available. Never merge/delete stored bookmarks to simplify their display.
- Support pointer, touch, keyboard, Escape/outside dismissal, focus restoration,
  and focus continuity when resizing regroups markers. Grouping must remain
  bounded with dense data and must not leak events to the slider/page-turn zones.
- Show all bookmarks transfers focus to the Annotations Show control only after
  the chooser has closed and released its focus scope. Move focus to the group
  flag before closing so automatic trigger restoration cannot steal the panel's
  focus afterward. In fixed-layout spreads,
  creating a bookmark uses the selected companion page, not always the primary
  document; the marker, saved target, and displayed page must agree.

Study reference measurements, not universal translated-layout constants:
24px bookmark row; normal desktop footer about 85px; preview 6px above the track
hit area. Preserve the compact hierarchy with zoom, larger text, and localization
rather than clipping content to satisfy those exact pixels.

The initial runtime integration uses a 72px footer (26px slider, 24px bookmark
lane, 20px actual-position row, and 2px border/padding). This fits the existing
76px publication inset without changing pagination geometry. The prototype's
85px footer is not a required runtime height.

## 9. Whole-extension pattern and parity map

The v0.1 source audit counted 47 visual/root TSX files at
`be658d87f8afb5d48759199287099d168d52e0b4`. Reconcile this inventory against the
current source before implementation and again at the final gate. New files must
be mapped too; the count is an audit baseline, not a completion target.

Paths below are relative to `apps/extension/src/` unless noted.

| Family / source coverage | Canonical pattern / preservation obligation |
| --- | --- |
| `library/main.tsx`, `reader/main.tsx`, `library/LibraryApp.tsx`, `reader/ReaderApp.tsx` | Shared app chrome/providers; native sizing, routing, state ownership, one-panel coordination. |
| `components/BookMetadataRows.tsx`, `BookSaveAsAction.tsx`, `ErrorDetails.tsx`, `HelpAboutFlyout.tsx`, `KeyboardShortcutsDialog.tsx`, `ModalFlyout.tsx`, `PaneSections.tsx` (same components directory) | Metadata/sections, utility actions, dialogs; preserve Save as, diagnostic privacy, modal semantics and focus return. |
| `library/AboutFlyout.tsx`, `BookDetailsFlyout.tsx`, `LibraryDiscovery.tsx`, `LibraryEmptyIllustration.tsx`, `LibraryEmptyState.tsx`, `LibraryFlyout.tsx`, `LibraryImportError.tsx`, `LibraryImportIllustration.tsx`, `LibraryImportStatus.tsx` (same library directory) | Collection/detail/discovery/status patterns; preserve import transactions, duplicates, cancellation, recovery and first-run actions. |
| `reader/components/Toolbar.tsx`, `TocPanel.tsx`, `AnnotationsPanel.tsx`, `SearchPanel.tsx`, `BookDetailsPanel.tsx`, `EpubInspectorPanel.tsx`, `GoToDialog.tsx` (same reader components directory) | Toolbar and reference panels, with focused Go to dialog and explicit Inspector exception; preserve target/location and keyboard ownership. |
| `reader/components/SelectionToolbar.tsx`, `HighlightActionPopup.tsx`, `HighlightNoteEditor.tsx`, `HighlightStylePicker.tsx`, `NoteMarkers.tsx`, `FootnotePopup.tsx` | Contextual actions/editing; native selection, user ink/style, anchors, composition, note drafts, non-modal context semantics. |
| `reader/components/DefaultableSlider.tsx`, `NarrationControls.tsx`, `NarrationDiscoveryNotice.tsx`, `ProgressScrubber.tsx`, `ProgressMarkerLayer.tsx`, `PageFurniture.tsx`, `ReaderPreferencesMenus.tsx` | Transient settings, playback/progress strips, publication-adjacent indicators; no engine replacement, scope migration, autoplay, or geometry regression. |
| `reader/components/ImageViewer.tsx`, `TableViewer.tsx` | Modal viewers; retain inertness/focus trap, zoom/pan/scroll, content and transparency. |
| `reader/components/ReadingWelcome.tsx`, `FriendlyError.tsx`, `BookTroubleIllustration.tsx`, `LiveRegion.tsx`, `AmbraMarkIcon.tsx` | Welcome, explicit status/error/recovery, announcements, identity; do not erase acknowledgement or failure states. |
| `reader/ChromeThemeContext.tsx`, `i18n/LocaleContext.tsx`, `shortcuts/ShortcutPreferencesContext.tsx`, `packages/shell/src/components/AmbraThemeProvider.tsx` | Supporting theme/localization/shortcut providers; consistent portal/cross-document behavior and existing persistence. |

Inspector's technical density, docking, tree/code/editor interaction are explicit
exceptions to ordinary reference-panel density and the prototype's simplified
panel coordinator. Do not remove or force them into a generic panel incidentally.
Existing image/table viewers, footnotes, selection controls, Go to, welcome,
errors, importing and Save as need a parity review, not speculative redesign.

### Local first-reading margin-guide prototype

The `VITE_AMBRA_LOCAL_FEATURES=1` preview extends the existing reading welcome,
not the first-run persistence model. After the welcome's exit finishes, shade
the full height and width of each outer margin with a persistent low-opacity
accent wash. Pulse the arrow icons gently for three seconds, then leave static
directional hints. Add a small, dismissible callout pointing toward the next-page
outer margin: **Click or tap in the margins to change pages.** Use the active
theme's accent and solid surface. The callout may temporarily overlap the page
edge, but the shading stays in true whitespace. Do not capture focus or make the
walkthrough modal. Only the close button intercepts pointer input; dismissing it
returns focus to the reading position without turning a page.

Measure actual outer publication bounds through the controller. Never paint
the spread gutter or the whitespace-sensitive overlap region inside the text
measure. Keep chrome above the shading, use arrows without labels below
120 px, and retain only the shading below 18 px rather than cover content. Remeasure after
layout/resize; RTL reverses the meaning, not the physical arrow. Hide while
another reading surface is open and in scrolling mode. A committed navigation
ends the guide, including navigation from an open panel; boundary no-ops,
failed navigation, progress persistence and layout alone do not. Reopening
Reading tips explicitly is the only replay path after acknowledgement. Successful
navigation or explicit dismissal fades the shading, arrows, and callout together
over 240 ms. Reduced motion skips both pulse and fade, not the initial shading.
Hidden guides finish immediately rather than returning for a delayed exit.

## 10. Superseded proposals and outstanding decisions

| Earlier proposal | Approved replacement |
| --- | --- |
| Combined app/book settings side panel | Separate transient Ambra settings and Book options, preserving actual scope. |
| Select books/multiselect and duplicate overflow details actions | Direct details, focused-book Delete/Backspace, single-book confirmation. |
| Compact three-column cover grid | Cover-and-metadata list with search/sort and persistent main actions. |
| Library before Contents; separate fabricated chapter number | Contents before Library; authored navigation-label string only. |
| Wrapped annotation chips / toolbar Notes | One Show dropdown; Annotations everywhere. |
| Toolbar/title-area Listen entry | Automatically available paused read-along, persistent collapsed playback. |
| Short progress bar and side chapter label | Wide chapter-aware track, actual current readout, target preview at thumb. |
| Above-track or vertically stacked bookmarks | Below-track fixed-height row with collision groups and bounded chooser. |

Resolve explicitly during the appropriate phase: exact token values;
native-popup geometry/overflow with all locales; responsive
non-pinnable library-panel geometry; existing Inspector coexistence; truthful
pending/unknown page positions; real same-page bookmark disambiguation. Do not
treat simulated pages, available storage, pin defaults, disabled controls, or
sample narration as approved runtime algorithms.

Drag/drop import (#293), additional first-run page-turn guidance (#291), review
prompts (#254), the website/guide install link (#295), and unrelated content/CI
bugs remain separate work. Preserve existing capabilities; do not silently absorb
those new features into the overhaul.

## 11. Implementation phases and acceptance

The linked issues in [#289](https://github.com/BCWalters/ambra/issues/289) are the
execution checklist. Use small, sequential PRs; phases may need multiple PRs.

| Phase | Scope | Existing reports / prerequisite |
| --- | --- | --- |
| [1 / #296](https://github.com/BCWalters/ambra/issues/296) | Semantic theme, action/focus, and shared surface foundations | #288; design baseline first. |
| [2 / #297](https://github.com/BCWalters/ambra/issues/297) | Full/compact library, discovery, covers, details, settings/help | #283, #284; phase 1. |
| [3 / #298](https://github.com/BCWalters/ambra/issues/298) | Reader toolbar, settings scopes, panel lifecycle, in-reader library | #287; phases 1-2. |
| [4 / #299](https://github.com/BCWalters/ambra/issues/299) | TOC/Search/Annotations and note-first editing | Phases 1-3. |
| [5 / #300](https://github.com/BCWalters/ambra/issues/300) | Automatic paused read-along and compact playback | Phases 1-4; real media-overlay lifecycle tests. |
| [6 / #301](https://github.com/BCWalters/ambra/issues/301) | Wide scrubber, current/target separation, clickable/grouped bookmarks | #294; phases 1-5. |
| [7 / #302](https://github.com/BCWalters/ambra/issues/302) | Remaining surface parity, non-happy paths, final integration and docs | All prior phases. |

Every runtime phase must preserve behavior outside its declared intentional
changes, update related user documentation at the appropriate release point,
and validate the smallest relevant tests plus required CI. Do not close an
underlying report just because its prototype or planning issue exists.

Final gate:

- Map every inventory family to a shared pattern or documented exception.
- Verify normal/hover/focus/selected/pressed/disabled/busy, empty/no-results,
  errors/recovery, destructive and in-progress states where applicable.
- Actual native popup plus 320px compact, wide/narrow library/reader, zoom/large
  text, long/unbroken/CJK titles, deep TOCs, dense annotations/bookmarks,
  very long books, fixed-layout, scrolling, spreads, and LTR/RTL.
- All nine locales: en, de, es, fr, it, ja, ko, ru, zh; five interface themes,
  browser light/dark, independent page themes; no clipped localized actions.
- Mouse/touch/keyboard, focus order/return and ownership, reduced motion,
  forced colors, semantic announcements, correct roles/names/state.
- WCAG AA: 4.5:1 normal text, 3:1 large text and applicable non-text/focus contrast.
  Automated keyboard/accessibility-tree checks do not prove VoiceOver/NVDA
  behavior; report actual manual AT coverage and remaining gaps honestly.
- Preserve saved positions/CFIs/history, annotation imports/exports, selected
  inks, preferences, transactional imports, book reuse/routing and local privacy.
- Measure geometry and interactions as well as comparing screenshots. Prototype
  checks are supporting evidence, not extension regression coverage.

Documentation/prototype publication requires no extension build or release
package. Runtime phases still require protected review/CI. A new release needs
separate approval and the existing feature-minor/bugfix-patch policy; do not
overwrite immutable 1.1.1 artifacts or infer Chrome Web Store approval.
