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

## Take your annotations with you

**EPUB annotation export and import** let you back up or share your reading work separately from the book. Ambra exports your highlights, text notes, bookmarks, and bookmark labels as an **EPUB Annotations 1.0 JSON file** (`… - annotations.json`), and imports compatible JSON into the open book.

Use the same book or edition for best results. Ambra skips unsupported locations and detected duplicates. Imported highlights use yellow, and compatibility varies between annotation tools.

## Keyboard shortcuts and help, close at hand

Open **Settings → Help & About** or the **Help & About** footer in **Book details** without leaving your book. The library also has **Help & About**. **Mod+/** opens the shortcut popup; **Mod** means Command on Mac and Control elsewhere.

Some useful defaults:

- **Mod+F:** search the book. **Mod+B:** toggle a bookmark.
- **Page Down / Page Up:** next / previous page in pagination.
- **Space / Shift+Space:** next / previous page in pagination. In scrolling mode, Page keys and Space retain native scrolling.
- **Left / Right:** navigate in the physical direction, following the book’s reading direction, including right-to-left books; in scrolling mode, move between sections.
- **Alt+Page Up / Alt+Page Down:** previous / next **section**—a reading-order file (spine item), not necessarily a table-of-contents chapter.
- **Escape:** dismiss a dialog and return focus to its opening control.

The shortcut popup is a quick reference showing the default shortcuts for your current platform. A single **Enable keyboard shortcuts** checkbox lets you turn Ambra’s shortcuts on or off globally. This preference stays local and is shared across Ambra tabs in the same browser profile. Browser or assistive-technology shortcuts may take priority; visible controls remain available.

## Reading tips

- **Settle back into the book.** When reader controls are showing, a page-turning click or tap first dismisses them without turning the page. The next click turns normally. Pinned panels stay open; links, images, and deliberate swipes retain their own behavior.
- **Choose your rhythm.** Pagination turns pages; scrolling keeps Page Up, Page Down, and Space available for native scrolling. For continuous screen-reader reading, consider scrolling using the shortcut above. Mode selection is reflowable-only; choosing the current mode leaves it unchanged.
- **Keep keys in context.** Reading navigation belongs to the book content; modified commands such as search, bookmark, and the shortcut popup can also work from toolbar buttons. Text fields, selections, interactive widgets, and dialogs retain their own keys. Ambra does not require a screen reader’s application mode.
- **On a Mac laptop.** Page Up/Down may need **Fn+Up/Down**. Section navigation then uses **Option+Fn+Up/Down**; add **Shift** to select pagination or scrolling respectively. A section is a spine item, not necessarily a named chapter, and the default Left/Right navigation follows the book’s reading direction.

## Local library, thoughtful sharing

Book handling and library storage stay in your browser profile, without a cloud library or automatic cross-device library sync. Keep original EPUBs and annotation exports as backups: storage has limits, and removing the extension, clearing its data, or losing the profile can remove local books and reading data.

Feedback is welcome through [GitHub issues](https://github.com/BCWalters/ambra/issues) or [AmbraEPUB@outlook.com](mailto:AmbraEPUB@outlook.com)—email needs no GitHub account. Reader diagnostics may include book details, paths, reading positions, and recent actions. Review them before sharing; nothing is sent automatically. GitHub issues are public.

Ambra is in beta; its planned unlisted extension-store release is not yet published. Visit the [public, MIT-licensed repository](https://github.com/BCWalters/ambra) for source and beta context, and the canonical [privacy policy](https://github.com/BCWalters/ambra/blob/main/store-assets/privacy-policy.md) for privacy details.
