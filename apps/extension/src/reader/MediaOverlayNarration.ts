import { MediaOverlayPlayer, SmilDocument } from "@ambra/engine";
import type { ContentLoader, PackageDocument, SmilPar } from "@ambra/engine";

export interface NarrationTarget {
  spineIndex: number;
  path: string;
  fragment?: string;
}

export interface NarrationState {
  available: boolean;
  status: "idle" | "loading" | "playing" | "paused" | "ended" | "error";
  following: boolean;
  rate: number;
  hasPrevious: boolean;
  hasNext: boolean;
  hasTarget: boolean;
  error?: string;
}

export type NarrationAudio = Pick<
  HTMLAudioElement,
  | "src" | "currentTime" | "duration" | "playbackRate" | "readyState" | "paused"
  | "error" | "play" | "pause" | "load" | "removeAttribute"
  | "addEventListener" | "removeEventListener"
>;

export interface MediaOverlayNarrationContext {
  pkg: PackageDocument;
  loader: ContentLoader;
  onTarget: (target: NarrationTarget, follow: boolean) => Promise<void>;
  notify: () => void;
  audio?: NarrationAudio;
}

interface Cursor {
  association: number;
  index: number;
  clips: readonly SmilPar[];
}

/** Owns recorded narration only. Rendering, active-class styling and navigation
 * remain with the reader; original publication elements are used only for seeking. */
export class MediaOverlayNarration {
  private readonly audio: NarrationAudio;
  private readonly ownedAudio: HTMLAudioElement | undefined;
  private readonly associations: number[];
  private readonly documents = new Map<string, Promise<readonly SmilPar[]>>();
  private cursor: Cursor | undefined;
  private status: NarrationState["status"] = "idle";
  private following = true;
  private rate = 1;
  private error: string | undefined;
  private generation = 0;
  private playGeneration = -1;
  private needsSeek = false;
  private requestedPassage: { spineIndex: number; element?: Element } | undefined;
  private disposed = false;
  private source: string | undefined;
  private sourceUrl: string | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private cancelMetadata: (() => void) | undefined;
  private nextCursor: Cursor | undefined;
  private nextReady = false;
  private nextFailure: unknown;
  private readonly onTime = (): void => this.checkBoundary();
  private readonly onPlaying = (): void => this.scheduleBoundary();
  private readonly onWaiting = (): void => this.clearTimer();
  private readonly onEnded = (): void => {
    if (this.status !== "playing") return;
    const end = this.par?.audio?.clipEndSeconds;
    if (end !== undefined && this.audio.currentTime + 0.05 < end) {
      this.fail(new Error("The narration audio ended before its authored clip boundary."));
      return;
    }
    this.advanceAutomatically();
  };
  private readonly onError = (): void => {
    if (!this.source || this.disposed) return;
    this.fail(new Error(`Unable to play narration audio "${this.source}"${this.audio.error?.message ? `: ${this.audio.error.message}` : "."}`));
  };

  public constructor(private readonly ctx: MediaOverlayNarrationContext) {
    if (!ctx.audio) {
      this.ownedAudio = new Audio();
      this.ownedAudio.hidden = true;
      this.ownedAudio.setAttribute("data-ambra-narration-audio", "");
      (document.body ?? document.documentElement).append(this.ownedAudio);
    }
    this.audio = ctx.audio ?? this.ownedAudio!;
    this.associations = ctx.pkg.spine.flatMap((ref, index) =>
      ref.manifestItem.mediaOverlayId ? [index] : [],
    );
    this.audio.addEventListener("timeupdate", this.onTime);
    this.audio.addEventListener("playing", this.onPlaying);
    this.audio.addEventListener("waiting", this.onWaiting);
    this.audio.addEventListener("ended", this.onEnded);
    this.audio.addEventListener("error", this.onError);
  }

  public get snapshot(): NarrationState {
    return {
      available: this.associations.length > 0,
      status: this.status,
      following: this.following,
      rate: this.rate,
      hasTarget: this.target !== undefined,
      hasPrevious: !!this.cursor && (this.cursor.index > 0 || this.cursor.association > 0),
      hasNext: !!this.cursor && (
        this.cursor.index < this.cursor.clips.length - 1 ||
        this.cursor.association < this.associations.length - 1
      ),
      ...(this.error ? { error: this.error } : {}),
    };
  }

