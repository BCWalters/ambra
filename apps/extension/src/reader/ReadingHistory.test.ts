import { describe, expect, it, vi } from "vitest";
import { ReadingHistory, READING_HISTORY_KEY } from "./ReadingHistory.js";

const cfi = (index: number) => `epubcfi(/6/2!/4/${index * 2})`;

function browser() {
  const events = new EventTarget();
  const entries: Record<string, unknown>[] = [{ router: { keep: true } }];
  const storage = new Map<string, string>();
  let index = 0;
  const history = {
    scrollRestoration: "auto",
    get state() { return structuredClone(entries[index]!); },
    replaceState: vi.fn((state: Record<string, unknown>) => { entries[index] = structuredClone(state); }),
    pushState: vi.fn((state: Record<string, unknown>) => {
      entries.splice(++index, entries.length, structuredClone(state));
    }),
    go: vi.fn((delta: number) => {
      if (index + delta < 0 || index + delta >= entries.length) return;
      index += delta;
      events.dispatchEvent(Object.assign(new Event("popstate"), { state: history.state }));
    }),
  };
  const window = {
    history, crypto: { randomUUID: () => "document-session" },
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  } as unknown as Window;
  return { window, history, entries, storage, events, index: () => index };
}

function setup(host = browser()) {
  let position = cfi(1);
  const restore = vi.fn(async (cfi: string) => { position = cfi; return true; });
  const report = vi.fn();
  const cancel = vi.fn();
  const callbacks = {
    read: () => position, restore, report, cancel, equal: (a: string, b: string) => a === b,
  };
  const reader = new ReadingHistory(host.window, "book", callbacks);
  reader.start(position);
  const jump = (to: number) => {
    const commit = reader.beginJump();
    position = cfi(to);
    commit?.();
  };
  return { ...host, reader, restore, report, cancel, callbacks, jump,
    set: (to: number) => { position = cfi(to); }, position: () => position };
}

