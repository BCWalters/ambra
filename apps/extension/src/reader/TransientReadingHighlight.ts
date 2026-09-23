import { applyNavigationTargetRange } from "./HighlightRenderer.js";

/** A short-lived destination spotlight, independent of search and saved annotations. */
export class TransientReadingHighlight {
  private document: Document | undefined;
  private timeout: ReturnType<typeof setTimeout> | undefined;

  public show(element: Element): void {
    this.clear();
    if (!element.textContent?.trim()) return;
    const document = element.ownerDocument;
    const range = document.createRange();
    range.selectNodeContents(element);
    this.document = document;
    applyNavigationTargetRange(document, range);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    this.timeout = setTimeout(() => this.clear(), 4000);
  }

  public clear(): void {
    clearTimeout(this.timeout);
    this.timeout = undefined;
    if (this.document) {
      applyNavigationTargetRange(this.document);
      this.document.removeEventListener("visibilitychange", this.onVisibilityChange);
      this.document = undefined;
    }
  }

  private readonly onVisibilityChange = (): void => {
    if (this.document?.hidden) this.clear();
  };
}