  public get target(): NarrationTarget | undefined {
    if (!this.cursor || !this.par) return undefined;
    return {
      spineIndex: this.associations[this.cursor.association]!,
      path: this.par.text.path,
      ...(this.par.text.fragment !== undefined ? { fragment: decodeFragment(this.par.text.fragment) } : {}),
    };
  }

  private get par(): SmilPar | undefined {
    return this.cursor?.clips[this.cursor.index];
  }

  public async playFrom(spineIndex: number, element?: Element): Promise<void> {
    await this.seekPassage(spineIndex, element, true);
  }

  private async seekPassage(spineIndex: number, element: Element | undefined, following: boolean): Promise<void> {
    if (this.disposed) return;
    this.requestedPassage = { spineIndex, element };
    const generation = this.begin();
    this.following = following;
    this.notify();
    try {
      if (!this.ctx.pkg.spine[spineIndex]) throw new Error("This reading position is outside the publication.");
      const exactAssociation = this.associations.indexOf(spineIndex);
      const association = exactAssociation >= 0 ? exactAssociation : this.associations.findIndex(
        (index) => index > spineIndex && this.ctx.pkg.spine[index]!.linear,
      );
      if (association < 0) throw new Error("There is no recorded narration at or after this passage.");
      const clips = await this.loadClips(association);
      if (!this.current(generation)) return;
      const index = element && exactAssociation >= 0 ? findPassage(clips, element) : 0;
      if (index < 0 || !clips[index]) {
        throw new Error("There is no recorded narration for this passage.");
      }
      await this.start({ association, index, clips }, generation, true);
    } catch (error) {
      if (this.current(generation)) this.fail(error);
    }
  }

  public async resume(): Promise<void> {
    if (this.disposed) return;
    if (this.requestedPassage) {
      await this.seekPassage(this.requestedPassage.spineIndex, this.requestedPassage.element, this.following);
      return;
    }
    if (!this.cursor) {
      this.fail(new Error("Choose a narrated passage with Listen from here first."));
      return;
    }
    if (this.status === "playing") {
      await this.publishTarget(this.generation);
      return;
    }
    const restart = this.status === "ended" || this.needsSeek;
    const generation = this.begin();
    try {
      await this.start(this.cursor, generation, restart);
    } catch (error) {
      if (this.current(generation)) this.fail(error);
    }
  }

  public pause(): void {
    if (this.disposed) return;
    this.invalidate();
    this.audio.pause();
    this.status = "paused";
    this.notify();
  }

  public async next(): Promise<void> {
    await this.move(1);
  }

  public async previous(): Promise<void> {
    await this.move(-1);
  }

  public setRate(rate: number): void {
    if (this.disposed) return;
    if (!Number.isFinite(rate) || rate < 0.5 || rate > 3) {
      this.fail(new Error("Narration speed must be between 0.5 and 3."));
      return;
    }
    try {
      this.audio.playbackRate = rate;
      this.rate = rate;
      this.scheduleBoundary();
      this.notify();
    } catch (error) {
      this.fail(error);
    }
  }

  public suspendFollowing(): void {
    if (this.disposed || !this.following) return;
    this.following = false;
    this.notify();
  }

  public async returnToNarration(): Promise<void> {
    if (this.disposed) return;
    this.following = true;
    this.notify();
    await this.publishTarget(this.generation);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.invalidate();
    this.audio.removeEventListener("timeupdate", this.onTime);
    this.audio.removeEventListener("playing", this.onPlaying);
    this.audio.removeEventListener("waiting", this.onWaiting);
    this.audio.removeEventListener("ended", this.onEnded);
    this.audio.removeEventListener("error", this.onError);
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
    this.ownedAudio?.remove();
    if (this.sourceUrl) URL.revokeObjectURL(this.sourceUrl);
    this.sourceUrl = undefined;
    this.source = undefined;
    this.cursor = undefined;
    this.nextCursor = undefined;
    this.requestedPassage = undefined;
    this.status = "idle";
    this.documents.clear();
  }

  private async loadClips(association: number): Promise<readonly SmilPar[]> {
    const item = this.ctx.pkg.spine[this.associations[association]!]!.manifestItem;
    const overlay = this.ctx.pkg.findMediaOverlay(item);
    if (!overlay || overlay.mediaType !== "application/smil+xml") {
      throw new Error(`The narration document for "${item.path}" is missing or is not SMIL.`);
    }
    let document = this.documents.get(overlay.path);
    if (!document) {
      document = this.ctx.loader.readArchiveFileText(overlay.path)
        .then((xml) => SmilDocument.parse(xml, overlay.path).flattenPars());
      this.documents.set(overlay.path, document);
      void document.catch(() => {
        if (this.documents.get(overlay.path) === document) this.documents.delete(overlay.path);
      });
    }
    return (await document).filter((par) => par.text.path === item.path);
  }