describe("ReadingHistory", () => {
  it("pushes only deliberate committed jumps, replacing ordinary progress in the current entry", async () => {
    const h = setup();
    h.jump(2);
    h.set(3);
    h.reader.update();
    expect(h.entries).toHaveLength(2);
    h.history.go(-1);
    await h.reader.settled();
    expect(h.position()).toBe(cfi(1));
    h.history.go(1);
    await h.reader.settled();
    expect(h.position()).toBe(cfi(3));
    expect(h.history.pushState).toHaveBeenCalledTimes(1);
    expect(h.history.state.router).toEqual({ keep: true });
    expect(h.history.pushState.mock.calls[0]).toHaveLength(2);
  });

  it("invalidates the forward branch after Back and a new jump", async () => {
    const h = setup();
    h.jump(2);
    h.jump(3);
    h.history.go(-1);
    await h.reader.settled();
    h.jump(4);
    expect(h.entries).toHaveLength(3);
    h.history.go(1);
    expect(h.position()).toBe(cfi(4));
    h.history.go(-1);
    await h.reader.settled();
    expect(h.position()).toBe(cfi(2));
  });

  it("ignores no-op, failed and superseded jump commits", () => {
    const h = setup();
    h.jump(1);
    h.reader.beginJump(); // A failed load never commits.
    const stale = h.reader.beginJump();
    const current = h.reader.beginJump();
    h.set(3);
    stale?.();
    expect(h.entries).toHaveLength(1);
    current?.();
    expect(h.entries).toHaveLength(2);
  });

  it("retains an unflushed scroll departure across Back, refresh and Forward", async () => {
    const h = setup();
    h.jump(2);
    h.set(3); // Native Back before scrollend.
    h.history.go(-1);
    await h.reader.settled();
    h.reader.dispose();
    const resumed = new ReadingHistory(h.window, "book", h.callbacks);
    expect(resumed.resumeCfi).toBe(cfi(1));
    resumed.start(cfi(1));
    h.history.go(1);
    await resumed.settled();
    expect(h.position()).toBe(cfi(3));
    expect(h.entries).toHaveLength(2);
    expect(h.history.state[READING_HISTORY_KEY]).toMatchObject({ cfi: cfi(3), index: 1 });
  });

  it("rolls back a failed restoration without rewriting either destination or stack", async () => {
    const h = setup();
    h.jump(2);
    h.restore.mockResolvedValueOnce(false);
    h.history.go(-1);
    await h.reader.settled();
    expect(h.index()).toBe(1);
    expect(h.position()).toBe(cfi(2));
    expect(h.entries[0]![READING_HISTORY_KEY]).toMatchObject({ cfi: cfi(1) });
    h.history.go(-1);
    await h.reader.settled();
    expect(h.position()).toBe(cfi(1));
  });

  it("does not resurrect a departure correction after revisiting and reading farther", async () => {
    const h = setup();
    h.jump(2);
    h.set(3);
    h.history.go(-1);
    await h.reader.settled();
    h.history.go(1);
    await h.reader.settled();
    expect(h.position()).toBe(cfi(3));
    h.set(4);
    h.reader.update();
    h.history.go(-1);
    await h.reader.settled();
    h.history.go(1);
    await h.reader.settled();
    expect(h.position()).toBe(cfi(4));
    expect(h.storage.size).toBe(0);
  });

  it("only the latest rapid traversal owns completion or failure rollback", async () => {
    const h = setup();
    h.jump(2);
    h.jump(3);
    let fail!: (success: boolean) => void;
    h.restore.mockImplementationOnce(() => new Promise(resolve => { fail = resolve; }));
    h.history.go(-1);
    h.history.go(-1);
    await h.reader.settled();
    expect(h.position()).toBe(cfi(1));
    fail(false);
    await Promise.resolve();
    expect(h.index()).toBe(0);
    expect(h.history.go).toHaveBeenCalledTimes(2);
    expect(h.cancel).toHaveBeenCalledTimes(2);
  });

  it("waits for asynchronous failure rollback before accepting another deliberate jump", async () => {
    const h = setup();
    h.jump(2);
    const go = h.history.go.getMockImplementation()!;
    let rollback!: () => void;
    h.restore.mockImplementationOnce(async () => {
      h.history.go.mockImplementationOnce(delta => { rollback = () => go(delta); });
      return false;
    });
    h.history.go(-1);
    await vi.waitFor(() => expect(rollback).toBeTypeOf("function"));
    expect(h.reader.beginJump()).toBeUndefined();
    let settled = false;
    const waiting = h.reader.settled().then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    rollback();
    await waiting;
    h.jump(3);
    expect(h.entries).toHaveLength(3);
    expect(h.history.state[READING_HISTORY_KEY]).toMatchObject({ index: 2, cfi: cfi(3) });
  });

  it("an overlapping Back then Forward cannot commit the stale backward destination", async () => {
    const h = setup();
    h.jump(2);
    let finish!: (success: boolean) => void;
    h.restore.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    h.history.go(-1);
    h.history.go(1);
    await h.reader.settled();
    finish(false);
    await Promise.resolve();
    expect(h.history.state[READING_HISTORY_KEY]).toMatchObject({ index: 1, cfi: cfi(2) });
    expect(h.history.go).toHaveBeenCalledTimes(2);
  });

  it("leaves foreign, wrong-book and wrong-version entries alone", async () => {
    for (const state of [
      { router: "other" },
      { [READING_HISTORY_KEY]: { version: 2, book: "book", session: "document-session", index: 0, cfi: cfi(1) } },
      { [READING_HISTORY_KEY]: { version: 1, book: "other", session: "document-session", index: 0, cfi: cfi(1) } },
      { [READING_HISTORY_KEY]: { version: 1, book: "book", session: "another-document", index: 0, cfi: cfi(1) } },
    ]) {
      const h = setup();
      h.jump(2);
      h.entries[0] = state;
      h.history.go(-1);
      await h.reader.settled();
      h.set(3);
      h.reader.update();
      expect(h.history.state).toEqual(state);
      expect(h.restore).not.toHaveBeenCalled();
      h.reader.dispose();
    }
  });

  it("restores scroll policy and removes listeners on repeated disposal/StrictMode mounts", async () => {
    const h = setup();
    expect(h.history.scrollRestoration).toBe("manual");
    h.jump(2);
    h.reader.dispose();
    h.reader.dispose();
    expect(h.history.scrollRestoration).toBe("auto");
    h.history.go(-1);
    expect(h.restore).not.toHaveBeenCalled();
    const reader = new ReadingHistory(h.window, "book", h.callbacks);
    reader.start(cfi(1));
    h.history.go(1);
    await reader.settled();
    expect(h.restore).toHaveBeenCalledOnce();
    reader.dispose();
  });

  it("releases scroll restoration for other documents and reacquires it on a cached page show", () => {
    const h = setup();
    h.events.dispatchEvent(new Event("pagehide"));
    expect(h.history.scrollRestoration).toBe("auto");
    h.events.dispatchEvent(new Event("pageshow"));
    expect(h.history.scrollRestoration).toBe("manual");
    h.reader.dispose();
    h.events.dispatchEvent(new Event("pageshow"));
    expect(h.history.scrollRestoration).toBe("auto");
  });

  it("reports History API failures instead of claiming a push or corrupting the origin", () => {
    const h = setup();
    h.history.pushState.mockImplementationOnce(() => { throw new DOMException("quota", "SecurityError"); });
    h.jump(2);
    expect(h.report).toHaveBeenCalledOnce();
    expect(h.entries).toHaveLength(1);
    expect(h.history.state[READING_HISTORY_KEY]).toMatchObject({ cfi: cfi(1) });
  });
});
