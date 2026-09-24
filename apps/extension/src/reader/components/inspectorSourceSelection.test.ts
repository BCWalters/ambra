import { afterEach, describe, expect, it, vi } from "vitest";
import { moveSourceCaret, normalizeInspectorSourceText, sourceSelectionOffset, sourceTextRange } from "./inspectorSourceSelection.js";

afterEach(() => {
  document.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function source() {
  const pre = document.createElement("pre");
  pre.innerHTML = '<span>&lt;p <span>id="a"</span>&gt;</span>One &amp; two<span>&lt;/p&gt;</span>';
  document.body.append(pre);
  return pre;
}

describe("Inspector source DOM offsets", () => {
  it("normalizes formatted and raw CRLF or CR source before measuring DOM offsets", () => {
    expect(normalizeInspectorSourceText("<html>\r\n<body>\r<p>Text</p>\n</body>\r\n</html>"))
      .toBe("<html>\n<body>\n<p>Text</p>\n</body>\n</html>");
  });

  it("creates ranges across syntax spans using decoded source text offsets", () => {
    const pre = source();
    expect(sourceTextRange(pre, 0, 10)?.toString()).toBe('<p id="a">');
    expect(sourceTextRange(pre, 10, 19)?.toString()).toBe("One & two");
    expect(sourceTextRange(pre, 99, 100)).toBeUndefined();
  });

  it("anchors an opening-tag highlight to its tag, not the preceding indentation", () => {
    const pre = document.createElement("pre");
    pre.innerHTML = '  <span class="hljs-tag">&lt;p&gt;</span>Text';
    document.body.append(pre);
    const range = sourceTextRange(pre, 2, 5)!;
    expect(range.toString()).toBe("<p>");
    expect(range.startContainer.parentElement).toBe(pre.querySelector(".hljs-tag"));
    expect(sourceTextRange(pre, pre.textContent!.length, pre.textContent!.length)?.collapsed).toBe(true);
  });

  it("reads an inclusive selection offset without depending on button focus", () => {
    const pre = source();
    const selection = document.getSelection()!;
    selection.addRange(sourceTextRange(pre, 12, 15)!);
    expect(sourceSelectionOffset(pre, selection)).toBe(12);
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    expect(sourceSelectionOffset(pre, selection)).toBe(12);
  });

  it.each(["forward", "backward"] as const)("uses the same point inside a whole-element %s selection", (direction) => {
    const pre = source();
    const selection = document.getSelection()!;
    const range = sourceTextRange(pre, 0, pre.textContent!.length)!;
    if (direction === "forward") selection.addRange(range);
    else selection.setBaseAndExtent(range.endContainer, range.endOffset, range.startContainer, range.startOffset);
    expect(selection.toString()).toBe(pre.textContent);
    expect(sourceSelectionOffset(pre, selection)).toBe(0);
  });

  it.each([0, 12, 23])("preserves a collapsed caret at offset %i, including an exclusive element end", (offset) => {
    const pre = source();
    const selection = document.getSelection()!;
    selection.addRange(sourceTextRange(pre, offset, offset)!);
    expect(selection.isCollapsed).toBe(true);
    expect(sourceSelectionOffset(pre, selection)).toBe(offset);
  });

  it("ignores a selection outside the source", () => {
    const pre = source();
    const other = document.createElement("span");
    other.textContent = "outside";
    document.body.append(other);
    const range = document.createRange();
    range.selectNodeContents(other);
    document.getSelection()!.addRange(range);
    expect(sourceSelectionOffset(pre, document.getSelection())).toBeUndefined();
  });

  it.each(["forward", "backward"] as const)("ignores a %s selection crossing the source boundary", (direction) => {
    const pre = source();
    const other = document.createElement("span");
    other.textContent = "outside";
    document.body.append(other);
    const sourceNode = pre.querySelector("span")!.firstChild!;
    const outsideNode = other.firstChild!;
    const selection = document.getSelection()!;
    if (direction === "forward") selection.setBaseAndExtent(sourceNode, 0, outsideNode, 3);
    else selection.setBaseAndExtent(outsideNode, 3, sourceNode, 0);
    expect(sourceSelectionOffset(pre, selection)).toBeUndefined();
  });

  it("moves or extends the native caret without intercepting copy and Tab", () => {
    const pre = source();
    const selection = document.getSelection()!;
    const modify = vi.fn();
    Object.defineProperty(selection, "modify", { configurable: true, value: modify });
    expect(moveSourceCaret(pre, "ArrowRight", true, false)).toBe(true);
    expect(modify).toHaveBeenCalledWith("extend", "forward", "character");
    expect(sourceSelectionOffset(pre, selection)).toBe(0);
    expect(moveSourceCaret(pre, "ArrowDown", false, false)).toBe(true);
    expect(modify).toHaveBeenLastCalledWith("move", "forward", "line");
    expect(moveSourceCaret(pre, "Tab", false, false)).toBe(false);
    expect(moveSourceCaret(pre, "c", false, true)).toBe(false);
    Reflect.deleteProperty(selection, "modify");
  });
});
