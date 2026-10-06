import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AccessibilityMetadata, LocalizedMetadataValue } from "@ambra/engine";
import { BookAccessibilityRows } from "./BookAccessibilityRows.js";

const empty: AccessibilityMetadata = {
  accessModes: [],
  accessibilityFeatures: [],
  accessibilityHazards: [],
  accessibilitySummary: undefined,
  declarations: [],
};
function declaration(
  key: string,
  value: string,
  overrides: Partial<LocalizedMetadataValue> = {},
): LocalizedMetadataValue {
  return {
    key,
    value,
    language: "en",
    direction: "ltr",
    id: undefined,
    refines: undefined,
    preferred: false,
    ...overrides,
  };
}
function render(metadata: AccessibilityMetadata | undefined): HTMLDivElement {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(<BookAccessibilityRows metadata={metadata} />);
  return container;
}

describe("publisher accessibility declarations", () => {
  it("distinguishes assessed missing declarations from unavailable legacy stored metadata", () => {
    expect(render(empty).textContent).toContain("No accessibility claims were supplied");
    expect(render(undefined).textContent).toContain("not yet available for this stored copy");
    expect(render(empty).textContent).toContain(
      "does not establish whether the book is accessible",
    );
  });
  it("shows declared unknown hazards without treating them as missing or independently verified", () => {
    const content = render({
      ...empty,
      declarations: [declaration("schema:accessibilityHazard", "unknown")],
    });
    expect(content.textContent).toContain("Declared accessibility hazards");
    expect(content.textContent).toContain("unknown");
    expect(content.textContent).toContain("has not independently verified or certified");
    expect(content.textContent).not.toContain("No accessibility claims");
  });
  it("preserves compact repeated feature presentation without flattening sufficient alternatives", () => {
    const content = render({
      ...empty,
      declarations: [
        declaration("schema:accessibilityFeature", "alternativeText"),
        declaration("schema:accessibilityFeature", "readingOrder"),
        declaration("schema:accessModeSufficient", "textual"),
        declaration("schema:accessModeSufficient", "visual,textual"),
      ],
    });
    expect(content.textContent).toContain("alternativeText, readingOrder");
    expect([...content.querySelectorAll("p")].map((element) => element.textContent)).toContain(
      "visual,textual",
    );
  });
  it("keeps multilingual summaries, scoped credentials and unknown extensions without active URLs or markup", () => {
    const content = render({
      ...empty,
      declarations: [
        declaration("schema:accessibilitySummary", "Résumé", { language: "fr" }),
        declaration("schema:accessibilitySummary", "ملخص", { language: "ar", direction: "rtl" }),
        declaration("a11y:certifiedBy", "Original publisher", { id: "certifier" }),
        declaration("a11y:certifierCredential", "<img src=https://example.invalid>", {
          refines: "certifier",
        }),
        declaration("a11y:certifierReport", "javascript:void(0)"),
        declaration("a11y:certificationDate", "not-a-date"),
        declaration("a11y:contactEmail", "publisher@example.invalid"),
        declaration("a11y:futureClaim", "Retained extension"),
      ],
    });
    expect(content.querySelector('[lang="ar"][dir="rtl"]')?.textContent).toBe("ملخص");
    expect(content.querySelector('[lang="fr"]')?.textContent).toBe("Résumé");
    expect(content.querySelector("details")?.textContent).toContain(
      "Certifier credential (#certifier)",
    );
    expect(content.querySelector("details")?.textContent).toContain("Retained extension");
    expect(content.textContent).toContain("javascript:void(0)");
    expect(content.textContent).toContain("not-a-date");
    expect(content.querySelectorAll("a, img, iframe, script")).toHaveLength(0);
  });
});
