# Ambra — read comfortably, look deeper

Ambra brings a personal EPUB library and an integrated EPUB Inspector to Chrome. For readers, it is a place to make books your own: adjust the reading experience, find passages, and keep your notes. For EPUB authors and publishers, it connects the book you see with the files behind it—making investigation and debugging easier without leaving the reader.

**Here to explore how a book is built?** Meet the [EPUB Inspector](epub-inspector.md): source and content inspection, reading-to-source navigation, and reference finding in one place.

> **Reading with a screen reader?** For continuous reading in a reflowable book, consider scrolling mode: **Alt+Shift+Page Down** (**Option+Shift+Page Down** on Mac). Return to pagination: **Alt+Shift+Page Up** (**Option+Shift+Page Up** on Mac).
>
> Mac laptops may require **Fn+Down/Up** for Page Down/Up, together with the other shortcut keys. These commands select a mode rather than toggle it and preserve your reading position. Fixed-layout books keep their fixed layout.
>
> Choose whichever mode works for you. Screen-reader support is still being tested; feedback about your reading experience is welcome.

## More room for reading

- **A library on your device.** Import saved EPUBs, keep books together, and return to your saved reading position.
- **A reading style that suits you.** Adjust text and reader themes, and choose pagination or scrolling for reflowable books. Fixed-layout books retain the publisher’s page design.
- **Find your way.** Use the table of contents, book search, reading-position control, and bookmarks to reach the passages that matter.
- **Keep your thinking alongside the text.** Highlight passages, add notes, and revisit them with your bookmarks.
- **Listen when the book includes narration.** Play embedded recorded narration with synchronized text highlighting; this depends on the EPUB’s supplied narration, not automatic text-to-speech.

**Book details** gives the description its own section, with rights and accessibility information under **Publication details**. **Show more** reveals a longer, still bounded excerpt; an ellipsis means text was omitted. Descriptions retain at most two paragraphs (700 characters initially, 1,400 expanded); rights statements are capped at 140 characters initially and 600 expanded. These are excerpts, not interpretations of legal terms. EPUB Inspector retains the original metadata.

**Page theme** is in **Settings**, next to **Brightness**, and applies across books. Its compact dropdown offers **White**, **Sepia**, and **Dark**. For reflowable content, these control the page background and base text/link colors, even when a publisher specifies its own page colors. Deliberately colored passages and illustrations retain their own styling. The **Book default** font choice still preserves publisher typography, and fixed-layout artwork is never recolored. Previously saved per-book page themes are no longer used; an existing legacy default page theme becomes the global choice, otherwise the default is **White**.

**Always show one page**, in the book's **Page** menu, keeps reflowable paginated content on one centered page instead of a two-page spread. This choice is saved per book and is off by default. It also applies to reflowable sections in mixed-layout books; fixed-layout pages are unchanged. Scrolling is unchanged and already uses a centered, width-limited reading area.

**Bookmarks on the progress bar** appear as small blue ribbons once book-wide pagination is ready. They update when text size or window size changes, and mirror for right-to-left books. The bar keeps its usual click, drag, and keyboard controls; use **Bookmarks and highlights** to browse saved bookmarks by name.

## Take your annotations with you

**EPUB annotation export and import** let you back up or share your reading work separately from the book. Ambra exports your highlights, text notes, bookmarks, and bookmark labels as an **EPUB Annotations 1.0 JSON file** (`… - annotations.json`), and imports compatible JSON into the open book.

Use the same book or edition for best results. Ambra skips unsupported locations and detected duplicates. Imported highlights use yellow, and compatibility varies between annotation tools.

The **Export** button uses a downward download arrow; **Import** uses an upward upload arrow.

## Adding a downloaded book

An empty library offers two choices: **Bring a book → Choose EPUB files...** opens the file picker for EPUBs on your device; **Find your next book → Explore free books** reveals trusted sources below the choices. The cards stack in a narrow popup. Settings, Help, and the popup’s expand control remain in the header; **Import EPUB** and **Sort** appear after your first book is added. You can still explore sources through **Find books** in a populated library.

For beautifully formatted classics, try **Standard Ebooks** and choose **Advanced epub** on a book’s page. **Project Gutenberg** offers a vast collection; choose an **EPUB** or **EPUB3** download. For read-along audio, **ReadBeyond** offers EPUBs with recorded narration; choose **Download**, not the browser-based **Read+Listen**. Source links open in a new tab. Check the book’s license and your local copyright rules.

When a supported EPUB download opens Ambra, keep that library tab open while the book downloads, is prepared for reading, and is added to your library. The status changes to a checkmark and the EPUB’s title after the book has been saved and the library refreshed. Choose **Read now** to open it, or **Dismiss** to clear finished messages without interrupting other imports.

