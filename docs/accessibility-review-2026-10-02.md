# Pre-2.0.0 accessibility review

Reviewed 2 October 2026. Baseline: `b509862`, including all five final issues
and the approved features enabled in ordinary builds. This is an engineering
review, not WCAG certification or a substitute for testing actual screen-reader
speech.

## Findings and remediation

| Finding | Impact | Remediation |
| --- | --- | --- |
| Contextual footnote and highlight-note dismissal loses focus to the document body | Keyboard and screen-reader users lose the activation/reading location after Escape, Close, Cancel or Save; the next Tab can jump to the progress slider | Retain the connected activation target, restore it after dismissal, and fall back to the managed reading boundary when the target disappears. Pointer-outside dismissal does not force a return. Navigation/new popups invalidate pending restoration. |
| Long footnotes overflow the viewport without scrolling | At 320 x 700, a reproduced note measured 5087px high; a long identifier displaced Close beyond x=5479 | Bound the popup to the viewport, allow vertical scrolling, wrap long tokens, and keep the Close button from shrinking. |

Both findings are medium-priority accessibility defects. They relate to focus
continuity (WCAG 2.4.3) and reflow (WCAG 1.4.10), respectively. They are not
claims that the entire application is inaccessible.

Regression coverage lives in
[footnote-noteref](../apps/e2e/tests/footnote-noteref.spec.ts) and
[note-save-lifecycle](../apps/e2e/tests/note-save-lifecycle.spec.ts):

- Keyboard reference activation and Escape/Close return without page movement.
- Ordinary long notes and unbroken identifiers at 320 x 360.
- Reachable Close, viewport containment, no horizontal overflow, keyboard
  scrolling to the bottom, and no publication page turn during note scrolling.
- Note Escape, Cancel and Save return to reading; surviving note markers regain
  focus; deleting a marker falls back to reading.
- Existing reader dismissal tests retain intentional pointer behavior.

## Coverage

Every surface below was inspected in source. Browser coverage exercised
representative real flows, not every combination of book, language and setting.

| Surface | Reviewed concerns | Manual follow-up |
| --- | --- | --- |
| Native popup, full and embedded Library | Landmarks, toolbar names/order, compact layout, collection controls, import handoff, focus return | Native window announcements and transitions |
| Dedicated importer | Initial chooser focus, native cancellation/retry, multiple files, drop alternative, progress/errors/duplicates, busy actions, destination routing | Real macOS picker and status speech |
| Library search/sort/cards/details/removal/discovery | Accessible names, full titles, counts, dialog names, default Cancel, removal failure/retry, collection focus, external links | Count timing, selected sort state, consequences |
| Save as and Inspector | Keyboard entry/return, docking/fullscreen, file/tree/code controls, errors | Native save dialog and dense technical navigation |
| Publication entry and reading | Retained reading boundary, semantic iframe content, same-spine and chapter navigation, pagination/scroll, spreads, RTL, fixed layout | Continuous reading, rotor order, skipped/repeated passages |
| Contents, Search, Go to and reference panels | Pin state, navigation ownership, results/errors, invalid/pending destinations, focus return, narrow overlay behavior | Spoken panel/state/destination changes |
| Annotations | Selection actions, highlight/note lifecycle, filters, bookmarks, publisher annotations, import/export validation, deletion | Selection and color naming, error timing, editing continuity |
| Footnotes, image and table viewers | Dialog names, contextual return, shortcuts, zoom/reset, scroll/reflow, content traversal | Text, alt descriptions and table headers |
| Progress slider and bookmark groups | Value text, keyboard navigation, grouped choices, available destinations, pending/failed seek | Speech verbosity and reading-location continuity |
| Typography and Ambra settings | Native choices/sliders, units/defaults/reset, interface/publication theme separation, language, shortcut ownership | Selected values and changed publication presentation |
| Help, About, welcome and margin guidance | Dialog names, focus containment, dismissal/acknowledgment, reduced motion, RTL, non-focus-stealing guidance | Announcement ordering and guide speech |
| Review question and follow-ups | Real eligibility, modal containment, persisted responses/cooldown, focused primary links, blocked competing dialogs | Changed title/body speech and external transfer |
| Read-along | No autoplay/focus steal, transport, speed, follow/listen/collapse, narrow/localized controls | Actual audio and screen-reader coexistence |
| Cross-cutting visuals | Narrow/zoom-equivalent layouts, forced colors, reduced motion, five interface palettes | Real magnification and authored publication colors |

## Evidence and limits

The engineering audit ran 113 existing browser cases successfully, with one
intentional local-simulation skip, plus 162 targeted unit assertions. Both
findings were reproduced again in a fresh ordinary build at `b509862`.
Real-release review responses were separately exercised without exposing
simulation controls.

Palette checks across the five interface accents found text/subdued contrast
ratios of 13.75/5.67 in light appearance and 11.86/6.85 in dark appearance.
Minimum tested accent/surface contrast was 6.58 light and 8.07 dark; minimum
action foreground/background contrast was 6.64 light and 8.95 dark. These
numbers cover those palette pairs, not every composited surface or EPUB.

Actual VoiceOver speech, native macOS accessibility text-marker behavior,
external review/email transfer and the owner's Chrome profile were not tested.
DOM/keyboard/accessibility-tree results do not certify those outcomes. EPUB
accessibility also depends on publisher semantics, alt text, tables, SVG and
fixed-layout content. Preserve these distinctions in any release claim.

Use the [screen-reader walkthrough](screen-reader-walkthrough-2.0.0.md) for the
owner's manual pass before preparing the 2.0.0 release.
