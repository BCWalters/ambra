/** A single `/N[id]` step in a CFI path: a child-node index (see
 * `CfiTree.childStepIndex`) plus an optional XML ID assertion. */
export class CfiStep {
  public constructor(
    public readonly index: number,
    public readonly idAssertion?: string,
  ) {}

  public toString(): string {
    return `/${this.index}${this.idAssertion ? `[${this.idAssertion}]` : ""}`;
  }
}

/** Thrown when a string doesn't parse as a well-formed (point) EPUB CFI. */
export class EpubCfiParseError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "EpubCfiParseError";
  }
}

function parseSteps(segment: string, cfiString: string): CfiStep[] {
  if (segment === "") {
    return [];
  }

  const stepPattern = /\/(\d+)(?:\[([^\]]*)\])?/g;
  const steps: CfiStep[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = stepPattern.exec(segment))) {
    if (match.index !== lastIndex) {
      throw new EpubCfiParseError(`Malformed CFI step syntax in "${cfiString}".`);
    }
    // An id assertion may carry a trailing `;s=a`/`;s=b` side-bias
    // parameter (CFI §3.1.4); Wave 1 doesn't need side-bias for point
    // text locations, so only the id portion before any `;` is kept.
    const idAssertion = match[2]?.split(";")[0]?.trim() || undefined;
    steps.push(new CfiStep(Number(match[1]), idAssertion));
    lastIndex = stepPattern.lastIndex;
  }

  if (lastIndex !== segment.length) {
    throw new EpubCfiParseError(`Malformed CFI step syntax in "${cfiString}".`);
  }

  return steps;
}

/**
 * A parsed EPUB CFI (Canonical Fragment Identifier) — currently scoped to
 * **point** CFIs of the form `epubcfi(<packageSteps>!<contentSteps>[:offset])`:
 * a path through the OPF package document's `<spine>` to a specific
 * `itemref` (`packageSteps`), an indirection into that spine item's content
 * document, a path within it (`contentSteps`), and an optional trailing
 * character offset. Multiple levels of indirection are out of scope for
 * Wave 1 — see the `cfi-test-suite` work item for where this is expected
 * to grow. Range CFIs (`,` start/end forms) are supported only at the
 * string level, via `joinRange`/`parseRange` — for annotation export/
 * import interop (issues #107/#108), not for resolving a range directly
 * against a live DOM (every other call site in this app still stores and
 * resolves a highlight as two independent point CFIs — see `Highlight`'s
 * own doc comment for why that remains functionally equivalent here).
 */
export class EpubCfi {
  public constructor(
    public readonly packageSteps: readonly CfiStep[],
    public readonly contentSteps: readonly CfiStep[],
    public readonly characterOffset?: number,
  ) {}

  public toString(): string {
    const packagePart = this.packageSteps.map((step) => step.toString()).join("");
    const contentPart = this.contentSteps.map((step) => step.toString()).join("");
    const offsetPart = this.characterOffset !== undefined ? `:${this.characterOffset}` : "";
    return `epubcfi(${packagePart}!${contentPart}${offsetPart})`;
  }

  public static parse(cfiString: string): EpubCfi {
    const trimmed = cfiString.trim();
    const wrapperMatch = /^epubcfi\((.*)\)$/.exec(trimmed);
    if (!wrapperMatch) {
      throw new EpubCfiParseError(
        `Not a well-formed CFI (missing epubcfi(...) wrapper): "${cfiString}"`,
      );
    }

    const inner = wrapperMatch[1] as string;
    const indirectionIndex = inner.indexOf("!");
    if (indirectionIndex === -1) {
      throw new EpubCfiParseError(
        `CFI is missing the required "!" indirection into a content document: "${cfiString}"`,
      );
    }

    const packagePart = inner.slice(0, indirectionIndex);
    let contentPart = inner.slice(indirectionIndex + 1);

    let characterOffset: number | undefined;
    const offsetMatch = /:(\d+)$/.exec(contentPart);
    if (offsetMatch) {
      characterOffset = Number(offsetMatch[1]);
      contentPart = contentPart.slice(0, offsetMatch.index);
    }

    const packageSteps = parseSteps(packagePart, cfiString);
    const contentSteps = parseSteps(contentPart, cfiString);

    if (packageSteps.length === 0 || contentSteps.length === 0) {
      throw new EpubCfiParseError(`CFI is missing package or content steps: "${cfiString}"`);
    }

    return new EpubCfi(packageSteps, contentSteps, characterOffset);
  }

  /** Orders two CFI strings by book reading order — earlier spine item
   * first, then earlier position within that item, purely by comparing
   * their parsed step sequences (no live DOM resolution needed at all,
   * since sibling nodes are always numbered by document position — see
   * `CfiTree`'s own step-numbering rule — comparing step indices
   * lexicographically is exactly comparing document position). Returns a
   * negative number if `a` comes first, positive if `b` does, `0` if
   * they resolve to the exact same position. Used to sort bookmarks/
   * highlights by where they actually fall in the book (issue #49)
   * rather than by creation order. Throws `EpubCfiParseError` if either
   * string isn't a well-formed CFI — callers with potentially-stale/
   * corrupted stored CFIs should catch this themselves, the same way
   * every other CFI-resolving call site in the app already does. */
  public static compare(a: string, b: string): number {
    const cfiA = EpubCfi.parse(a);
    const cfiB = EpubCfi.parse(b);
    const packageComparison = EpubCfi.compareSteps(cfiA.packageSteps, cfiB.packageSteps);
    if (packageComparison !== 0) {
      return packageComparison;
    }
    const contentComparison = EpubCfi.compareSteps(cfiA.contentSteps, cfiB.contentSteps);
    if (contentComparison !== 0) {
      return contentComparison;
    }
    return (cfiA.characterOffset ?? 0) - (cfiB.characterOffset ?? 0);
  }

