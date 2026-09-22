interface DisclosureDocument {
  readonly spineIndex: number;
  readonly document: Document;
}

/** Session-local native disclosure state, shared by visible pages and measurement
 * hosts. Ordinals are stable because every host loads the same authored document. */
export class DisclosureState {
  private readonly states = new Map<number, readonly boolean[]>();
  private readonly documents = new Set<DisclosureDocument>();

  public constructor(
    private readonly onChange: (spineIndex: number, source: Document) => void = () => {},
  ) {}

  /** Restore before measuring, then observe native toggles for this host's lifetime. */
  public attach(spineIndex: number, document: Document): () => void {
    const details = Array.from(document.querySelectorAll("details"));
    const saved = this.states.get(spineIndex);
    if (saved) {
      this.restore(document, saved);
    } else {
      this.states.set(
        spineIndex,
        details.map((detail) => detail.open),
      );
    }
    const entry = { spineIndex, document };
    this.documents.add(entry);
    const handleToggle = (event: Event): void => {
      if (!details.some((detail) => detail === event.target)) {
        return;
      }
      const next = details.map((detail) => detail.open);
      const previous = this.states.get(spineIndex);
      if (previous?.every((open, index) => open === next[index])) {
        return;
      }
      this.states.set(spineIndex, next);
      for (const binding of this.documents) {
        if (binding.spineIndex === spineIndex && binding.document !== document) {
          this.restore(binding.document, next);
        }
      }
      this.onChange(spineIndex, document);
    };
    // Native toggle does not bubble.
    document.addEventListener("toggle", handleToggle, true);
    return () => {
      document.removeEventListener("toggle", handleToggle, true);
      this.documents.delete(entry);
    };
  }

  private restore(document: Document, states: readonly boolean[]): void {
    document.querySelectorAll("details").forEach((detail, index) => {
      const open = states[index];
      if (open !== undefined && detail.open !== open) {
        detail.open = open;
      }
    });
  }
}
