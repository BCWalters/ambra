# Table viewer

In reflowable books, use **Expand table**, the small icon at a visible table’s upper edge, to open the **Table viewer** over your book. It dims the page without hiding it. Smaller tables stay centered; larger tables scroll within the available space. Nested tables share their outer table’s control. Fixed-layout pages retain their page-turn interaction and do not offer table expansion.

Simple single-column text tables, such as some books’ contents lists, flow between pages one row at a time. These do not show **Expand table** when all their content fits through normal reading. Tables with complex structure, horizontal overflow, or a row taller than a page retain the viewer.

## Zoom and move around

The viewer starts at **100%**. **Zoom in**, **Zoom out**, and **Actual size** scale the complete table, not its font size. Zoom ranges from 25% to 400%. Scroll horizontally and vertically with native scrollbars, a trackpad, touch, or the keyboard. Unmodified `+`, `−`, and `0` control viewer zoom; browser Ctrl/Cmd zoom shortcuts remain native.

Tab also reaches disclosures and overflowing code blocks inside table cells. Use arrow keys on a focused code block to scroll its contents without moving the reading page.

## Return to the book

**Close**, Escape, or clicking the dimmed background returns focus to the source control without changing the chapter or page. Clicking the table, its scrollbars, or zoom controls does not dismiss it. Tab stays within the viewer. Zoom resets on the next opening. Navigating away closes the viewer.

## What the viewer preserves

The table remains selectable HTML, retaining captions, header relationships, image labels, publisher styling, and your current page theme where supported. It is an isolated copy of the table, not the surrounding chapter, so styling that depends on omitted neighboring content may differ.

Links are read-only, forms are disabled, and scripts, embedded browsing contexts, and active media are removed. Details disclosures remain usable with pointer or keyboard without changing the source table. Network access and navigation are blocked; unavailable resources are reported rather than fetched remotely.

Opening or zooming the viewer does not modify the original table, your reading layout, saved locations, or page count.

[Back to Reading tips](reading-tips.md#look-closer-at-images-and-tables) · [Back to the Ambra guide](README.md)