  private async neighbor(cursor: Cursor, direction: 1 | -1): Promise<Cursor | undefined> {
    const index = cursor.index + direction;
    if (index >= 0 && index < cursor.clips.length) return { ...cursor, index };
    for (
      let association = cursor.association + direction;
      association >= 0 && association < this.associations.length;
      association += direction
    ) {
      const clips = await this.loadClips(association);
      if (this.disposed) return undefined;
      if (clips.length) return { association, clips, index: direction === 1 ? 0 : clips.length - 1 };
    }
    return undefined;
  }

  private async move(direction: 1 | -1): Promise<void> {
    if (this.disposed || !this.cursor) return;
    if (direction === 1 ? !this.snapshot.hasNext : !this.snapshot.hasPrevious) return;
    const cursor = this.cursor;
    const shouldPlay = this.status === "playing" || this.status === "loading";
    const generation = this.begin();
    try {
      const next = await this.neighbor(cursor, direction);
      if (!this.current(generation)) return;
      if (!next) {
        if (shouldPlay) await this.start(cursor, generation, false);
        else { this.status = "paused"; this.notify(); }
        return;
      }
      if (shouldPlay) await this.start(next, generation, true);
      else {
        this.setCursor(next);
        this.needsSeek = true;
        this.status = "paused";
        this.notify();
        await this.publishTarget(generation);
      }
    } catch (error) {
      if (this.current(generation)) this.fail(error);
    }
  }

  private begin(): number {
    this.invalidate();
    this.audio.pause();
    this.status = "loading";
    this.error = undefined;
    this.notify();
    return this.generation;
  }

  private invalidate(): void {
    this.generation++;
    this.clearTimer();
    this.cancelMetadata?.();
  }

  private current(generation: number): boolean {
    return !this.disposed && generation === this.generation;
  }

  private async start(cursor: Cursor, generation: number, forceSeek: boolean): Promise<void> {
    this.setCursor(cursor);
    this.needsSeek = forceSeek;
    const par = this.par!;
    if (!par.audio) throw new Error("This narration segment has no recorded audio. Embedded media and text-to-speech overlays are not supported.");
    this.notify();
    await this.prepareSource(par.audio.path, generation);
    if (!this.current(generation)) return;
    if (Number.isFinite(this.audio.duration) && par.audio.clipBeginSeconds >= this.audio.duration) {
      throw new Error("The narration segment starts beyond the end of its audio resource.");
    }
    MediaOverlayPlayer.cue({
      currentSource: this.source,
      currentTime: this.audio.currentTime,
      setSource: () => { throw new Error("The narration audio source was not loaded."); },
      seekTo: (seconds) => { this.audio.currentTime = seconds; },
    }, par, forceSeek);
    this.needsSeek = false;
    this.audio.playbackRate = this.rate;
    await this.publishTarget(generation);
    if (!this.current(generation)) return;
    this.playGeneration = generation;
    await this.audio.play();
    if (!this.current(generation)) {
      if (this.disposed || this.playGeneration !== this.generation) this.audio.pause();
      return;
    }
    this.status = "playing";
    this.notify();
    this.checkBoundary();
  }

  private setCursor(cursor: Cursor): void {
    this.requestedPassage = undefined;
    this.cursor = cursor;
    this.nextReady = false;
    this.nextFailure = undefined;
    this.nextCursor = undefined;
    if (cursor.index < cursor.clips.length - 1) {
      this.nextCursor = { ...cursor, index: cursor.index + 1 };
      this.nextReady = true;
      return;
    }
    void this.neighbor(cursor, 1).then((next) => {
      if (this.disposed || this.cursor !== cursor) return;
      this.nextCursor = next;
      this.nextReady = true;
    }, (error: unknown) => {
      if (this.disposed || this.cursor !== cursor) return;
      this.nextFailure = error;
      this.nextReady = true;
    });
  }

