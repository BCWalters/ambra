# Ambra 3.3.1: detailed manual accessibility campaign

This is a test procedure, not a completed accessibility assessment or
certification. The owner's earlier VoiceOver pass remains evidence for its
earlier candidate. Every result below starts **Not tested** on 3.3.1.

Allow about 30 minutes per session. Stop at the time limit, record the last
completed check and resume there next time; unfinished checks do not become
passes. The [earlier walkthrough](screen-reader-walkthrough-2.0.0.md) supplies
additional task variations, not transferable results.

## Candidate and evidence

Use the exact unpacked extension in the 3.3.1 owner handoff in a dedicated Chrome
profile. Keep your real Library and annotation exports separate. Before the
first session, record:

| Field | Record from the actual test environment |
| --- | --- |
| Candidate | Version, merged commit and ZIP SHA-256 from `release.json` |
| Environment | macOS/Windows, Chrome and screen-reader versions |
| Reader | Mode, page layout, progression, language and interface/page themes |
| Accessibility | VoiceOver modifier/Quick Nav or NVDA browse/focus mode; keyboard navigation settings |
| Display | Browser zoom, viewport, contrast and reduced-motion settings |
| Session | Reviewer, date/time, completed check IDs and resume point |
| Publications | Fixture/book identity and relevant chapter/page |

Use a known semantic reflowable book with headings, lists, links, image
descriptions, a table and footnotes. Add a long chapter, RTL fixed-layout book,
mixed-layout book and narrated book where available. The
[owned E2E fixtures](../apps/e2e/fixtures/) and package-bound W3C kit provide
repeatable mechanics; record missing publications rather than substituting an
unrelated test for a required case.

For each check, record **Pass / Fail / Not tested**, action, expected result,
actual speech, keyboard focus, reading/virtual-cursor position, recovery and
evidence. Record exact unexpected speech when useful; recordings are optional
and should not expose private book text. Keep platform campaigns separate.
If you use a mouse to get past a blocker, record the inaccessible route first.

Ordinary Tab/Shift+Tab, Ambra shortcuts and screen-reader navigation are separate
test paths. If the screen reader consumes a command, record that fact and try
the visible control without calling the shortcut an Ambra failure.

## Session A: import and collection

| ID | Action | Required observation |
| --- | --- | --- |
| A1 | Open Ambra from the browser toolbar without a mouse. | Library, Import and Help have useful names; focus is visible and ordered. |
| A2 | Open Import; cancel the native file picker; reopen and choose a book. | Named importer, useful initial focus, reliable cancel and no accidental browser-window closure. |
| A3 | Import a second book and then a duplicate. | Progress/completion identify the book, without excessive repeated speech; duplicate does not create another copy. |
| A4 | Import a harmless invalid file and retry a valid book. | Error and retry are discoverable; remaining Library data survives. |
| A5 | Search title/author, search for no results, clear and change sort. | Search retains focus; selected sort and results/empty state are understandable. |
| A6 | Open Details; cancel removal; confirm removal of a disposable book. | Modal containment/return are useful; destructive consequences are clear. |
| A7 | Repeat representative actions in the compact popup and reader Library. | No hidden essential controls or keyboard trap; screen-reader group exit works independently of Tab. |
| A8 | Read several pages and return to the already-open Library. | Correct saved progress and Continue reading; no stale or unexplained status. |

## Session B: publication entry and continuous reading

| ID | Action | Required observation |
| --- | --- | --- |
| B1 | Enter a new book; dismiss welcome with Start reading, then test Escape in a separate fresh state. | Named welcome and contained controls; content entry does not silently turn a page. |
| B2 | Use heading, link and list navigation, including the rotor where applicable. | Authored structure and reading order remain available inside the publication. |
| B3 | Read continuously across a same-chapter page boundary and a chapter boundary. | Record exact last/first words; no omission, duplication, cursor reset or unexplained chrome entry. |
| B4 | Repeat B3 in scroll, single-page and spread modes. | Both visible spread documents are reachable in intended order; mode changes preserve a useful position. |
| B5 | Turn forward/backward with accessible controls and ordinary shortcuts. | Focus and virtual cursor have useful destinations; disabled book edges are understandable. |
| B6 | Open Contents, follow a chapter, then follow a Search result. | Destination content is readable; panel close/return is useful. |
| B7 | Use Go to and Position in book with valid/invalid destinations. | Named values/errors/busy state, accessible cancellation and correct final destination. |
| B8 | Resize, close/reopen and resume the book. | Saved reading location and usable publication entry survive. |

Automated keyboard or AX-tree evidence cannot establish B3's spoken continuity.
Record visible focus and virtual cursor separately even when one appears correct.

## Session C: annotations and 3.3.1 error diagnostics

