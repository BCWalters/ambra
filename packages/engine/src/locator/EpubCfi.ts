export interface CfiParameter {
  readonly name: string;
  readonly values: readonly string[];
}

export interface CfiTextAssertion {
  readonly preceding: string;
  readonly following?: string;
  readonly parameters: readonly CfiParameter[];
}

export interface CfiSpatialOffset {
  readonly x: number;
  readonly y: number;
}

export interface CfiMediaOffsets {
  readonly temporalOffsetSeconds?: number;
  readonly spatialOffset?: CfiSpatialOffset;
  readonly assertion?: CfiTextAssertion;
}

function escapeAssertion(value: string): string {
  return value.replace(/[\^[\](),;=]/g, "^$&");
}

function serializeParameters(parameters: readonly CfiParameter[]): string {
  return parameters.map(parameter =>
    `;${escapeAssertion(parameter.name)}=${parameter.values.map(escapeAssertion).join(",")}`,
  ).join("");
}

/** A single `/N[id]` step in a CFI path: a child-node index (see
 * `CfiTree.childStepIndex`) plus an optional XML ID assertion. */
export class CfiStep {
  public constructor(
    public readonly index: number,
    public readonly idAssertion?: string,
    public readonly parameters: readonly CfiParameter[] = [],
  ) {}

  public toString(): string {
    const assertion = escapeAssertion(this.idAssertion ?? "") + serializeParameters(this.parameters);
    return `/${this.index}${assertion ? `[${assertion}]` : ""}`;
  }
}

/** Thrown when a string doesn't parse as a well-formed (point) EPUB CFI. */
export class EpubCfiParseError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "EpubCfiParseError";
  }
}

const ESCAPABLE_CHARACTERS = new Set("^[](),;=");
const INTEGER_WITH_ASSERTION = /^(\d+)(?:\[((?:\^[\s\S]|[^[\]])*)\])?$/;
const NUMBER_WITH_ASSERTION = /^((?:0|[1-9]\d*)(?:\.\d*[1-9])?)(?:\[((?:\^[\s\S]|[^[\]])*)\])?$/;

