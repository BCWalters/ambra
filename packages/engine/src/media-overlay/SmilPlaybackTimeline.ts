import { SmilPar } from "./SmilDocument.js";
import type { SmilDocument, SmilSeq } from "./SmilDocument.js";

export interface SmilSequenceRange {
  readonly sequence: SmilSeq;
  readonly firstIndex: number;
  readonly afterIndex: number;
}

export interface SmilPlaybackEntry {
  readonly index: number;
  readonly par: SmilPar;
  readonly ancestors: readonly SmilSequenceRange[];
  readonly semantics: readonly string[];
}

export interface SmilEscapeDestination {
  readonly structure: SmilPar | SmilSeq;
  /** The exclusive structure boundary; entries.length means the timeline ends. */
  readonly nextIndex: number;
}

export class SmilPlaybackTimeline {
  public readonly entries: readonly SmilPlaybackEntry[];

  public constructor(document: SmilDocument) {
    const entries: SmilPlaybackEntry[] = [];
    const visit = (
      sequence: SmilSeq, parents: readonly SmilSequenceRange[], inherited: readonly string[],
    ): void => {
      const range = { sequence, firstIndex: entries.length, afterIndex: entries.length };
      const ancestors = [...parents, range];
      const semantics = semanticTypes(inherited, sequence.epubType);
      for (const child of sequence.children) {
        if (child instanceof SmilPar) {
          entries.push({
            index: entries.length, par: child, ancestors,
            semantics: semanticTypes(semantics, child.epubType),
          });
        } else {
          visit(child, ancestors, semantics);
        }
      }
      range.afterIndex = entries.length;
    };
    visit(document.body, [], []);
    this.entries = entries;
  }

  public isSkipped(index: number, skippedTypes: ReadonlySet<string>): boolean {
    return this.entry(index).semantics.some(type => skippedTypes.has(type));
  }

  /** Searches inclusively. -1 and entries.length are terminal boundaries. */
  public findPlayableIndex(
    start: number, skippedTypes: ReadonlySet<string>, direction: 1 | -1 = 1,
  ): number | undefined {
    if (!Number.isInteger(start) || start < -1 || start > this.entries.length) {
      throw new RangeError("SMIL playback start must name a passage or a timeline boundary.");
    }
    if (direction !== 1 && direction !== -1) {
      throw new RangeError("SMIL playback direction must be 1 or -1.");
    }
    for (let index = start; index >= 0 && index < this.entries.length; index += direction) {
      if (!this.isSkipped(index, skippedTypes)) return index;
    }
    return undefined;
  }

  /** Escapes the innermost matching structure, not another node with the same ID. */
  public escapeAfter(index: number, escapableTypes: ReadonlySet<string>): SmilEscapeDestination | undefined {
    const entry = this.entry(index);
    if (matches(entry.par.epubType, escapableTypes)) {
      return { structure: entry.par, nextIndex: index + 1 };
    }
    for (let parent = entry.ancestors.length - 1; parent >= 0; parent--) {
      const range = entry.ancestors[parent]!;
      if (matches(range.sequence.epubType, escapableTypes)) {
        return { structure: range.sequence, nextIndex: range.afterIndex };
      }
    }
    return undefined;
  }

  private entry(index: number): SmilPlaybackEntry {
    const entry = this.entries[index];
    if (!Number.isInteger(index) || !entry) {
      throw new RangeError("SMIL playback index must name an existing passage.");
    }
    return entry;
  }
}

function semanticTypes(inherited: readonly string[], value: string | undefined): string[] {
  return [...new Set([...inherited, ...(value?.split(/[ \t\r\n]+/).filter(Boolean) ?? [])])];
}

function matches(value: string | undefined, types: ReadonlySet<string>): boolean {
  return semanticTypes([], value).some(type => types.has(type));
}