| ID | Action | Required observation |
| --- | --- | --- |
| C1 | Select text using the screen reader's selection workflow; create a highlight and note. | Selection, color actions, textarea and Save/Cancel have useful names and are reachable without dragging. |
| C2 | Extend a selection beyond a visible page; create an annotation in single-page and spread modes. | Preview and saved quotation agree with visible-page content, not hidden next-page text. |
| C3 | Select independently on each spread side, including a chapter boundary and reordered caption when available. | Correct owning page/chapter; no silent envelope over hidden reordered text. Record unavailable fixtures. |
| C4 | Edit/Save, edit/Cancel, Escape and reopen an existing note marker. | Draft behavior is clear; focus returns to the surviving marker or useful reading location. |
| C5 | Filter annotations, navigate a bookmark/group and delete a disposable highlight. | Counts/types are understandable; deleted controls do not remain the focus destination. |
| C6 | Export/reimport valid test annotations, then try malformed JSON. | Named success/error, preserved existing data; existing cross-page annotations are not truncated. |
| C7 | Cause a harmless visible import/annotation error and activate its Copy diagnostics. | Notification and action are spoken/reachable; copied local text identifies that error and available original context. |
| C8 | Replace/dismiss an error and copy a later notification. | Copied-state feedback resets; the later report is not mislabeled with an earlier error. |

Review copied text locally before sharing. Missing error fields should be
identified as unavailable, not invented. A naturally untriggerable error route
stays Not tested; do not corrupt the real Library to force it.

## Session D: dialogs, settings, Help and Inspector

| ID | Action | Required observation |
| --- | --- | --- |
| D1 | Open a footnote; close by Escape and Close. | Named readable dialog, contained focus and return to the exact reference without losing position. |
| D2 | Open a long footnote, image viewer and table viewer. | Text/descriptions/headers, scrolling and zoom controls are reachable; scrolling a viewer does not turn pages. |
| D3 | Open Book options and Ambra settings; change values, reset and change language once. | Labels, selected values and units are spoken; focus and reading position survive. |
| D4 | Open/pin/unpin opposing reference panels and then close them. | Nonmodal panels do not trap focus; modal dialogs do. |
| D5 | Traverse Help, tips, shortcuts and diagnostic copy; toggle fullscreen where available. | Activation and state changes are understandable; Escape/close and focus return work. |
| D6 | Open Inspector and navigate tree, files, source links and docking/fullscreen. | Technical controls are named and operable; close returns usefully. Record dense-control problems explicitly. |
| D7 | Exercise the review invitation only with a naturally eligible disposable state. | Named dialog, meaningful follow-up and contained focus; do not send email/post a review to complete testing. |

If D7 cannot be reached in the production candidate, mark it Not tested.
Development simulation is separate evidence, not exact-candidate acceptance.

## Session E: visual, keyboard and motion stress

Repeat Library/import, reference panels, settings, long footnote, annotation
editor and narration controls. Record which surfaces actually received each
condition rather than marking the entire session passed from one dialog.

| ID | Condition | Required observation |
| --- | --- | --- |
| E1 | Keyboard-only Tab/Shift+Tab and Escape, screen reader off. | Visible focus, logical order, no trap and no mouse-only essential action. |
| E2 | 200% and 400% browser zoom; narrow and short viewport. | Essential actions remain visible or reachable by scrolling; controls/text do not overlap or disappear. |
| E3 | Light/dark interface and page themes; system contrast settings. | Focus, selected states, errors and links remain distinguishable; meaning is not color-only. |
| E4 | System reduced motion, including Page flip/Slide/Film strip. | Reduced motion is respected; state, destination and focus still update correctly. |
| E5 | One representative long title, large font and localized interface. | Useful accessible names, no spoken truncation or unreachable clipped controls. |

Human inspection is not a contrast-ratio measurement or WCAG certification.
Record measured ratios separately if a suitable existing tool is used.

## Session F: alternate publications, narration and confirmation

| ID | Action | Required observation |
| --- | --- | --- |
| F1 | Repeat entry and navigation in RTL fixed-layout and mixed-layout books. | Authored order, spread ownership and useful focus; distinguish publisher defects from Ambra defects. |
| F2 | Open a narrated book and find expanded/collapsed controls. | No unexpected autoplay/focus theft; useful names and current state. |
| F3 | Listen to real audio with the screen reader running; play/pause, passage navigation and speed/follow controls. | Audible output and intelligibility, no conflicting speech or unexplained reading-focus movement. |
| F4 | Revisit earlier failures after a fix using the identified new candidate. | Original reproduction and recovery pass; evidence is not silently assigned to the previous ZIP. |
| F5 | Review every untested check and publication/platform gap. | Explicit follow-up or documented limitation, never a blanket accessibility pass. |

NVDA on Windows requires its own genuine campaign and environment. A macOS
VoiceOver pass does not establish NVDA behavior. Physical touch, OS switching
and audible output cannot be replaced by browser automation.

## Result record and triage

Copy this row for each executed check into your local session notes:

| Check ID | Status | Actions and expected result | Observed speech/focus/reading position | Recovery | Evidence / issue |
| --- | --- | --- | --- | --- | --- |
| | Not tested | | | | |

At each stop, record completed IDs, unresolved failures and the next ID. Keep
candidate identity with every session; do not combine results from different
builds or environments into one unexplained pass.

Stop the affected test for lost/unreachable content, destructive data loss,
keyboard traps, unusable import or unrecoverable reading-position loss. Preserve
evidence and triage before submission. Lesser verbosity/announcement issues
still need explicit disposition. A finished checklist with Not tested entries
is an incomplete campaign, not complete accessibility acceptance.
