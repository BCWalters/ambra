/** Same-document browser history belongs to this reader document, not to its
 * iframes. CFIs remain opaque here; the controller resolves them in the book. */
export const READING_HISTORY_KEY = "__ambraReading";

interface Entry {
  version: 1;
  book: string;
  session: string;
  index: number;
  cfi: string;
}

export interface ReadingHistoryCallbacks {
  read(): string | undefined;
  restore(cfi: string): Promise<boolean>;
  cancel(): void;
  report(error: unknown): void;
  equal(left: string, right: string): boolean;
}

export class ReadingHistory {
  private entry: Entry | undefined;
  private revision = 0;
  private disposed = false;
  private restoring: Promise<void> | undefined;
  private rollback: { entry: Entry; finish(): void } | undefined;
  private previousScrollRestoration: ScrollRestoration | undefined;
  private readonly departures = new Map<number, string>();

  public constructor(
    private readonly window: Window,
    private readonly book: string,
    private readonly callbacks: ReadingHistoryCallbacks,
  ) {}

  private parse(state: unknown): Entry | undefined {
    if (!state || typeof state !== "object") return;
    const entry = (state as Record<string, unknown>)[READING_HISTORY_KEY] as Partial<Entry> | undefined;
    if (entry?.version !== 1 || entry.book !== this.book ||
      typeof entry.session !== "string" || !entry.session ||
      !Number.isSafeInteger(entry.index) || entry.index! < 0 ||
      typeof entry.cfi !== "string" || !entry.cfi.startsWith("epubcfi(") || entry.cfi.length > 16_384) return;
    return entry as Entry;
  }

  public get resumeCfi(): string | undefined {
    const entry = this.parse(this.window.history.state);
    if (!entry) return;
    this.loadDepartures(entry.session);
    return this.departures.get(entry.index) ?? entry.cfi;
  }

  public start(cfi: string): void {
    if (this.entry || this.disposed) return;
    this.entry = this.parse(this.window.history.state) ?? {
      version: 1, book: this.book, session: this.window.crypto.randomUUID(), index: 0, cfi,
    };
    try {
      this.replace({ ...this.entry, cfi });
    } catch (error) {
      this.entry = undefined;
      this.callbacks.report(error);
      return;
    }
    this.previousScrollRestoration = this.window.history.scrollRestoration;
    this.window.history.scrollRestoration = "manual";
    this.window.addEventListener("popstate", this.onPopState);
    this.window.addEventListener("pagehide", this.onPageHide);
    this.window.addEventListener("pageshow", this.onPageShow);
  }

  private owns(entry: Entry): boolean {
    const current = this.parse(this.window.history.state);
    return current?.session === entry.session && current.index === entry.index;
  }

  private state(entry: Entry): Record<string, unknown> {
    const state: unknown = this.window.history.state;
    return { ...(state && typeof state === "object" ? state : {}), [READING_HISTORY_KEY]: entry };
  }

  private replace(entry: Entry): void {
    this.window.history.replaceState(this.state(entry), "");
    this.entry = entry;
    if (this.departures.delete(entry.index)) this.saveDepartures();
  }

  /** Called on settled ordinary reading, never on UI snapshots or reflow. */
  public update(cfi = this.callbacks.read()): void {
    if (!cfi || !this.entry || this.disposed || this.restoring || !this.owns(this.entry)) return;
    try {
      if (this.entry.cfi === cfi) return;
      this.replace({ ...this.entry, cfi });
    } catch (error) {
      this.callbacks.report(error);
    }
  }

  /** A jump only pushes after its owned content load has committed. */
  public beginJump(): (() => void) | undefined {
    if (!this.entry || this.disposed || this.restoring || !this.owns(this.entry)) return;
    this.update();
    const origin = this.entry;
    const revision = ++this.revision;
    return () => {
      if (this.disposed || revision !== this.revision || !this.owns(origin)) return;
      try {
        const cfi = this.callbacks.read();
        if (!cfi || this.callbacks.equal(origin.cfi, cfi)) return;
        const target: Entry = { ...origin, index: origin.index + 1, cfi };
        this.window.history.pushState(this.state(target), "");
        this.entry = target;
        for (const index of this.departures.keys()) {
          if (index >= target.index) this.departures.delete(index);
        }
        this.saveDepartures();
      } catch (error) {
        this.callbacks.report(error);
      }
    };
  }

