import { describe, expect, it } from "vitest";
import { abbreviateMetadata, metadataPlainText, metadataTextSummary, METADATA_TEXT_LIMITS } from "./MetadataText.js";

describe("metadata display text", () => {
  it("strips markup, decodes entities, and keeps paragraph boundaries", () => {
    expect(metadataPlainText("<p>A <em>quiet</em> story &amp; a journey.</p><p>Second<br>line.</p>"))
      .toBe("A quiet story & a journey.\n\nSecond line.");
    expect(metadataPlainText("A &lt; B &gt; C &copy;")).toBe("A < B > C \u00a9");
  });

  it("does not include executable, style, frame, or template content", () => {
    expect(metadataPlainText('<p>Keep this.</p><script>not description</script><style>p{color:red}</style><iframe>ignore</iframe><template>ignore</template><img src="https://example.invalid/image">'))
      .toBe("Keep this.");
    expect(document.querySelector('img[src="https://example.invalid/image"]')).toBeNull();
  });

  it("normalizes plain-text paragraphs without merging them", () => {
    expect(metadataPlainText("  First line.\r\nWrapped line.\r\n\r\n Second paragraph.  "))
      .toBe("First line. Wrapped line.\n\nSecond paragraph.");
  });

  it("prefers whole paragraphs and marks omitted paragraphs explicitly", () => {
    const first = "First sentence. ".repeat(25).trim();
    const second = "Second paragraph. ".repeat(35).trim();
    const summary = metadataTextSummary(`${first}\n\n${second}\n\nThird paragraph.`, "description");
    expect(summary.preview).toBe(first + "\u2026");
    expect(summary.expanded).toBe(`${first}\n\n${second}\u2026`);
    expect(summary.expanded).not.toContain("Third paragraph.");
  });

  it("keeps short values and literal non-prose metadata intact", () => {
    expect(metadataTextSummary("A short description.", "description")).toEqual({
      preview: "A short description.", expanded: "A short description.",
    });
    expect(metadataTextSummary("ID:<value>&literal", "detail").preview).toBe("ID:<value>&literal");
  });

  it.each(["description", "rights", "identity", "detail"] as const)("bounds both %s states even for a single huge paragraph", kind => {
    const summary = metadataTextSummary("An extremely long statement. ".repeat(1000), kind);
    expect(summary.preview.length).toBeLessThanOrEqual(METADATA_TEXT_LIMITS[kind].preview);
    expect(summary.expanded.length).toBeLessThanOrEqual(METADATA_TEXT_LIMITS[kind].expanded);
    expect(summary.preview.endsWith("\u2026")).toBe(true);
    expect(summary.expanded.endsWith("\u2026")).toBe(true);
    expect(summary.expanded.length).toBeGreaterThan(summary.preview.length);
  });

  it("bounds unbroken CJK text without relying on word boundaries", () => {
    const summary = metadataTextSummary("\u5929\u5730\u7384\u9ec4".repeat(2000), "rights");
    expect(summary.preview.length).toBe(140);
    expect(summary.expanded.length).toBe(600);
  });

  it.each(["\ud83d\ude00", "e\u0301", "\ud83d\udc69\u200d\ud83d\udcbb"])("does not split graphemes %s", grapheme => {
    const result = abbreviateMetadata(grapheme.repeat(200), 140, 2);
    expect(result.length).toBeLessThanOrEqual(140);
    expect(result.slice(0, -1).endsWith(grapheme)).toBe(true);
  });

  it("uses a nearby sentence boundary, otherwise a word boundary", () => {
    expect(abbreviateMetadata("Word ".repeat(15) + "End. " + "Next ".repeat(20), 100, 2))
      .toBe("Word ".repeat(15) + "End.\u2026");
    expect(abbreviateMetadata("Word ".repeat(30), 100, 2)).toBe("Word ".repeat(19).trimEnd() + "\u2026");
  });
});
