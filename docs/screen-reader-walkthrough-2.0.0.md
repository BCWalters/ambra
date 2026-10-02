# Ambra: pre-2.0.0 screen-reader walkthrough

Prepared for the owner's manual session on 3 October 2026. Allow about 60-90
minutes; pause between sections if useful. This is a release-candidate test,
not evidence that VoiceOver already passed.

## Before starting

1. Use a dedicated Chrome test profile and a disposable Library, not your only
   copy of books or annotations. Identify the exact candidate commit/build;
   the displayed manifest version may still be 1.1.1 before release preparation.
2. Record macOS, Chrome, Ambra and screen-reader versions, browser zoom, chosen
   language, theme, VoiceOver modifier, Quick Nav and keyboard-navigation
   settings. Use your usual VoiceOver settings.
3. Enable VoiceOver with your usual method. Use its configured navigation,
   interaction, rotor and activation commands. In the usual configuration,
   VO means Control+Option; configured alternatives are equally valid.
4. Keep VoiceOver navigation distinct from ordinary Tab/Shift+Tab and Ambra
   shortcuts. If VoiceOver consumes a key, record that separately; don't
   immediately classify it as an Ambra failure.
5. Have a semantic EPUB you know well, preferably with headings, lists, links,
   images, a table and footnotes. Also have a fixed-layout/RTL example and a
   narrated book if available. Owned fixtures are in
   [the E2E fixtures folder](../apps/e2e/fixtures/):
   `reading-entry.epub`, `long-content.epub`, `footnote.epub`,
   `embedded-annotations.epub`, `fxl-spread-rtl.epub` and
   `media-overlay/narrated.epub`. Fixture books test mechanics, not publisher
   content quality.
6. Use a harmless invalid file for import-error tests and save annotation
   exports only to a test folder. Never submit an actual review or email as
   part of this test.

For each section, record **Pass / Fail / Not tested**, exact unexpected speech,
the action, focused item, reading position and whether you could recover.
Attach a screenshot or short recording when useful. If a route is inaccessible,
record it before using the mouse to continue with the rest of the test.

## 1. Empty Library and native import

1. Open Ambra from Chrome's toolbar using keyboard/screen-reader navigation.
   Find the Library landmark, Help and Import book.
2. Activate **Import book**. Expect a separate, clearly named import window
   with **Choose EPUB files...** focused, not an unexplained full Library tab.
3. Open the native picker; cancel. Expect the importer to remain available.
4. Choose one EPUB, then repeat with multiple EPUBs. Hear enough progress to
   know work is continuing without overwhelming repeated announcements.
5. Expect completion and a book-specific **Read now** action. Duplicate import
   should say the book is already present, not silently create another copy.
6. Import the invalid file. Expect an understandable error and retry path.
7. Test **Read now**, **Open library**, and **Close** on separate attempts.
   Reading/Library should open in a normal browser window; the importer closes
   after successful transfer. Close must not close the original browser window.

**Check:** window announcement, chooser focus, picker cancel, busy/complete/error
speech, meaningful action names and useful focus after transfer. Native
drag-and-drop is optional; accessible file selection must work without it.

## 2. Collection and Library tasks

1. In the full Library, navigate book covers and their details/removal actions.
   Expect complete titles, not spoken truncation, and intelligible progress.
2. Read in a separate tab, advance a few pages, then return to the existing
   Library tab. Expect updated progress and Continue reading without reload.
3. Search for a matching title/author, then a nonexistent string; clear search.
   Expect results/empty status without losing search focus.
4. Change sort and confirm the selected value is spoken. Open book details,
   traverse metadata and actions, then close and verify return to the book.
5. Try Save as and cancel its native dialog. Open Find books and inspect the
   named discovery links, but don't depend on external websites for this test.
6. On a disposable book, start removal and Cancel first. Repeat and confirm;
   expect clear consequences and a useful next collection focus.
7. Repeat representative tasks in the compact popup and reader's Library
   panel. Compact layout must not hide controls from keyboard navigation.

## 3. First reading and publication entry

1. On an isolated first-reading profile, open a book. Expect the welcome's
   title, tips and contained controls to be announced.
2. Dismiss with Start reading; repeat with Escape on another fresh test profile.
   Expect entry into publication content without turning a page.
3. The margin guide must not steal focus. Find its Close if desired; dismissing
   it must preserve reading position. Turn a page: the guide disappears.
4. Replay through **Help & About -> Reading tips**, then close the welcome.
5. Use the rotor or your screen reader's structural navigation to find
   publication headings/links/lists. Read a passage continuously.

**Check:** whether speech starts at a useful passage, not unrelated chrome;
correct heading order; no repeated or skipped text after entering the iframe.

## 4. Reading modes and navigation

1. Read across a same-chapter page boundary and then a chapter boundary.
   Compare the next paragraph with the known book; check for gaps or repeats.
2. Open Contents, select another chapter and close. Expect focus/reading to
   follow the chosen destination. Repeat with Search and a result.
3. Search for no results. Confirm clear status and an editable search field.
4. Try Go to with valid and invalid input. Check error naming, busy state,
   Cancel and final reading destination. Use the visible UI if VoiceOver
   intercepts the documented shortcut.
5. Find Position in book. Inspect its name/value, then try ordinary arrow keys,
   Home and End with VoiceOver's appropriate control-interaction mode.
