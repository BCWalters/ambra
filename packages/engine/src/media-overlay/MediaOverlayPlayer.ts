import type { SmilAudioClip, SmilDocument, SmilPar } from "./SmilDocument.js";

/**
 * What `MediaOverlayPlayer` needs from an actual audio-playback surface
 * — deliberately the only place this whole module touches anything
 * resembling a live `<audio>` element, and even that only through this
 * abstract seam. A real implementation (a thin wrapper around an
 * `HTMLAudioElement`) is UI-layer wiring, out of scope for this engine
 * pass — see this file's own module doc comment.
 */
export interface MediaOverlayAudioHost {
  play(): void;
  pause(): void;
  /** Switches the underlying audio source, if not already playing
   * `path` — a no-op otherwise, since consecutive `par`s very commonly
   * share one audio file and re-setting the same source can introduce
   * an audible glitch or reset playback position needlessly. */
  setSource(path: string): void;
  seekTo(seconds: number): void;
  readonly currentSource: string | undefined;
  readonly currentTime: number;
}

/** One playable unit in the flattened timeline: a `SmilPar` plus its
 * index, so callers can move forward/backward without re-flattening the
 * document or re-searching for "where am I" on every step. */
export interface MediaOverlayClip {
  readonly index: number;
  readonly par: SmilPar;
}

export class MediaOverlayError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "MediaOverlayError";
  }
}

/**
 * Drives synchronized playback through one chapter's Media Overlay: the
 * flattened `par` timeline (see `SmilDocument.flattenPars`), which
 * `par` is currently active, and moving between them — playing an
 * audio clip, seeking to a specific text fragment (e.g. where the
 * reader's current reading position already is), and mapping a live
 * audio position back to the `par` it belongs to (for highlighting the
 * matching text once a real playback surface drives this).
 *
 * Framework/DOM-agnostic on purpose: takes a `MediaOverlayAudioHost`
 * rather than owning an `HTMLAudioElement` itself, so this class (the
 * actual sync/timeline logic) is fully unit-testable without a real
 * audio surface, and can be wired into `ReaderController` once the
 * reading UI for it is designed.
 */
export class MediaOverlayPlayer {
  private readonly clips: readonly SmilPar[];
  private index = 0;
  private playing = false;

  public constructor(
    document: SmilDocument,
    private readonly host: MediaOverlayAudioHost,
  ) {
    this.clips = document.flattenPars();
  }

  public get clipCount(): number {
    return this.clips.length;
  }

  public get currentClip(): MediaOverlayClip | undefined {
    const par = this.clips[this.index];
    return par ? { index: this.index, par } : undefined;
  }

  public get isPlaying(): boolean {
    return this.playing;
  }

  /** Shared cueing policy for asynchronous, publication-wide playback hosts.
   * Explicit passage/segment seeks restart the authored clip; ordinary resume
   * and contiguous transitions preserve an already in-range audio position. */
  public static cue(
    host: Pick<MediaOverlayAudioHost, "currentSource" | "currentTime" | "setSource" | "seekTo">,
    par: SmilPar,
    forceSeek = false,
  ): void {
    if (!par.audio) {
      throw new MediaOverlayError("This narration segment has no recorded audio; embedded media and text-to-speech overlays are not supported.");
    }
    const audio = par.audio;
    if (
      !Number.isFinite(audio.clipBeginSeconds) ||
      audio.clipBeginSeconds < 0 ||
      (audio.clipEndSeconds !== undefined &&
        (!Number.isFinite(audio.clipEndSeconds) || audio.clipEndSeconds <= audio.clipBeginSeconds))
    ) {
      throw new MediaOverlayError("This narration segment has an invalid audio clip range.");
    }
    if (!forceSeek && host.currentSource === audio.path && isWithinClip(audio, host.currentTime)) {
      return;
    }
    if (host.currentSource !== audio.path) {
      host.setSource(audio.path);
    }
    host.seekTo(audio.clipBeginSeconds);
  }