  public async settled(): Promise<void> {
    while (this.restoring && !this.disposed) await this.restoring;
  }

  private releaseScrollRestoration(): void {
    if (this.previousScrollRestoration !== undefined && this.window.history.scrollRestoration === "manual") {
      this.window.history.scrollRestoration = this.previousScrollRestoration;
    }
  }

  private readonly onPageHide = (): void => {
    this.update();
    this.releaseScrollRestoration();
  };

  private readonly onPageShow = (): void => {
    if (!this.disposed && this.entry && this.owns(this.entry)) this.window.history.scrollRestoration = "manual";
  };

  private readonly onPopState = (event: PopStateEvent): void => {
    const target = this.parse(event.state);
    const source = this.entry;
    const revision = ++this.revision;
    this.callbacks.cancel();
    if (!target || !source || target.session !== source.session) {
      // Do not coerce foreign/router entries into reading locations.
      this.rollback?.finish();
      this.rollback = undefined;
      this.releaseScrollRestoration();
      return;
    }
    this.window.history.scrollRestoration = "manual";
    if (this.rollback?.entry.index === target.index) {
      this.rollback.finish();
      this.rollback = undefined;
      this.replace(this.entry!);
      return;
    }
    this.rollback?.finish();
    this.rollback = undefined;
    // A native Back can arrive before scrollend. Remember the departure without
    // overwriting the entry the browser has *already* selected. Persist only
    // these traversal-time corrections, so refresh preserves the forward stack.
    if (!this.restoring) {
      const cfi = this.callbacks.read();
      if (cfi && source.cfi !== cfi) {
        this.entry = { ...source, cfi };
        this.departures.set(source.index, cfi);
        this.saveDepartures();
      }
    }
    const destination = { ...target, cfi: this.departures.get(target.index) ?? target.cfi };
    const restore = async (): Promise<void> => {
      let success = false;
      try {
        success = await this.callbacks.restore(destination.cfi);
      } catch (error) {
        if (revision === this.revision) this.callbacks.report(error);
      }
      if (this.disposed || revision !== this.revision || !this.owns(target)) return;
      if (success) {
        this.replace(destination);
      } else {
        const delta = this.entry!.index - target.index;
        if (delta === 0) {
          this.replace(this.entry!);
          return;
        }
        await new Promise<void>(resolve => {
          this.rollback = { entry: this.entry!, finish: resolve };
          this.window.history.go(delta);
        });
      }
    };
    const pending = restore().catch(error => this.callbacks.report(error));
    this.restoring = pending;
    void pending.finally(() => {
      if (this.restoring === pending) this.restoring = undefined;
    });
  };

  private storageKey(session: string): string {
    return `ambra:reading-departures:${session}`;
  }

  private loadDepartures(session: string): void {
    try {
      const value: unknown = JSON.parse(this.window.sessionStorage.getItem(this.storageKey(session)) ?? "[]");
      if (!Array.isArray(value)) return;
      for (const item of value) {
        if (Array.isArray(item) && Number.isSafeInteger(item[0]) && item[0] >= 0 &&
          typeof item[1] === "string" && item[1].startsWith("epubcfi(") && item[1].length <= 16_384) {
          this.departures.set(item[0], item[1]);
        }
      }
    } catch (error) {
      this.callbacks.report(error);
    }
  }

  private saveDepartures(): void {
    if (!this.entry) return;
    try {
      const key = this.storageKey(this.entry.session);
      if (this.departures.size) this.window.sessionStorage.setItem(key, JSON.stringify([...this.departures]));
      else this.window.sessionStorage.removeItem(key);
    } catch (error) {
      this.callbacks.report(error);
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.update();
    this.disposed = true;
    ++this.revision;
    this.rollback?.finish();
    this.rollback = undefined;
    this.window.removeEventListener("popstate", this.onPopState);
    this.window.removeEventListener("pagehide", this.onPageHide);
    this.window.removeEventListener("pageshow", this.onPageShow);
    this.releaseScrollRestoration();
  }
}
