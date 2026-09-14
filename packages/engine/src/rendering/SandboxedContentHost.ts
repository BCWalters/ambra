/** Thrown when the sandboxed content host fails to load a document (e.g.
 * the iframe's `error` event fires, or loading doesn't complete within the
 * timeout). */
export class RenderingSurfaceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "RenderingSurfaceError";
  }
}

const LOAD_TIMEOUT_MS = 10_000;

/**
 * Owns a single sandboxed `<iframe>` — the isolated host that untrusted
 * book content is rendered into, kept structurally separate from the
 * extension's own privileged context.
 *
 * Security posture (see the plan's "Security considerations" section):
 * - `sandbox="allow-same-origin"` — deliberately the *only* token granted.
 *   Scripting stays fully and unconditionally disabled (no `allow-scripts`,
 *   so book content can never execute script no matter what a malicious or
 *   malformed EPUB contains); forms, popups, top-level navigation, and
 *   pointer lock also remain blocked. `allow-same-origin` alone is safe —
 *   the dangerous combination security guidance warns about is
 *   `allow-scripts` *together with* `allow-same-origin` (which would let a
 *   script escape the sandbox using the trusted origin); granting only
 *   `allow-same-origin` is the standard, safe pattern for content that must
 *   remain readable/measurable by the parent frame's own trusted code
 *   (needed later for pagination's layout measurement and the
 *   accessibility layer's focus management) while still never being able
 *   to run a single line of script.
 * - Content is delivered via a `blob:` URL with an explicit
 *   `application/xhtml+xml` MIME type (never `srcdoc`, which is always
 *   HTML-parsed), so the browser applies strict XML parsing — matching
 *   the EPUB spec's requirement that content documents be well-formed
 *   XML, and avoiding any ambiguity from HTML-parsing XML-serialized
 *   markup (e.g. self-closing tag handling).
 * - Every resource the document references (images, fonts, stylesheets)
 *   is itself a `blob:` URL (see `ResourceUrlResolver`), so the frame
 *   never has occasion to reach the network at all; the CSP injected by
 *   `ContentDocumentAssembler` makes that a structural guarantee, not
 *   just an incidental one.
 */
export class SandboxedContentHost {
  private readonly iframeEl: HTMLIFrameElement;
  private currentContentUrl: string | undefined;

  public constructor(ownerDocument: Document = document) {
    this.iframeEl = ownerDocument.createElement("iframe");
    this.iframeEl.setAttribute("sandbox", "allow-same-origin");
    this.iframeEl.setAttribute("referrerpolicy", "no-referrer");
    // TODO(accessibility-layer): revisit this generic title once per-book/
    // per-chapter context is available (e.g. "<Book title> — <Chapter title>").
    this.iframeEl.setAttribute("title", "Book content");
    this.iframeEl.style.border = "none";
    this.iframeEl.style.width = "100%";
    this.iframeEl.style.height = "100%";
  }

  /** The iframe element itself, for the caller to attach into the visible
   * page (this class deliberately doesn't attach it automatically, since
   * where/when it becomes visible is a layout concern owned by the
   * reader shell, not this class). */
  public get element(): HTMLIFrameElement {
    return this.iframeEl;
  }

  /** Loads `assembledXhtml` (the output of `ContentDocumentAssembler.assemble`)
   * into the sandboxed iframe as a `blob:` URL, resolving once the iframe's
   * `load` event fires. Revokes the previous content's blob URL, if any —
   * each host displays one document at a time. */
  public async render(assembledXhtml: string): Promise<void> {
    const blob = new Blob([assembledXhtml], { type: "application/xhtml+xml" });
    const url = URL.createObjectURL(blob);
    const previousUrl = this.currentContentUrl;
    this.currentContentUrl = url;

    try {
      await this.loadUrl(url);
    } finally {
      if (previousUrl) {
        URL.revokeObjectURL(previousUrl);
      }
    }
  }

  private loadUrl(url: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new RenderingSurfaceError("Timed out loading content into the sandboxed iframe."));
      }, LOAD_TIMEOUT_MS);

      const onLoad = (): void => {
        cleanup();
        resolve();
      };
      const onError = (): void => {
        cleanup();
        reject(new RenderingSurfaceError("Failed to load content into the sandboxed iframe."));
      };
      const cleanup = (): void => {
        clearTimeout(timeoutId);
        this.iframeEl.removeEventListener("load", onLoad);
        this.iframeEl.removeEventListener("error", onError);
      };

      this.iframeEl.addEventListener("load", onLoad, { once: true });
      this.iframeEl.addEventListener("error", onError, { once: true });
      this.iframeEl.src = url;
    });
  }

  /** Revokes the current content's blob URL and removes the iframe from
   * the DOM (if attached). Call when this host is no longer needed. */
  public dispose(): void {
    if (this.currentContentUrl) {
      URL.revokeObjectURL(this.currentContentUrl);
      this.currentContentUrl = undefined;
    }
    this.iframeEl.remove();
  }
}