  /** Starts (or resumes) playback at the current clip, switching the
   * host's audio source/position only if it isn't already sitting on
   * this clip's own audio range. */
  public play(): void {
    const clip = this.currentClip;
    if (!clip) {
      return;
    }
    this.cueHostToClip(clip.par);
    this.host.play();
    this.playing = true;
  }

  public pause(): void {
    this.host.pause();
    this.playing = false;
  }

  /** Moves to and plays the next clip, if any. Returns `false` (leaving
   * playback exactly where it was) once the last clip has already been
   * reached — the caller decides what "end of chapter" should do next
   * (e.g. load the following spine item's own overlay, if any). */
  public next(): boolean {
    if (this.index >= this.clips.length - 1) {
      return false;
    }
    this.index++;
    if (this.playing) {
      this.play();
    }
    return true;
  }

  public previous(): boolean {
    if (this.index <= 0) {
      return false;
    }
    this.index--;
    if (this.playing) {
      this.play();
    }
    return true;
  }

  /** Jumps directly to the clip whose `<par id="...">` matches `parId`,
   * throwing if none does (a caller-side bug — a `parId` should always
   * come from this same document's own `clips`). */
  public goToParId(parId: string): void {
    const index = this.clips.findIndex((par) => par.id === parId);
    if (index === -1) {
      throw new MediaOverlayError(`No <par> with id "${parId}" in this Media Overlay.`);
    }
    this.index = index;
    if (this.playing) {
      this.play();
    }
  }

  /** Jumps to the clip whose `<text>` reference targets `fragment`
   * within `contentDocumentPath` — how playback picks up from wherever
   * the reader's current position already is, rather than always
   * restarting a chapter from its very first clip. Falls back to the
   * clip whose text fragment is `undefined` (targets the whole
   * document/element with no specific sub-fragment) if no exact
   * fragment match exists, then to the first clip in the document if
   * even that fails — better to start playback somewhere sensible than
   * not at all. */
  public goToTextFragment(contentDocumentPath: string, fragment: string | undefined): void {
    const exactIndex = this.clips.findIndex(
      (par) => par.text.path === contentDocumentPath && par.text.fragment === fragment,
    );
    if (exactIndex !== -1) {
      this.index = exactIndex;
    } else {
      const wholeDocumentIndex = this.clips.findIndex(
        (par) => par.text.path === contentDocumentPath,
      );
      this.index = wholeDocumentIndex !== -1 ? wholeDocumentIndex : 0;
    }
    if (this.playing) {
      this.play();
    }
  }

  /** Given the host's own current audio source/position (typically
   * read straight off its `timeupdate` event once wired to a real
   * element), returns the clip whose `clipBegin`/`clipEnd` range
   * contains it — the one the UI should be highlighting right now.
   * `undefined` if the position doesn't fall within any known clip
   * (e.g. a gap between two authored ranges, or audio the overlay
   * doesn't otherwise reference). Does not itself move `currentClip`;
   * callers that want playback to actually track this should call
   * `goToParId` with the result. */
  public clipForHostPosition(sourcePath: string, seconds: number): MediaOverlayClip | undefined {
    for (let i = 0; i < this.clips.length; i++) {
      const par = this.clips[i]!;
      if (!par.audio || par.audio.path !== sourcePath) {
        continue;
      }
      if (isWithinClip(par.audio, seconds)) {
        return { index: i, par };
      }
    }
    return undefined;
  }

  private cueHostToClip(par: SmilPar): void {
    MediaOverlayPlayer.cue(this.host, par);
  }
}

function isWithinClip(audio: SmilAudioClip, seconds: number): boolean {
  if (!Number.isFinite(seconds) || seconds < audio.clipBeginSeconds) {
    return false;
  }
  return audio.clipEndSeconds === undefined || seconds < audio.clipEndSeconds;
}
