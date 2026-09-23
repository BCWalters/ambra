import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PackageDocument } from "@ambra/engine";
import type { ContentLoader } from "@ambra/engine";
import { MediaOverlayNarration } from "./MediaOverlayNarration";
import type { NarrationAudio, NarrationState } from "./MediaOverlayNarration";

class AudioPort extends EventTarget implements NarrationAudio {
  src = "";
  private time = 0;
  seeks: number[] = [];
  duration = 100;
  playbackRate = 1;
  readyState = 1;
  paused = true;
  error: MediaError | null = null;
  get currentTime(): number { return this.time; }
  set currentTime(value: number) { this.time = value; this.seeks.push(value); }
  play = vi.fn(async () => { this.paused = false; });
  pause = vi.fn(() => { this.paused = true; });
  load = vi.fn();
  removeAttribute = vi.fn(() => { this.src = ""; });
  advance(seconds: number, event = "timeupdate"): void {
    this.time = seconds;
    if (event === "ended") this.paused = true;
    this.dispatchEvent(new Event(event));
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const clip = (chapter: number, id: string, begin: number, end?: number, audio = "one.mp3") =>
  `<par><text src="c${chapter}.xhtml#${id}"/>${audio
    ? `<audio src="${audio}" clipBegin="${begin}s"${end === undefined ? "" : ` clipEnd="${end}s"`}/>`
    : ""}</par>`;
const smil = (...clips: string[]) => `<smil xmlns="http://www.w3.org/ns/SMIL"><body>${clips.join("")}</body></smil>`;
const first = smil(clip(0, "a", 0, 1), clip(0, "b", 1, 2));
const second = smil(clip(2, "c", 2, 3), clip(2, "d", 0, 1, "two.mp3"));
const instances: MediaOverlayNarration[] = [];

function setup(
  overlays: Record<string, string> = { "EPUB/m0.smil": first, "EPUB/m2.smil": second },
  options: { frontmatter?: boolean; nonlinearLast?: boolean } = {},
) {
  const pkg = PackageDocument.parse(`<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="id">
    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">book</dc:identifier>
      <dc:title>Narration</dc:title><dc:language>en</dc:language><meta property="media:active-class">spoken</meta></metadata>
    <manifest>
      <item id="c0" href="c0.xhtml" media-type="application/xhtml+xml"${options.frontmatter ? "" : ' media-overlay="m0"'}/>
      <item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
      <item id="c2" href="c2.xhtml" media-type="application/xhtml+xml" media-overlay="m2"/>
      <item id="c3" href="c3.xhtml" media-type="application/xhtml+xml"/>
      <item id="m0" href="m0.smil" media-type="application/smil+xml"/>
      <item id="m2" href="m2.smil" media-type="application/smil+xml"/>
      <item id="a1" href="one.mp3" media-type="audio/mpeg"/>
      <item id="a2" href="two.mp3" media-type="audio/mpeg"/>
    </manifest><spine><itemref idref="c0"/><itemref idref="c1"/><itemref idref="c2"${options.nonlinearLast ? ' linear="no"' : ""}/><itemref idref="c3"/></spine></package>`, "EPUB/package.opf");
  const loader = {
    readArchiveFileText: vi.fn(async (path: string) => {
      if (!overlays[path]) throw new Error(`Missing resource: ${path}`);
      return overlays[path]!;
    }),
    loadResourceBytes: vi.fn(async (): Promise<Uint8Array> => new Uint8Array([1, 2])),
  };
  const audio = new AudioPort();
  const onTarget = vi.fn(async () => {});
  const states: NarrationState[] = [];
  const notify = vi.fn(() => states.push(narration.snapshot));
  const narration = new MediaOverlayNarration({
    pkg, loader: loader as unknown as ContentLoader, audio, onTarget, notify,
  });
  instances.push(narration);
  return { narration, pkg, loader, audio, onTarget, notify, states };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  let urls = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:audio-${++urls}`);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => {
  for (const instance of instances.splice(0)) instance.dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("MediaOverlayNarration", () => {
  it("owns a hidden observable audio element and removes it on disposal", () => {
    const { pkg, loader } = setup();
    const narration = new MediaOverlayNarration({
      pkg,
      loader: loader as unknown as ContentLoader,
      onTarget: async () => {},
      notify: () => {},
    });
    instances.push(narration);
    const audio = document.querySelector<HTMLAudioElement>("[data-ambra-narration-audio]")!;
    expect(audio.hidden).toBe(true);
    vi.spyOn(audio, "pause").mockImplementation(() => {});
    vi.spyOn(audio, "load").mockImplementation(() => {});
    narration.dispose();
    expect(document.querySelector("[data-ambra-narration-audio]")).toBeNull();
  });

  it("discovers partial-book associations without eagerly reading SMIL and preserves active-class metadata", () => {
    const { narration, loader, pkg } = setup();
    expect(narration.snapshot).toMatchObject({ available: true, status: "idle", following: true });
    expect(loader.readArchiveFileText).not.toHaveBeenCalled();
    expect(pkg.metadata.mediaOverlayActiveClass).toBe("spoken");
  });

  it("plays contiguous clips and crosses a non-narrated chapter without seeking or restarting audio", async () => {
    const { narration, audio, loader, notify, onTarget } = setup();
    await narration.playFrom(0);
    expect(audio.seeks).toEqual([0]);
    const calls = notify.mock.calls.length;
    audio.advance(0.5);
    expect(notify).toHaveBeenCalledTimes(calls);
    audio.advance(1.03);
    await flush();
    expect(narration.target).toEqual({ spineIndex: 0, path: "EPUB/c0.xhtml", fragment: "b" });
    expect(audio.currentTime).toBe(1.03);
    expect(loader.readArchiveFileText).toHaveBeenCalledTimes(2);
    audio.advance(2.02);
    await flush();
    expect(narration.target).toEqual({ spineIndex: 2, path: "EPUB/c2.xhtml", fragment: "c" });
    expect(audio.seeks).toEqual([0]);
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(audio.pause).toHaveBeenCalledTimes(1);
    expect(onTarget).toHaveBeenLastCalledWith(narration.target, true);
    audio.advance(3);
    await flush();
    expect(narration.target?.fragment).toBe("d");
    expect(audio.seeks).toEqual([0, 0]);
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:audio-1");
    audio.advance(1);
    await flush();
    expect(narration.snapshot).toMatchObject({ status: "ended", hasNext: false, hasPrevious: true });
    expect(audio.paused).toBe(true);
  });

  it("manual browsing keeps audio running; return follows without rewinding; listen explicitly seeks", async () => {
    const { narration, audio, onTarget } = setup();
    await narration.playFrom(0);
    narration.suspendFollowing();
    expect(audio.paused).toBe(false);
    audio.advance(1.2);
    await flush();
    expect(onTarget).toHaveBeenLastCalledWith(narration.target, false);
    await narration.returnToNarration();
    expect(onTarget).toHaveBeenLastCalledWith(narration.target, true);
    expect(audio.currentTime).toBe(1.2);
    expect(audio.seeks).toEqual([0]);
    await narration.playFrom(0);
    expect(audio.currentTime).toBe(0);
  });

  it("resumes within a clip and changes the real playback rate", async () => {
    const { narration, audio } = setup();
    await narration.playFrom(0);
    audio.advance(0.4);
    narration.pause();
    narration.setRate(1.5);
    await narration.resume();
    expect(audio.currentTime).toBe(0.4);
    expect(audio.seeks).toEqual([0]);
    expect(audio.playbackRate).toBe(1.5);
    expect(narration.snapshot.rate).toBe(1.5);
    narration.setRate(Number.NaN);
    expect(audio.playbackRate).toBe(1.5);
    expect(narration.snapshot.status).toBe("error");
    expect(narration.snapshot.error).toContain("Narration speed");
  });

  it("explicit resume republishes the current target even when audio is already playing", async () => {
    const { narration, audio, onTarget } = setup();
    await narration.playFrom(0);
    audio.advance(0.4);
    onTarget.mockClear();
    await narration.resume();
    expect(onTarget).toHaveBeenCalledExactlyOnceWith(narration.target, true);
    expect(audio.currentTime).toBe(0.4);
    expect(audio.play).toHaveBeenCalledTimes(1);
  });

  it("selects containing/nearest preceding source elements, including descendants and encoded fragments", async () => {
    const { narration } = setup({
      "EPUB/m0.smil": smil(clip(0, "a", 0, 1), clip(0, "b%20c", 1, 2)),
      "EPUB/m2.smil": second,
    });
    const doc = new DOMParser().parseFromString('<html><body><h1 id="before">Title</h1><p id="a"><em id="inside">A</em></p><aside id="between">gap</aside><p id="b c">B</p><div id="after">end</div></body></html>', "text/html");
    for (const [id, expected] of [["before", "a"], ["inside", "a"], ["between", "a"], ["after", "b c"]]) {
      await narration.playFrom(0, doc.getElementById(id!)!);
      expect(narration.target?.fragment).toBe(expected);
    }
  });

  it("starts at the next narrated linear chapter when the current chapter has no overlay", async () => {
    const { narration, onTarget, audio } = setup();
    const unrelated = new DOMParser().parseFromString("<p id='unnarrated'>Text</p>", "text/html");
    await narration.playFrom(1, unrelated.getElementById("unnarrated")!);
    expect(narration.target).toEqual({ spineIndex: 2, path: "EPUB/c2.xhtml", fragment: "c" });
    expect(onTarget).toHaveBeenLastCalledWith(narration.target, true);
    expect(audio.currentTime).toBe(2);
  });

  it("makes initial Listen from non-narrated frontmatter visibly enter the first narrated chapter", async () => {
    const { narration, onTarget } = setup(undefined, { frontmatter: true });
    await narration.playFrom(0);
    expect(narration.target?.spineIndex).toBe(2);
    expect(narration.snapshot).toMatchObject({ status: "playing", hasPrevious: false });
    expect(onTarget).toHaveBeenLastCalledWith(narration.target, true);
  });

  it("does not select non-linear supplementary overlays as a forward fallback", async () => {
    const { narration, audio } = setup(undefined, { nonlinearLast: true });
    await narration.playFrom(1);
    expect(narration.snapshot.status).toBe("error");
    expect(audio.play).not.toHaveBeenCalled();
  });

  it("reports a late non-narrated passage rather than jumping backwards to chapter one", async () => {
    const { narration, audio } = setup();
    await narration.playFrom(3);
    expect(narration.snapshot).toMatchObject({ status: "error", error: expect.stringContaining("no recorded narration") });
    expect(audio.play).not.toHaveBeenCalled();
    expect(narration.target).toBeUndefined();
  });

  it("pausing during SMIL loading prevents late playback and permits explicit resume", async () => {
    const { narration, loader, audio } = setup();
    const pending = deferred<string>();
    loader.readArchiveFileText.mockReturnValueOnce(pending.promise);
    const playing = narration.playFrom(0);
    narration.pause();
    narration.suspendFollowing();
    pending.resolve(first);
    await playing;
    expect(narration.snapshot.status).toBe("paused");
    expect(audio.play).not.toHaveBeenCalled();
    await narration.resume();
    expect(narration.snapshot.status).toBe("playing");
    expect(narration.snapshot.following).toBe(false);
  });

  it("pausing during resource loading prevents creating a URL or starting audio", async () => {
    const { narration, loader, audio } = setup();
    const pending = deferred<Uint8Array>();
    loader.loadResourceBytes.mockReturnValueOnce(pending.promise);
    const playing = narration.playFrom(0);
    await flush();
    narration.pause();
    pending.resolve(new Uint8Array([1]));
    await playing;
    expect(narration.snapshot.status).toBe("paused");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(audio.play).not.toHaveBeenCalled();
  });

  it("waits for metadata before seeking and releases pending metadata listeners on pause", async () => {
    const { narration, audio } = setup();
    audio.readyState = 0;
    const playing = narration.playFrom(0);
    await flush();
    expect(audio.seeks).toEqual([]);
    narration.pause();
    await playing;
    audio.readyState = 1;
    audio.dispatchEvent(new Event("loadedmetadata"));
    expect(audio.play).not.toHaveBeenCalled();
    await narration.resume();
    expect(audio.seeks).toEqual([0]);
    expect(narration.snapshot.status).toBe("playing");
  });

  it("surfaces rejected play promises without false playing or unhandled rejections", async () => {
    const { narration, audio, states } = setup();
    audio.play.mockRejectedValueOnce(new Error("Playback blocked"));
    await narration.playFrom(0);
    expect(narration.snapshot).toMatchObject({ status: "error", error: "Playback blocked" });
    expect(states.some((state) => state.status === "playing")).toBe(false);
    expect(audio.paused).toBe(true);
  });

  it("late play completion cannot undo pause", async () => {
    const { narration, audio } = setup();
    const pending = deferred<void>();
    audio.play.mockImplementationOnce(async () => { await pending.promise; audio.paused = false; });
    const playing = narration.playFrom(0);
    await flush();
    narration.pause();
    pending.resolve();
    await playing;
    expect(narration.snapshot.status).toBe("paused");
    expect(audio.paused).toBe(true);
  });

  it("a newer seek wins over an older pending resource load", async () => {
    const { narration, audio, loader } = setup();
    const pending = deferred<Uint8Array>();
    loader.loadResourceBytes.mockReturnValueOnce(pending.promise);
    const old = narration.playFrom(0);
    await flush();
    await narration.playFrom(2);
    pending.resolve(new Uint8Array([1]));
    await old;
    expect(narration.target?.spineIndex).toBe(2);
    expect(audio.seeks).toEqual([2]);
    expect(audio.play).toHaveBeenCalledTimes(1);
  });

  it("a stale rejected play cannot replace newer playback state", async () => {
    const { narration, audio } = setup();
    const pending = deferred<void>();
    audio.play.mockReturnValueOnce(pending.promise);
    const old = narration.playFrom(0);
    await flush();
    await narration.playFrom(2);
    pending.reject(new Error("Old aborted playback"));
    await old;
    expect(narration.snapshot.status).toBe("playing");
    expect(narration.target?.spineIndex).toBe(2);
  });

  it("previous/next select authored segments while paused without accidentally playing", async () => {
    const { narration, audio } = setup();
    await narration.playFrom(2);
    narration.pause();
    await narration.previous();
    expect(narration.target?.fragment).toBe("b");
    expect(narration.snapshot.status).toBe("paused");
    expect(audio.play).toHaveBeenCalledTimes(1);
    await narration.resume();
    expect(audio.currentTime).toBe(1);
    await narration.next();
    expect(narration.target?.fragment).toBe("c");
    expect(audio.currentTime).toBe(2);
  });

  it("checks clip boundaries between coarse timeupdate events and does not notify on polling ticks", async () => {
    const { narration, audio, notify } = setup();
    await narration.playFrom(0);
    const calls = notify.mock.calls.length;
    await vi.advanceTimersByTimeAsync(100);
    expect(notify).toHaveBeenCalledTimes(calls);
    audio.currentTime = 1;
    await vi.advanceTimersByTimeAsync(100);
    expect(narration.target?.fragment).toBe("b");
  });

  it("seeks over authored gaps in a shared audio resource", async () => {
    const { narration, audio } = setup({
      "EPUB/m0.smil": smil(clip(0, "a", 0, 1), clip(0, "b", 2, 3)),
      "EPUB/m2.smil": second,
    });
    await narration.playFrom(0);
    audio.advance(1);
    await flush();
    expect(audio.seeks).toEqual([0, 2]);
    expect(narration.target?.fragment).toBe("b");
    expect(narration.snapshot.status).toBe("playing");
  });

  it("surfaces truncated audio and clip starts outside the audio duration", async () => {
    const { narration, audio } = setup();
    await narration.playFrom(0);
    audio.advance(0.2, "ended");
    expect(narration.snapshot.error).toContain("before its authored clip boundary");
    audio.duration = 1;
    await narration.playFrom(2);
    expect(narration.snapshot.error).toContain("beyond the end");
  });

  it("a stale navigation failure cannot stop a newer clip", async () => {
    const { narration, audio, onTarget } = setup();
    await narration.playFrom(0);
    const pending = deferred<void>();
    onTarget.mockReturnValueOnce(pending.promise);
    audio.advance(1);
    await flush();
    audio.advance(2);
    await flush();
    pending.reject(new Error("Old rendering failure"));
    await flush();
    expect(narration.snapshot.status).toBe("playing");
    expect(narration.target?.fragment).toBe("c");
  });

  it("a stale successful play during a new load cannot restart old audio", async () => {
    const { narration, audio, loader } = setup();
    const pendingPlay = deferred<void>();
    audio.play.mockImplementationOnce(async () => { await pendingPlay.promise; audio.paused = false; });
    const old = narration.playFrom(0);
    await flush();
    const pendingSmil = deferred<string>();
    loader.readArchiveFileText.mockReturnValueOnce(pendingSmil.promise);
    const next = narration.playFrom(2);
    pendingPlay.resolve();
    await old;
    expect(audio.paused).toBe(true);
    pendingSmil.resolve(second);
    await next;
    expect(narration.target?.spineIndex).toBe(2);
    expect(narration.snapshot.status).toBe("playing");
  });

  it("handles open-ended clips through the ended event", async () => {
    const { narration, audio } = setup({
      "EPUB/m0.smil": smil(clip(0, "a", 0)),
      "EPUB/m2.smil": second,
    });
    await narration.playFrom(0);
    audio.advance(10, "ended");
    await flush();
    expect(narration.target?.fragment).toBe("c");
    expect(narration.snapshot.status).toBe("playing");
  });

  it.each([
    [smil(clip(0, "a", 0, 1, "")), "no recorded audio"],
    [smil(clip(0, "a", 2, 1)), "invalid audio clip range"],
    [smil(clip(0, "a", 0, 1, "missing.mp3")), "missing from the publication manifest"],
    ["<invalid>", "SMIL"],
  ])("reports unsupported or malformed narration: %s", async (overlay, message) => {
    const { narration, audio } = setup({ "EPUB/m0.smil": overlay, "EPUB/m2.smil": second });
    await narration.playFrom(0);
    expect(narration.snapshot).toMatchObject({ status: "error", error: expect.stringContaining(message) });
    expect(audio.play).not.toHaveBeenCalled();
  });

  it("surfaces missing audio bytes and asynchronous audio errors", async () => {
    const { narration, loader, audio } = setup();
    loader.loadResourceBytes.mockRejectedValueOnce(new Error("Missing archive entry"));
    await narration.playFrom(0);
    expect(narration.snapshot.error).toBe("Missing archive entry");
    await narration.resume();
    audio.dispatchEvent(new Event("error"));
    expect(narration.snapshot).toMatchObject({ status: "error", error: expect.stringContaining("Unable to play narration") });
    expect(audio.paused).toBe(true);
  });

  it("dispose releases source URLs/listeners/timers and ignores late loading", async () => {
    const { narration, audio, loader, notify } = setup();
    await narration.playFrom(0);
    const pending = deferred<Uint8Array>();
    loader.loadResourceBytes.mockReturnValueOnce(pending.promise);
    await narration.playFrom(2);
    const moving = narration.next();
    await flush();
    narration.dispose();
    const calls = notify.mock.calls.length;
    pending.resolve(new Uint8Array([1]));
    await moving;
    audio.advance(99);
    audio.dispatchEvent(new Event("error"));
    expect(notify).toHaveBeenCalledTimes(calls);
    expect(audio.src).toBe("");
    expect(audio.paused).toBe(true);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("dispose also silences a late successful play promise", async () => {
    const { narration, audio, notify } = setup();
    const pending = deferred<void>();
    audio.play.mockImplementationOnce(async () => { await pending.promise; audio.paused = false; });
    const playing = narration.playFrom(0);
    await flush();
    narration.dispose();
    const calls = notify.mock.calls.length;
    pending.resolve();
    await playing;
    expect(audio.paused).toBe(true);
    expect(notify).toHaveBeenCalledTimes(calls);
  });
});