If automatic import fails, follow the error message and use **Choose EPUB files...** (or **Import EPUB** in a populated library) to select the downloaded file. Ambra leaves the original browser download available unless a successful import has been confirmed.

## Keyboard shortcuts and help, close at hand

Open **Settings → Help & About** or the **Help & About** footer in **Book details** without leaving your book. The library also has **Help & About**. **Mod+/** opens the shortcut popup; **Mod** means Command on Mac and Control elsewhere.

Some useful defaults:

- **Mod+F:** search the book. **Mod+B:** toggle a bookmark.
- **Mod+G:** go to a page. **Mod+Shift+G:** go to a percentage.
- **Page Down / Page Up:** next / previous page in pagination.
- **Space / Shift+Space:** next / previous page in pagination. In scrolling mode, Page keys and Space retain native scrolling.
- **Left / Right:** navigate in the physical direction, following the book’s reading direction, including right-to-left books; in scrolling mode, move between sections.
- **Alt+Page Up / Alt+Page Down:** previous / next **section**—a reading-order file (spine item), not necessarily a table-of-contents chapter.
- **Escape:** dismiss a dialog and return focus to its opening control.

The shortcut popup is a quick reference showing the default shortcuts for your current platform. A single **Enable keyboard shortcuts** checkbox lets you turn Ambra’s shortcuts on or off globally. This preference stays local and is shared across Ambra tabs in the same browser profile. Browser or assistive-technology shortcuts may take priority; visible controls remain available.

**Go to** opens a small numeric dialog, not a toolbar menu or a Book details control. Focus the book or a reader toolbar button before using the shortcut. Enter submits a valid whole number; Escape dismisses and returns to reading. Pages range from 1 to the measured book-wide page count, and remain unavailable while that count is being measured. Percentages range from 1 to 100 and use the progress bar’s existing seek behavior (coarse section-based positioning until pagination is ready). Both require reflowable pagination: scrolling and fixed-layout content show an explanation instead of silently doing nothing or changing reading mode. Editing, text selections, widgets, and other dialogs keep their own keyboard ownership.

## Reading tips

- **Turn from the outer margins.** Click to the right of the rightmost page’s reading area to move right, or to the left of the leftmost page’s reading area to move left (reversed reading order in right-to-left books). Content, whitespace inside the reading area, and the gap between pages do not turn pages. For fixed-layout books, only the space outside the scaled pages counts; if the artwork fills the width, use keyboard or toolbar navigation.
- **Settle back into the book.** When reader controls are showing, a page-turning click or tap first dismisses them without turning the page. The next click turns normally. Pinned panels stay open; links, images, and deliberate swipes retain their own behavior.
- **Choose your rhythm.** Pagination turns pages; scrolling keeps Page Up, Page Down, and Space available for native scrolling. For continuous screen-reader reading, consider scrolling using the shortcut above. Mode selection is reflowable-only; choosing the current mode leaves it unchanged.
- **Keep keys in context.** Reading navigation belongs to the book content; modified commands such as search, bookmark, and the shortcut popup can also work from toolbar buttons. Text fields, selections, interactive widgets, and dialogs retain their own keys. Ambra does not require a screen reader’s application mode.
- **On a Mac laptop.** Page Up/Down may need **Fn+Up/Down**. Section navigation then uses **Option+Fn+Up/Down**; add **Shift** to select pagination or scrolling respectively. A section is a spine item, not necessarily a named chapter, and the default Left/Right navigation follows the book’s reading direction.

## Local library, thoughtful sharing

Book handling and library storage stay in your browser profile, without a cloud library or automatic cross-device library sync. Keep original EPUBs and annotation exports as backups: storage has limits, and removing the extension, clearing its data, or losing the profile can remove local books and reading data.

Feedback is welcome through [GitHub issues](https://github.com/BCWalters/ambra/issues) or [AmbraEPUB@outlook.com](mailto:AmbraEPUB@outlook.com)—email needs no GitHub account. Reader diagnostics may include book details, paths, reading positions, and recent actions. Review them before sharing; nothing is sent automatically. GitHub issues are public.

Diagnostics keep the latest 500 events in memory and reset when the reader reloads. They include panel/menu opening, closing and pinning, navigation sources, and setting changes with before/after values. Requested actions are distinguished from completed layout/load events. Entries are capped at 512 characters, and copied context is bounded too. New interaction events omit search queries, annotation text, and link URLs; existing error details can still contain book paths, so review the copied report before sending it.

Ambra is in beta; its planned unlisted extension-store release is not yet published. Visit the [public, MIT-licensed repository](https://github.com/BCWalters/ambra) for source and beta context, and the canonical [privacy policy](https://github.com/BCWalters/ambra/blob/main/store-assets/privacy-policy.md) for privacy details.
