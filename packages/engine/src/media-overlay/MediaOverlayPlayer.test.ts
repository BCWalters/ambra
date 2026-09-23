// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { SmilDocument } from "./SmilDocument.js";
import { MediaOverlayError, MediaOverlayPlayer } from "./MediaOverlayPlayer.js";
import type { MediaOverlayAudioHost } from "./MediaOverlayPlayer.js";

const THREE_CLIP_SMIL = `<?xml version="1.0" encoding="UTF-8"?>
<smil xmlns="http://www.w3.org/ns/SMIL" xmlns:epub="http://www.idpf.org/2007/ops" version="3.0">
  <body>
    <par id="p1">
      <text src="chapter1.xhtml#c01h01"/>
      <audio src="audio/c01.mp3" clipBegin="0:00:00.000" clipEnd="0:00:05.000"/>
    </par>
    <par id="p2">
      <text src="chapter1.xhtml#c01p1"/>
      <audio src="audio/c01.mp3" clipBegin="0:00:05.000" clipEnd="0:00:12.000"/>
    </par>
    <par id="p3">
      <text src="chapter1.xhtml#c01p2"/>
      <audio src="audio/c02.mp3" clipBegin="0:00:00.000" clipEnd="0:00:08.000"/>
    </par>
  </body>
</smil>`;

function makeHost(): MediaOverlayAudioHost & {
  playCalls: number;
  pauseCalls: number;
  sources: string[];
  seeks: number[];
  advanceTo(seconds: number): void;
} {
  let currentSource: string | undefined;
  let currentTime = 0;
  const host = {
    playCalls: 0,
    pauseCalls: 0,
    sources: [] as string[],
    seeks: [] as number[],
    play: vi.fn(() => {
      host.playCalls++;
    }),
    pause: vi.fn(() => {
      host.pauseCalls++;
    }),
    setSource: vi.fn((path: string) => {
      currentSource = path;
      host.sources.push(path);
    }),
    seekTo: vi.fn((seconds: number) => {
      currentTime = seconds;
      host.seeks.push(seconds);
    }),
    advanceTo(seconds: number) {
      currentTime = seconds;
    },
    get currentSource() {
      return currentSource;
    },
    get currentTime() {
      return currentTime;
    },
  };
  return host;
}

function makePlayer(): { player: MediaOverlayPlayer; host: ReturnType<typeof makeHost> } {
  const doc = SmilDocument.parse(THREE_CLIP_SMIL, "OEBPS/chapter1_overlay.smil");
  const host = makeHost();
  return { player: new MediaOverlayPlayer(doc, host), host };
}