  /** Lexicographic comparison of two step sequences — the shared core of
   * `compare`, applied first to `packageSteps` (which spine item) and
   * then to `contentSteps` (position within it). A shorter sequence that
   * otherwise exactly matches a longer one's prefix sorts first (it names
   * an ancestor of the more specific position, i.e. an earlier point). */
  private static compareSteps(a: readonly CfiStep[], b: readonly CfiStep[]): number {
    const length = Math.min(a.length, b.length);
    for (let i = 0; i < length; i++) {
      const diff = a[i]!.index - b[i]!.index;
      if (diff !== 0) {
        return diff;
      }
    }
    return a.length - b.length;
  }

  /** Joins two point CFIs into a single canonical *range* CFI string
   * (spec §3.4: `epubcfi(common,startTail,endTail)`) — the form used
   * when exporting a highlight for interop (issue #107), since nothing
   * inside this app itself ever needed one before (see this class's own
   * doc comment). Both points must resolve to the same spine item
   * (`packageSteps` identical); a highlight never spans two. The
   * "common" prefix is the longest shared run of `contentSteps` — often
   * everything but the final text node, sometimes less — with each
   * point's own remaining steps (plus its own character offset) forming
   * its comma-separated tail. */
  public static joinRange(start: EpubCfi, end: EpubCfi): string {
    if (
      EpubCfi.compareSteps(start.packageSteps, end.packageSteps) !== 0 ||
      start.packageSteps.length !== end.packageSteps.length
    ) {
      throw new EpubCfiParseError("Cannot join a range CFI across two different spine items.");
    }
    let commonLength = 0;
    while (
      commonLength < start.contentSteps.length &&
      commonLength < end.contentSteps.length &&
      start.contentSteps[commonLength]!.index === end.contentSteps[commonLength]!.index &&
      start.contentSteps[commonLength]!.idAssertion === end.contentSteps[commonLength]!.idAssertion
    ) {
      commonLength++;
    }
    const packagePart = start.packageSteps.map((step) => step.toString()).join("");
    const commonPart = start.contentSteps
      .slice(0, commonLength)
      .map((step) => step.toString())
      .join("");
    const tailPart = (steps: readonly CfiStep[], offset: number | undefined): string =>
      steps
        .slice(commonLength)
        .map((step) => step.toString())
        .join("") + (offset !== undefined ? `:${offset}` : "");
    const startTail = tailPart(start.contentSteps, start.characterOffset);
    const endTail = tailPart(end.contentSteps, end.characterOffset);
    return `epubcfi(${packagePart}!${commonPart},${startTail},${endTail})`;
  }

  /** The inverse of `joinRange`: splits a range CFI string back into its
   * two point CFIs (used when importing an annotation file — issue
   * #108). Splits on the two *top-level* commas only (bracket-depth
   * aware, since an id assertion's own contents are never split on). */
  public static parseRange(cfiString: string): { start: EpubCfi; end: EpubCfi } {
    const trimmed = cfiString.trim();
    const wrapperMatch = /^epubcfi\((.*)\)$/.exec(trimmed);
    if (!wrapperMatch) {
      throw new EpubCfiParseError(
        `Not a well-formed CFI (missing epubcfi(...) wrapper): "${cfiString}"`,
      );
    }
    const parts = EpubCfi.splitTopLevelCommas(wrapperMatch[1] as string);
    if (parts.length !== 3) {
      throw new EpubCfiParseError(
        `Not a well-formed range CFI (expected 2 commas): "${cfiString}"`,
      );
    }
    const [common, startTail, endTail] = parts as [string, string, string];
    const indirectionIndex = common.indexOf("!");
    if (indirectionIndex === -1) {
      throw new EpubCfiParseError(
        `Range CFI is missing the required "!" indirection: "${cfiString}"`,
      );
    }
    const packagePart = common.slice(0, indirectionIndex);
    const commonContentPart = common.slice(indirectionIndex + 1);
    return {
      start: EpubCfi.parse(`epubcfi(${packagePart}!${commonContentPart}${startTail})`),
      end: EpubCfi.parse(`epubcfi(${packagePart}!${commonContentPart}${endTail})`),
    };
  }

  /** Splits on commas at bracket-depth 0 only, so a `[...]` id assertion
   * (which per spec may itself contain arbitrary characters) is never
   * mistaken for a range-CFI separator. */
  private static splitTopLevelCommas(segment: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let current = "";
    for (const char of segment) {
      if (char === "[") {
        depth++;
      } else if (char === "]") {
        depth--;
      }
      if (char === "," && depth === 0) {
        parts.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    parts.push(current);
    return parts;
  }
}
