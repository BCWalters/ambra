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

  it("reads the selection caret without depending on button focus", () => {
    const pre = source();
    const selection = document.getSelection()!;
    selection.addRange(sourceTextRange(pre, 12, 15)!);
    expect(sourceSelectionOffset(pre, selection)).toBe(15);
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    expect(sourceSelectionOffset(pre, selection)).toBe(15);
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