describe("MediaOverlayPlayer", () => {
  it("shares clip cueing without requiring synchronous audio playback", () => {
    const { player, host } = makePlayer();
    const par = player.currentClip!.par;
    MediaOverlayPlayer.cue(host, par);
    host.advanceTo(2);
    MediaOverlayPlayer.cue(host, par);
    expect(host.seeks).toEqual([0]);
    MediaOverlayPlayer.cue(host, par, true);
    expect(host.seeks).toEqual([0, 0]);
    expect(host.play).not.toHaveBeenCalled();
  });

  it("rejects unsupported audio-less segments rather than playing a previous audio source", () => {
    const doc = SmilDocument.parse(
      '<smil xmlns="http://www.w3.org/ns/SMIL"><body><par><text src="chapter.xhtml#text"/></par></body></smil>',
      "overlay.smil",
    );
    const host = makeHost();
    const player = new MediaOverlayPlayer(doc, host);
    expect(() => player.play()).toThrow("no recorded audio");
    expect(host.play).not.toHaveBeenCalled();
    expect(player.isPlaying).toBe(false);
  });

  it("starts on the first clip", () => {
    const { player } = makePlayer();
    expect(player.clipCount).toBe(3);
    expect(player.currentClip?.par.id).toBe("p1");
    expect(player.currentClip?.index).toBe(0);
    expect(player.isPlaying).toBe(false);
  });

  it("play() cues the host to the current clip's audio range and starts it", () => {
    const { player, host } = makePlayer();
    player.play();
    expect(host.sources).toEqual(["OEBPS/audio/c01.mp3"]);
    expect(host.seeks).toEqual([0]);
    expect(host.playCalls).toBe(1);
    expect(player.isPlaying).toBe(true);
  });

  it("pause() pauses the host and clears isPlaying", () => {
    const { player, host } = makePlayer();
    player.play();
    player.pause();
    expect(host.pauseCalls).toBe(1);
    expect(player.isPlaying).toBe(false);
  });

  it("resumes the same par at its paused position without seeking back to clipBegin", () => {
    const { player, host } = makePlayer();
    player.play();
    host.advanceTo(4);
    player.pause();

    expect(host.currentTime).toBe(4);
    player.play();

    expect(host.currentTime).toBe(4);
    expect(host.seeks).toEqual([0]);
    expect(host.sources).toEqual(["OEBPS/audio/c01.mp3"]);
    expect(host.playCalls).toBe(2);
    expect(player.currentClip?.par.id).toBe("p1");
    expect(player.isPlaying).toBe(true);
  });

  it.each([5, 8, 11.999])("preserves an in-range position %s for a nonzero clipBegin", (seconds) => {
    const { player, host } = makePlayer();
    player.goToParId("p2");
    player.play();
    host.advanceTo(seconds);
    player.pause();

    player.play();

    expect(host.currentTime).toBe(seconds);
    expect(host.seeks).toEqual([5]);
  });

  it.each([4.999, 12, 20])("re-cues an out-of-range position %s to clipBegin", (seconds) => {
    const { player, host } = makePlayer();
    player.goToParId("p2");
    player.play();
    host.advanceTo(seconds);
    player.pause();

    player.play();

    expect(host.currentTime).toBe(5);
    expect(host.seeks).toEqual([5, 5]);
  });

  it("restores the correct source even if the replacement source's time is in range", () => {
    const { player, host } = makePlayer();
    player.play();
    player.pause();
    host.setSource("OEBPS/audio/c02.mp3");
    host.advanceTo(4);

    player.play();

    expect(host.currentSource).toBe("OEBPS/audio/c01.mp3");
    expect(host.currentTime).toBe(0);
    expect(host.seeks).toEqual([0, 0]);
  });

  it("does not rewind when an already playing par is selected again", () => {
    const { player, host } = makePlayer();
    player.play();
    host.advanceTo(4);

    player.goToParId("p1");

    expect(host.currentTime).toBe(4);
    expect(host.seeks).toEqual([0]);
  });

  it("cues a different par selected while paused before resuming", () => {
    const { player, host } = makePlayer();
    player.play();
    host.advanceTo(4);
    player.pause();
    player.next();

    expect(host.currentTime).toBe(4);
    player.play();

    expect(player.currentClip?.par.id).toBe("p2");
    expect(host.currentTime).toBe(5);
    expect(host.seeks).toEqual([0, 5]);
  });

  it("preserves a finite position in an open-ended clip, but re-cues invalid times", () => {
    const doc = SmilDocument.parse(
      THREE_CLIP_SMIL.replace(' clipEnd="0:00:05.000"', ""),
      "OEBPS/chapter1_overlay.smil",
    );
    const host = makeHost();
    const player = new MediaOverlayPlayer(doc, host);
    player.play();
    host.advanceTo(40);
    player.pause();

    player.play();
    expect(host.currentTime).toBe(40);
    expect(host.seeks).toEqual([0]);

    player.pause();
    host.advanceTo(Number.NaN);
    player.play();
    expect(host.currentTime).toBe(0);
    expect(host.seeks).toEqual([0, 0]);
    expect(player.clipForHostPosition("OEBPS/audio/c01.mp3", Number.POSITIVE_INFINITY)).toBeUndefined();
  });

  it("next() advances to the next clip and re-cues the host when already playing", () => {
    const { player, host } = makePlayer();
    player.play();
    const advanced = player.next();
    expect(advanced).toBe(true);
    expect(player.currentClip?.par.id).toBe("p2");
    // Same audio file as p1 — setSource is only called again if the
    // source actually differs, so p1's own initial call is still the
    // only one so far.
    expect(host.sources).toEqual(["OEBPS/audio/c01.mp3"]);
    expect(host.seeks).toEqual([0, 5]);
  });

  it("next() switches source when the next clip uses a different audio file", () => {
    const { player, host } = makePlayer();
    player.play();
    player.next();
    player.next();
    expect(player.currentClip?.par.id).toBe("p3");
    expect(host.sources).toEqual(["OEBPS/audio/c01.mp3", "OEBPS/audio/c02.mp3"]);
  });

  it("next() does not re-cue the host when not currently playing", () => {
    const { player, host } = makePlayer();
    player.next();
    expect(player.currentClip?.par.id).toBe("p2");
    expect(host.sources).toEqual([]);
    expect(host.playCalls).toBe(0);
  });

  it("next() returns false and stays put at the last clip", () => {
    const { player } = makePlayer();
    player.next();
    player.next();
    expect(player.currentClip?.par.id).toBe("p3");
    expect(player.next()).toBe(false);
    expect(player.currentClip?.par.id).toBe("p3");
  });

  it("previous() moves back a clip, and returns false at the first clip", () => {
    const { player } = makePlayer();
    player.next();
    expect(player.currentClip?.par.id).toBe("p2");
    expect(player.previous()).toBe(true);
    expect(player.currentClip?.par.id).toBe("p1");
    expect(player.previous()).toBe(false);
  });

  it("goToParId() jumps directly to the matching clip", () => {
    const { player } = makePlayer();
    player.goToParId("p3");
    expect(player.currentClip?.par.id).toBe("p3");
  });

  it("goToParId() throws for an id not present in this document", () => {
    const { player } = makePlayer();
    expect(() => player.goToParId("nonexistent")).toThrow(MediaOverlayError);
  });

  it("goToTextFragment() jumps to the clip whose text src exactly matches", () => {
    const { player } = makePlayer();
    player.goToTextFragment("OEBPS/chapter1.xhtml", "c01p1");
    expect(player.currentClip?.par.id).toBe("p2");
  });

  it("goToTextFragment() falls back to the first clip for the same document when no fragment matches", () => {
    const { player } = makePlayer();
    player.goToTextFragment("OEBPS/chapter1.xhtml", "nonexistent-fragment");
    expect(player.currentClip?.par.id).toBe("p1");
  });

  it("goToTextFragment() falls back to clip 0 entirely when the document itself doesn't match", () => {
    const { player } = makePlayer();
    player.next();
    player.goToTextFragment("OEBPS/some-other-chapter.xhtml", undefined);
    expect(player.currentClip?.par.id).toBe("p1");
  });

  it("clipForHostPosition() finds the clip whose clipBegin/clipEnd range contains the given time", () => {
    const { player } = makePlayer();
    expect(player.clipForHostPosition("OEBPS/audio/c01.mp3", 2)?.par.id).toBe("p1");
    expect(player.clipForHostPosition("OEBPS/audio/c01.mp3", 7)?.par.id).toBe("p2");
    expect(player.clipForHostPosition("OEBPS/audio/c02.mp3", 3)?.par.id).toBe("p3");
  });

  it("clipForHostPosition() treats clipBegin as inclusive and clipEnd as exclusive", () => {
    const { player } = makePlayer();
    expect(player.clipForHostPosition("OEBPS/audio/c01.mp3", 5)?.par.id).toBe("p2");
    expect(player.clipForHostPosition("OEBPS/audio/c01.mp3", 4.999)?.par.id).toBe("p1");
  });

  it("clipForHostPosition() returns undefined for a source/time with no matching clip", () => {
    const { player } = makePlayer();
    expect(player.clipForHostPosition("OEBPS/audio/c01.mp3", 100)).toBeUndefined();
    expect(player.clipForHostPosition("OEBPS/audio/unknown.mp3", 1)).toBeUndefined();
  });
});
