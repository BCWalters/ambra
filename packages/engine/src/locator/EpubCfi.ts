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
 * character offset. Range CFIs (`,` start/end forms, used for annotations)
 * and multiple levels of indirection are out of scope for Wave 1 — see the
 * `cfi-test-suite` work item for where this is expected to grow.
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
}
