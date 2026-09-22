import { resolveEpubPath, splitHrefFragment } from "../container/EpubPath.js";
import { getFirstChildElementByNS, getNamespacedAttribute } from "../container/Xml.js";
import { parseSmilClockValue } from "./SmilClockValue.js";

const SMIL_NAMESPACE = "http://www.w3.org/ns/SMIL";
const OPS_NAMESPACE = "http://www.idpf.org/2007/ops";

export class SmilParseError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SmilParseError";
  }
}

/** A `<text>` child's `src`, already resolved to an archive-relative path
 * plus its fragment (the content document element this clip narrates). */
export interface SmilTextRef {
  readonly path: string;
  readonly fragment: string | undefined;
}

/** A `<par>`'s optional `<audio>` child — absent when the `par` instead
 * relies on referencing embedded media by ID, or on text-to-speech (see
 * `SmilPar`'s own doc comment). `clipEndSeconds` is `undefined` only when
 * the audio element omits `clipEnd` entirely (play to the end of the
 * resource), which real files essentially never do but the spec permits. */
export interface SmilAudioClip {
  readonly path: string;
  readonly clipBeginSeconds: number;
  readonly clipEndSeconds: number | undefined;
}

/** The basic building block of a Media Overlay: one phrase's text
 * fragment, its narrating audio clip (if any), and the semantic
 * `epub:type` inflection, if the author supplied one (e.g.
 * `"footnote"`, used for skippability). */
export class SmilPar {
  public constructor(
    public readonly id: string | undefined,
    public readonly epubType: string | undefined,
    public readonly text: SmilTextRef,
    public readonly audio: SmilAudioClip | undefined,
  ) {}
}

/** A structural grouping of `par`/`seq` children (section, footnote,
 * figure, etc.) — `textref` names the corresponding EPUB Content
 * Document element so a Reading System can still place it even though
 * a `seq` itself carries no audio/text synchronization of its own. */
export class SmilSeq {
  public constructor(
    public readonly id: string | undefined,
    public readonly textref: SmilTextRef | undefined,
    public readonly epubType: string | undefined,
    public readonly children: readonly SmilNode[],
  ) {}
}

export type SmilNode = SmilSeq | SmilPar;

/**
 * A parsed EPUB3 Media Overlay Document (a constrained subset of SMIL
 * 3.0 — see the spec's own "Creating Media Overlays" section). `body`
 * is modeled as a `SmilSeq` with no `id`/`textref`/`epubType` of its own,
 * so callers always work with one uniform tree shape regardless of
 * whether the document's real `<body>` has one child or many.
 */
export class SmilDocument {
  public constructor(public readonly body: SmilSeq) {}

  public static parse(xml: string, smilPath: string): SmilDocument {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.getElementsByTagName("parsererror").length > 0) {
      throw new SmilParseError(`Malformed SMIL XML in "${smilPath}": not well-formed.`);
    }
    const smilEl = doc.documentElement;
    if (!smilEl || smilEl.localName !== "smil" || smilEl.namespaceURI !== SMIL_NAMESPACE) {
      throw new SmilParseError(
        `"${smilPath}" is not a well-formed SMIL document (missing <smil> root).`,
      );
    }
    const bodyEl = getFirstChildElementByNS(smilEl, SMIL_NAMESPACE, "body");
    if (!bodyEl) {
      throw new SmilParseError(`"${smilPath}" is missing its <body> element.`);
    }
    const children = parseSeqChildren(bodyEl, smilPath);
    return new SmilDocument(new SmilSeq(undefined, undefined, epubType(bodyEl), children));
  }

  /** Every `par` in the document, in document (playback) order — the
   * flat timeline `MediaOverlayPlayer` actually plays through. Skipping
   * `seq` nodes themselves is correct here: they carry no synchronized
   * content of their own, only structure. */
  public flattenPars(): SmilPar[] {
    const pars: SmilPar[] = [];
    const visit = (node: SmilNode): void => {
      if (node instanceof SmilPar) {
        pars.push(node);
      } else {
        for (const child of node.children) {
          visit(child);
        }
      }
    };
    for (const child of this.body.children) {
      visit(child);
    }
    return pars;
  }
}

function parseSeqChildren(parentEl: Element, smilPath: string): SmilNode[] {
  const nodes: SmilNode[] = [];
  for (const el of Array.from(parentEl.children)) {
    if (el.namespaceURI !== SMIL_NAMESPACE) {
      continue;
    }
    if (el.localName === "par") {
      nodes.push(parsePar(el, smilPath));
    } else if (el.localName === "seq") {
      nodes.push(parseSeq(el, smilPath));
    }
  }
  return nodes;
}

function parseSeq(seqEl: Element, smilPath: string): SmilSeq {
  const textrefAttr = getNamespacedAttribute(seqEl, OPS_NAMESPACE, "textref");
  return new SmilSeq(
    seqEl.getAttribute("id") ?? undefined,
    textrefAttr ? resolveTextRef(textrefAttr, smilPath) : undefined,
    epubType(seqEl),
    parseSeqChildren(seqEl, smilPath),
  );
}

function parsePar(parEl: Element, smilPath: string): SmilPar {
  const textEl = getFirstChildElementByNS(parEl, SMIL_NAMESPACE, "text");
  if (!textEl) {
    throw new SmilParseError(`A <par> in "${smilPath}" is missing its required <text> child.`);
  }
  const textSrc = textEl.getAttribute("src");
  if (!textSrc) {
    throw new SmilParseError(
      `A <text> element in "${smilPath}" is missing its required "src" attribute.`,
    );
  }

  const audioEl = getFirstChildElementByNS(parEl, SMIL_NAMESPACE, "audio");
  let audio: SmilAudioClip | undefined;
  if (audioEl) {
    const audioSrc = audioEl.getAttribute("src");
    if (!audioSrc) {
      throw new SmilParseError(
        `An <audio> element in "${smilPath}" is missing its required "src" attribute.`,
      );
    }
    const clipBeginAttr = audioEl.getAttribute("clipBegin");
    const clipEndAttr = audioEl.getAttribute("clipEnd");
    audio = {
      path: resolveEpubPath(smilPath, audioSrc),
      clipBeginSeconds: clipBeginAttr ? parseSmilClockValue(clipBeginAttr) : 0,
      clipEndSeconds: clipEndAttr ? parseSmilClockValue(clipEndAttr) : undefined,
    };
  }

  return new SmilPar(
    parEl.getAttribute("id") ?? undefined,
    epubType(parEl),
    resolveTextRef(textSrc, smilPath),
    audio,
  );
}

function resolveTextRef(href: string, smilPath: string): SmilTextRef {
  const { path, fragment } = splitHrefFragment(href);
  return { path: resolveEpubPath(smilPath, path), fragment };
}

function epubType(el: Element): string | undefined {
  return getNamespacedAttribute(el, OPS_NAMESPACE, "type") ?? undefined;
}