6. Repeat reading in scrolling mode, one-page pagination and a two-page spread.
   Try RTL/fixed-layout content separately; don't assume it has reflowable
   typography controls or high-quality authored reading order.
7. Pin/unpin Contents, Search and Annotations. Open opposing pinned panels,
   resize, close and return to reading. Nonmodal panels should not trap you;
   modal dialogs should contain focus until dismissed.

## 5. Bookmarks, highlights and notes

1. Bookmark a location and verify changed state/status. Navigate it from
   Annotations; try a single and grouped progress-track bookmark if available.
2. Select publication text with your screen reader's selection workflow.
   Find Highlight this selection, choose a color, then add a note.
3. Edit and Save, edit and Cancel, and dismiss with Escape. Check draft behavior
   and that closing the contextual editor returns to reading.
4. Open an existing note marker. After Escape/Close/Save, expect return to the
   surviving marker. Delete its disposable highlight: expect return to reading,
   not the removed marker or the document body.
5. In Annotations, test All annotations, Highlights, Notes and Bookmarks filters;
   inspect counts, quotation versus your note, and edit/delete controls.
6. If present, inspect publisher annotations as read-only content.
7. Export test annotations, reimport the valid export, then try malformed JSON.
   Check success/error status and that failed import preserves existing data.

**Check:** selection feasibility, color/action names, textarea label, asynchronous
save failure if naturally encountered, and useful focus through every exit.

## 6. Footnotes and content viewers

1. In a footnote book, structurally navigate to the reference and activate it.
   Expect a named Footnote dialog and readable content without navigation away.
2. Close with Escape and with Close. Expect return to the exact reference and
   unchanged reading position.
3. Try a long note at narrow width/high zoom. Its content must wrap and scroll,
   Close must be reachable, and scrolling it must not turn publication pages.
4. Open a zoomable image by keyboard. Check its description, zoom/reset
   controls, focus containment and return to its source after Escape.
5. Open a table viewer. Traverse table headers/cells and controls, zoom/scroll
   if needed, then close. Confirm useful focus return and no lost reading place.

## 7. Settings, Help and Inspector

1. Open Book options (Aa). Inspect typography, spacing, width, one-page layout,
   defaults and reset controls; expect selected values and units to be clear.
2. Open Ambra settings: interface theme, language and Reading preferences.
   Change a setting and verify focus stays with the operation.
3. Distinguish interface theme from page theme; test brightness and mode.
   Change language once, then restore it. Reading position must survive.
4. Open Help & About. Traverse expanded About, Reading tips, shortcut help and
   feedback actions. Open/close nested help and verify a useful return.
5. Test shortcut enable/disable and diagnostic-copy status if available.
6. Open Inspector from book details. Try tree/file/code navigation and its
   docking/fullscreen modes. Confirm close/Escape and focus return; record
   inaccessible dense technical controls rather than skipping the surface.

## 8. Review invitation

Use a disposable eligible reader profile: three changed-position reading days
plus reaching halfway through a book. If no eligible profile is ready, mark
real eligibility **Not tested** rather than changing your real preferences.
A separately identified local test build may expose simulation controls for
dialog testing; those controls are intentionally absent from ordinary builds.

1. On entering the eligible full Library, expect the named review question.
   Tab should stay in the modal; Library shortcuts must not open another dialog.
2. Test Later, Escape and Close using separate eligible test states. Expect
   return to Import and a three-day cooldown, not an immediate repeated prompt.
3. Test Yes and Not really in separate states. Expect the changed follow-up
   title/body and focus on the primary review/email link.
4. Close without activating the external link. Expect permanent stop state.
   Do not post a review or send email merely to complete this script.

## 9. Read-along and audio

1. Open a narrated EPUB. Expect discoverable read-along controls without
   autoplay or focus stealing.
2. Test Play/Pause, previous/next passage, speed, follow/return, selection
   listening if supported, and collapsed/expanded controls.
3. Listen to actual narration with VoiceOver running. Check intelligibility,
   competing speech and whether playback moves reading focus unexpectedly.
4. Pause before returning to other tests. DOM playback state alone is not an
   audio-accessibility pass.

## 10. Visual and keyboard stress pass

Repeat an importer, reference panel, long footnote, note editor, settings/help
dialog and narration controls at high browser zoom (including 400%), narrow
width and short height. Try light/dark appearance, interface themes, reduced
motion and your usual system contrast settings. Expect visible focus, readable
controls, reachable scrolling, no clipped essential actions and no forced
animation. Separate publisher-content defects from Ambra shell defects.

## Results and release decision

| Section | Pass / Fail / Not tested | Exact speech/focus problem and reproduction |
| --- | --- | --- |
| 1. Native import | | |
| 2. Collection | | |
| 3. First reading | | |
| 4. Reading/navigation | | |
| 5. Annotations | | |
| 6. Footnotes/viewers | | |
| 7. Settings/help/Inspector | | |
| 8. Review | | |
| 9. Narration | | |
| 10. Visual stress | | |

Stop release preparation for lost/unreachable content, a keyboard trap,
unusable import, or an unrecoverable loss of reading position. Record lesser
verbosity/announcement issues for triage. Unexecuted native speech/audio checks
remain open; automated engineering checks must not silently mark them passed.