  private async prepareSource(path: string, generation: number): Promise<void> {
    if (this.source !== path || this.audio.error) {
      const item = this.ctx.pkg.findManifestItemByPath(path);
      if (!item || !item.mediaType.startsWith("audio/")) {
        throw new Error(`The narration audio resource "${path}" is missing from the publication manifest.`);
      }
      const bytes = await this.ctx.loader.loadResourceBytes(path);
      if (!this.current(generation)) return;
      const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: item.mediaType }));
      const oldUrl = this.sourceUrl;
      this.sourceUrl = url;
      this.source = path;
      this.audio.src = url;
      this.audio.load();
      if (oldUrl) URL.revokeObjectURL(oldUrl);
    }
    if (this.audio.readyState >= 1 || !this.current(generation)) return;
    await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        clearTimeout(timeout);
        this.audio.removeEventListener("loadedmetadata", done);
        this.audio.removeEventListener("error", failed);
        this.cancelMetadata = undefined;
      };
      const done = (): void => { cleanup(); resolve(); };
      const failed = (): void => {
        cleanup();
        reject(new Error(`Unable to decode narration audio "${path}".`));
      };
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out loading narration audio "${path}".`));
      }, 15000);
      this.cancelMetadata = done;
      this.audio.addEventListener("loadedmetadata", done);
      this.audio.addEventListener("error", failed);
    });
  }

  private async publishTarget(generation: number): Promise<void> {
    const target = this.target;
    const cursor = this.cursor;
    if (!target || !this.current(generation)) return;
    try {
      await this.ctx.onTarget(target, this.following);
    } catch (error) {
      if (this.current(generation) && this.cursor === cursor) this.fail(error);
    }
  }

  private checkBoundary(): void {
    if (this.disposed || this.status !== "playing") return;
    const end = this.par?.audio?.clipEndSeconds;
    if (end !== undefined && this.audio.currentTime >= end) {
      this.advanceAutomatically();
    } else {
      this.scheduleBoundary();
    }
  }

  private scheduleBoundary(): void {
    this.clearTimer();
    if (this.disposed || this.status !== "playing" || this.audio.paused) return;
    const end = this.par?.audio?.clipEndSeconds;
    if (end === undefined) return;
    const milliseconds = (end - this.audio.currentTime) * 1000 / this.rate;
    this.timer = setTimeout(this.onTime, Math.max(4, Math.min(100, milliseconds)));
  }

  private advanceAutomatically(): void {
    if (!this.cursor) return;
    const previous = this.par?.audio;
    const next = this.nextCursor;
    const nextAudio = next?.clips[next.index]?.audio;
    if (
      this.nextReady && !this.nextFailure && next && previous && nextAudio &&
      !this.audio.paused && previous.path === nextAudio.path &&
      previous.clipEndSeconds === nextAudio.clipBeginSeconds
    ) {
      this.setCursor(next);
      this.notify();
      void this.publishTarget(this.generation);
      this.checkBoundary();
      return;
    }
    const cursor = this.cursor;
    const ready = this.nextReady;
    const failure = this.nextFailure;
    const generation = this.begin();
    void (async () => {
      try {
        if (failure) throw failure;
        const next = ready ? this.nextCursor : await this.neighbor(cursor, 1);
        if (!this.current(generation)) return;
        if (!next) {
          this.status = "ended";
          this.notify();
          return;
        }
        await this.start(next, generation, true);
      } catch (error) {
        if (this.current(generation)) this.fail(error);
      }
    })();
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private fail(error: unknown): void {
    if (this.disposed) return;
    this.invalidate();
    this.audio.pause();
    this.status = "error";
    this.error = error instanceof Error ? error.message : String(error);
    this.notify();
  }

  private notify(): void {
    if (!this.disposed) this.ctx.notify();
  }
}

function decodeFragment(fragment: string): string {
  try { return decodeURIComponent(fragment); } catch (error) {
    if (error instanceof URIError) return fragment;
    throw error;
  }
}

function findPassage(clips: readonly SmilPar[], element: Element): number {
  let containing = -1;
  let containingElement: Element | undefined;
  let preceding = -1;
  let precedingElement: Element | undefined;
  let first = -1;
  for (let index = 0; index < clips.length; index++) {
    const fragment = clips[index]!.text.fragment;
    const target = fragment
      ? element.ownerDocument.getElementById(decodeFragment(fragment))
      : element.ownerDocument.documentElement;
    if (!target) continue;
    if (first < 0) first = index;
    if (target.contains(element)) {
      if (!containingElement || containingElement.contains(target)) {
        containing = index;
        containingElement = target;
      }
    } else if (target.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) {
      if (!precedingElement || precedingElement.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING) {
        preceding = index;
        precedingElement = target;
      }
    }
  }
  return containing >= 0 ? containing : preceding >= 0 ? preceding : first;
}