function serializeNumber(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    throw new EpubCfiParseError("A CFI media offset must be a finite nonnegative number.");
  }
  const valueString = value.toString();
  if (!valueString.includes("e")) return valueString;
  const [mantissa = "", exponent = "0"] = valueString.split("e");
  const [whole = "", fraction = ""] = mantissa.split(".");
  const digits = whole + fraction;
  const point = whole.length + Number(exponent);
  if (point <= 0) return `0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length) return digits + "0".repeat(point - digits.length);
  return `${digits.slice(0, point)}.${digits.slice(point)}`;
}

function parseNumberWithAssertion(value: string, cfiString: string): {
  number: number; assertion?: CfiTextAssertion;
} {
  const match = NUMBER_WITH_ASSERTION.exec(value);
  const number = match ? Number(match[1]) : NaN;
  if (!match || !Number.isFinite(number) || serializeNumber(number) !== match[1]) {
    throw new EpubCfiParseError(`Invalid or unrepresentable CFI media offset in "${cfiString}".`);
  }
  return { number, assertion: match[2] === undefined ? undefined : parseOffsetAssertion(match[2], cfiString) };
}

function parseOffsetAssertion(value: string, cfiString: string): CfiTextAssertion {
  const assertion = parseAssertion(value, cfiString);
  const text = splitAssertion(assertion.value, ",");
  if (text.length > 2) {
    throw new EpubCfiParseError(`Malformed CFI offset assertion in "${cfiString}".`);
  }
  return {
    preceding: unescapeAssertion(text[0]!),
    following: text[1] === undefined ? undefined : unescapeAssertion(text[1]),
    parameters: assertion.parameters,
  };
}

function serializeOffsetAssertion(assertion: CfiTextAssertion | undefined): string {
  return assertion
    ? `[${escapeAssertion(assertion.preceding)}${
        assertion.following === undefined ? "" : `,${escapeAssertion(assertion.following)}`
      }${serializeParameters(assertion.parameters)}]`
    : "";
}

/** Structural delimiters only count outside assertions; an escaped bracket
 * is assertion data, not a change in nesting. Shared by point and range CFIs. */
function splitOutsideAssertions(segment: string, delimiter: string, cfiString: string): string[] {
  const parts: string[] = [];
  let inAssertion = false;
  let start = 0;
  for (let i = 0; i < segment.length; i++) {
    const char = segment[i]!;
    if (char === "^") {
      const escaped = segment[++i];
      if (!inAssertion || escaped === undefined || !ESCAPABLE_CHARACTERS.has(escaped)) {
        throw new EpubCfiParseError(`Malformed CFI escape in "${cfiString}".`);
      }
    } else if (char === "[") {
      if (inAssertion) {
        throw new EpubCfiParseError(`Malformed CFI assertion in "${cfiString}".`);
      }
      inAssertion = true;
    } else if (char === "]") {
      if (!inAssertion) {
        throw new EpubCfiParseError(`Malformed CFI assertion in "${cfiString}".`);
      }
      inAssertion = false;
    } else if (char === delimiter && !inAssertion) {
      parts.push(segment.slice(start, i));
      start = i + 1;
    }
  }
  if (inAssertion) {
    throw new EpubCfiParseError(`Unterminated CFI assertion in "${cfiString}".`);
  }
  parts.push(segment.slice(start));
  return parts;
}

function splitAssertion(value: string, delimiter: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "^") i++;
    else if (value[i] === delimiter) {
      parts.push(value.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function unescapeAssertion(value: string): string {
  return value.replace(/\^([\^[\](),;=])/g, "$1");
}

function parseAssertion(assertion: string, cfiString: string): {
  value: string;
  parameters: readonly CfiParameter[];
} {
  const [value = "", ...parts] = splitAssertion(assertion, ";");
  const parameters = parts.map(part => {
    const pair = splitAssertion(part, "=");
    if (pair.length !== 2 || !pair[0] || !pair[1]) {
      throw new EpubCfiParseError(`Malformed CFI parameter in "${cfiString}".`);
    }
    return {
      name: unescapeAssertion(pair[0]),
      values: splitAssertion(pair[1], ",").map(unescapeAssertion),
    };
  });
  const biases = parameters.filter(parameter => parameter.name === "s");
  if (biases.length > 1 || biases.some(parameter =>
    parameter.values.length !== 1 || !["a", "b"].includes(parameter.values[0]!),
  )) {
    throw new EpubCfiParseError(`Invalid CFI side bias in "${cfiString}".`);
  }
  return { value, parameters };
}

function parseInteger(value: string, cfiString: string): number {
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number)) {
    throw new EpubCfiParseError(`Invalid CFI integer in "${cfiString}".`);
  }
  return number;
}

function parseSteps(segment: string, cfiString: string): CfiStep[] {
  if (segment === "") {
    return [];
  }
  const [prefix, ...parts] = splitOutsideAssertions(segment, "/", cfiString);
  if (prefix !== "") {
    throw new EpubCfiParseError(`Malformed CFI step syntax in "${cfiString}".`);
  }
  return parts.map((part) => {
    const match = INTEGER_WITH_ASSERTION.exec(part);
    if (!match) {
      throw new EpubCfiParseError(`Malformed CFI step syntax in "${cfiString}".`);
    }
    const assertion = parseAssertion(match[2] ?? "", cfiString);
    return new CfiStep(
      parseInteger(match[1]!, cfiString),
      unescapeAssertion(assertion.value).trim() || undefined,
      assertion.parameters,
    );
  });
}

/**
 * A parsed EPUB CFI (Canonical Fragment Identifier) — currently scoped to
 * **point** CFIs of the form `epubcfi(<packageSteps>!<contentSteps>[:offset])`:
 * a path through the OPF package document's `<spine>` to a specific
 * `itemref` (`packageSteps`), an indirection into that spine item's content
 * document, a path within it (`contentSteps`), and an optional trailing
 * character or temporal/spatial offset with assertions and parameters.
 * Multiple indirections remain outside this profile.
 * Range CFIs (`,` start/end forms) use `joinRange`/`parseRange`, with direct
 * DOM resolution provided by `LocatorResolver`.
 * A package-only path addresses the spine itemref itself, representing
 * the whole content document without inventing an empty indirection.
 */
export class EpubCfi {
  public constructor(
    public readonly packageSteps: readonly CfiStep[],
    public readonly contentSteps: readonly CfiStep[],
    public readonly characterOffset?: number,
    public readonly textAssertion?: CfiTextAssertion,
    public readonly mediaOffsets?: CfiMediaOffsets,
  ) {}

  public get sideBias(): "a" | "b" | undefined {
    if (this.mediaOffsets?.spatialOffset) return undefined;
    const parameters = this.textAssertion?.parameters ?? this.mediaOffsets?.assertion?.parameters ??
      this.contentSteps.at(-1)?.parameters;
    const value = parameters?.find(parameter => parameter.name === "s")?.values[0];
    return value === "a" || value === "b" ? value : undefined;
  }

  private offsetSuffix(): string {
    if (this.mediaOffsets) {
      if (this.characterOffset !== undefined || this.textAssertion !== undefined) {
        throw new EpubCfiParseError("Character and media offsets cannot be combined.");
      }
      const { temporalOffsetSeconds, spatialOffset, assertion } = this.mediaOffsets;
      if (temporalOffsetSeconds === undefined && spatialOffset === undefined) {
        throw new EpubCfiParseError("A media offset requires a temporal or spatial position.");
      }
      if (spatialOffset && (spatialOffset.x > 100 || spatialOffset.y > 100)) {
        throw new EpubCfiParseError("CFI spatial coordinates must be between 0 and 100.");
      }
      const temporal = temporalOffsetSeconds === undefined ? "" : `~${serializeNumber(temporalOffsetSeconds)}`;
      const spatial = spatialOffset
        ? `@${serializeNumber(spatialOffset.x)}:${serializeNumber(spatialOffset.y)}` : "";
      return temporal + spatial + serializeOffsetAssertion(assertion);
    }
    if (this.textAssertion && this.characterOffset === undefined) {
      throw new EpubCfiParseError("A text assertion requires a character offset.");
    }
    if (this.characterOffset === undefined) return "";
    return `:${this.characterOffset}${serializeOffsetAssertion(this.textAssertion)}`;
  }

  public toString(): string {
    const packagePart = this.packageSteps.map((step) => step.toString()).join("");
    if (this.contentSteps.length === 0 && this.mediaOffsets === undefined) {
      if (this.characterOffset !== undefined || this.textAssertion !== undefined) {
        throw new EpubCfiParseError("A spine itemref location cannot have a character offset.");
      }
      return `epubcfi(${packagePart})`;
    }
    const contentPart = this.contentSteps.map((step) => step.toString()).join("");
    const offsetPart = this.offsetSuffix();
    return `epubcfi(${packagePart}!${contentPart}${offsetPart})`;
  }

  public static parse(cfiString: string): EpubCfi {
    const trimmed = cfiString.trim();
    const wrapperMatch = /^epubcfi\(([\s\S]*)\)$/.exec(trimmed);
    if (!wrapperMatch) {
      throw new EpubCfiParseError(
        `Not a well-formed CFI (missing epubcfi(...) wrapper): "${cfiString}"`,
      );
    }

    const inner = wrapperMatch[1] as string;
    const indirectParts = splitOutsideAssertions(inner, "!", cfiString);
    if (indirectParts.length === 1) {
      const packageSteps = parseSteps(inner, cfiString);
      if (packageSteps.length === 0) {
        throw new EpubCfiParseError(`CFI is missing package steps: "${cfiString}"`);
      }
      return new EpubCfi(packageSteps, []);
    }
    if (indirectParts.length !== 2) {
      throw new EpubCfiParseError(
        `CFI requires a single "!" indirection into a content document: "${cfiString}"`,
      );
    }

    const [packagePart, contentWithOffset] = indirectParts as [string, string];
    const temporalParts = splitOutsideAssertions(contentWithOffset, "~", cfiString);
    const spatialParts = splitOutsideAssertions(temporalParts[1] ?? contentWithOffset, "@", cfiString);
    if (temporalParts.length > 2 || spatialParts.length > 2) {
      throw new EpubCfiParseError(`Malformed CFI media offset in "${cfiString}".`);
    }
    if (temporalParts.length === 2 || spatialParts.length === 2) {
      const contentPart = temporalParts.length === 2 ? temporalParts[0]! : spatialParts[0]!;
      const temporal = temporalParts.length === 2
        ? parseNumberWithAssertion(spatialParts[0]!, cfiString) : undefined;
      let spatialOffset: CfiSpatialOffset | undefined;
      let assertion = temporal?.assertion;
      if (spatialParts.length === 2) {
        if (assertion) {
          throw new EpubCfiParseError(`An assertion must follow the complete media offset in "${cfiString}".`);
        }
        const coordinates = splitOutsideAssertions(spatialParts[1]!, ":", cfiString);
        if (coordinates.length !== 2) {
          throw new EpubCfiParseError(`Malformed CFI spatial offset in "${cfiString}".`);
        }
        const x = parseNumberWithAssertion(coordinates[0]!, cfiString);
        const y = parseNumberWithAssertion(coordinates[1]!, cfiString);
        if (x.assertion || x.number > 100 || y.number > 100) {
          throw new EpubCfiParseError(`Invalid CFI spatial coordinates in "${cfiString}".`);
        }
        spatialOffset = { x: x.number, y: y.number };
        assertion = y.assertion;
      }
      const packageSteps = parseSteps(packagePart, cfiString);
      if (!packageSteps.length) throw new EpubCfiParseError(`CFI is missing package steps: "${cfiString}".`);
      return new EpubCfi(packageSteps, parseSteps(contentPart, cfiString), undefined, undefined, {
        temporalOffsetSeconds: temporal?.number, spatialOffset, assertion,
      });
    }
    const offsetParts = splitOutsideAssertions(contentWithOffset, ":", cfiString);
    if (offsetParts.length > 2) {
      throw new EpubCfiParseError(`Malformed CFI character offset in "${cfiString}".`);
    }
    const contentPart = offsetParts[0]!;
    let characterOffset: number | undefined;
    let textAssertion: CfiTextAssertion | undefined;
    if (offsetParts[1] !== undefined) {
      const match = INTEGER_WITH_ASSERTION.exec(offsetParts[1]);
      if (!match) throw new EpubCfiParseError(`Malformed CFI character offset in "${cfiString}".`);
      characterOffset = parseInteger(match[1]!, cfiString);
      if (match[2] !== undefined) {
        textAssertion = parseOffsetAssertion(match[2], cfiString);
      }
    }

    const packageSteps = parseSteps(packagePart, cfiString);
    const contentSteps = parseSteps(contentPart, cfiString);

    if (packageSteps.length === 0 || contentSteps.length === 0) {
      throw new EpubCfiParseError(`CFI is missing package or content steps: "${cfiString}"`);
    }

    return new EpubCfi(packageSteps, contentSteps, characterOffset, textAssertion);
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
      if (cfiA.contentSteps.length !== cfiB.contentSteps.length) {
        const shorter = cfiA.contentSteps.length < cfiB.contentSteps.length ? cfiA : cfiB;
        const longer = shorter === cfiA ? cfiB : cfiA;
        if (EpubCfi.compareSteps(shorter.contentSteps, longer.contentSteps.slice(0, shorter.contentSteps.length)) === 0 &&
          shorter.mediaOffsets) {
          // A temporal-spatial step sorts after a child step, even on its ancestor.
          return shorter === cfiA ? 1 : -1;
        }
      }
      return contentComparison;
    }
    if (cfiA.mediaOffsets || cfiB.mediaOffsets) {
      const first = cfiA.mediaOffsets;
      const second = cfiB.mediaOffsets;
      if (!first || !second) return first ? 1 : -1;
      return (first.temporalOffsetSeconds ?? -1) - (second.temporalOffsetSeconds ?? -1) ||
        (first.spatialOffset?.y ?? -1) - (second.spatialOffset?.y ?? -1) ||
        (first.spatialOffset?.x ?? -1) - (second.spatialOffset?.x ?? -1);
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
    if ((start.contentSteps.length === 0 && !start.mediaOffsets) ||
      (end.contentSteps.length === 0 && !end.mediaOffsets)) {
      throw new EpubCfiParseError("Range endpoints must address positions within content documents.");
    }
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
      start.contentSteps[commonLength]!.toString() === end.contentSteps[commonLength]!.toString() &&
      !start.contentSteps[commonLength]!.parameters.some(parameter => parameter.name === "s")
    ) {
      commonLength++;
    }
    const packagePart = start.packageSteps.map((step) => step.toString()).join("");
    const commonPart = start.contentSteps
      .slice(0, commonLength)
      .map((step) => step.toString())
      .join("");
    const tailPart = (point: EpubCfi): string =>
      point.contentSteps
        .slice(commonLength)
        .map((step) => step.toString())
        .join("") + point.offsetSuffix();
    const startTail = tailPart(start);
    const endTail = tailPart(end);
    if (commonLength === 0) {
      return `epubcfi(${packagePart},!${startTail},!${endTail})`;
    }
    return `epubcfi(${packagePart}!${commonPart},${startTail},${endTail})`;
  }

  /** The inverse of `joinRange`: splits a range CFI string back into its
   * two point CFIs (used when importing an annotation file — issue
   * #108). Splits on the two *top-level* commas only (bracket-depth
   * aware, since an id assertion's own contents are never split on). */
  public static parseRange(cfiString: string): { start: EpubCfi; end: EpubCfi } {
    const trimmed = cfiString.trim();
    const wrapperMatch = /^epubcfi\(([\s\S]*)\)$/.exec(trimmed);
    if (!wrapperMatch) {
      throw new EpubCfiParseError(
        `Not a well-formed CFI (missing epubcfi(...) wrapper): "${cfiString}"`,
      );
    }
    const parts = splitOutsideAssertions(wrapperMatch[1] as string, ",", cfiString);
    if (parts.length !== 3) {
      throw new EpubCfiParseError(
        `Not a well-formed range CFI (expected 2 commas): "${cfiString}"`,
      );
    }
    const [common, startTail, endTail] = parts as [string, string, string];
    const commonParts = splitOutsideAssertions(common, "!", cfiString);
    if (commonParts.length === 1 && startTail.startsWith("!") && endTail.startsWith("!")) {
      return {
        start: EpubCfi.parse(`epubcfi(${common}${startTail})`),
        end: EpubCfi.parse(`epubcfi(${common}${endTail})`),
      };
    }
    if (commonParts.length !== 2) {
      throw new EpubCfiParseError(
        `Range CFI requires a single "!" indirection: "${cfiString}"`,
      );
    }
    const [packagePart, commonContentPart] = commonParts as [string, string];
    return {
      start: EpubCfi.parse(`epubcfi(${packagePart}!${commonContentPart}${startTail})`),
      end: EpubCfi.parse(`epubcfi(${packagePart}!${commonContentPart}${endTail})`),
    };
  }
}
