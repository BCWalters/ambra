export class PageTurnGestureCancelled extends Error {
  public constructor() {
    super("Page turn returned to its starting position.");
  }
}

export interface ControlledPageTurnDiagnostic {
  phase:
    | "down"
    | "move"
    | "start"
    | "reset"
    | "up"
    | "prepared"
    | "decision"
    | "settled"
    | "cancel"
    | "abort"
    | "ignored"
    | "finished";
  inputTimeMs?: number;
  elapsedMs?: number;
  source?: "reader" | "publication";
  stage?: "preparing" | "preview" | "renderer" | "reduced";
  dxPx?: number;
  dyPx?: number;
  progressPct?: number;
  recentPx?: number;
  swipeMs?: number;
  ageMs?: number;
  reversePx?: number;
  started?: boolean;
  buttons?: number;
  pointerId?: number;
  widthPx?: number;
  side?: -1 | 1;
  thresholdPct?: number;
  flickMinPx?: number;
  windowMs?: number;
  graceMs?: number;
  jitterPx?: number;
  startMinPx?: number;
  verticalLimitPx?: number;
  reset?: "idle" | "reversal";
  resetPx?: number;
  reason?:
    | "busy"
    | "disposed"
    | "interactive-target"
    | "selection"
    | "outside-edge"
    | "dismissed-selection"
    | "buttons-lost"
    | "pointercancel"
    | "escape"
    | "blur"
    | "hidden"
    | "abort"
    | "paint-error"
    | "dispose";
  slowPass?: boolean;
  distancePass?: boolean;
  releasePass?: boolean;
  flickPass?: boolean;
  commit?: boolean;
  cancelled?: boolean;
  tap?: boolean;
  release?: "pointerup" | "buttons-cleared";
  aborted?: boolean;
  reducedMotion?: boolean;
  dismissedUi?: boolean;
  spineIndex?: number;
  pageIndex?: number;
}

/** Gesture intent is independent of the style's renderer and host adoption. */
export class ControlledPageTurn {
  private progress = 0;
  private latestX: number;
  private latestY: number;
  private latestTime: number;
  private lastMoveDiagnosticAt = -Infinity;
  private lastMotionTime: number;
  private flickPeakX: number;
  private flickSamples: { x: number; time: number }[];
  private readonly flickWindowMs: number;
  private readonly flickReleaseGraceMs: number;
  private readonly flickReverseTolerance: number;
  private released = false;
  private cancelled = false;
  private started = false;
  private paint: ((progress: number) => void) | undefined;
  private preparationPaint: ((progress: number) => void) | undefined;
  private restorePreparation: (() => void) | undefined;
  private release: (() => void) | undefined;
  private paintError: unknown;
  private readonly shield: HTMLDivElement;
  private readonly documents: Document[];
  private readonly parentDocument: Document;

  public constructor(
    private readonly start: PointerEvent,
    doc: Document,
    private readonly side: -1 | 1,
    private readonly width: number,
    private readonly begin: () => void,
    private readonly tap: (event: PointerEvent) => void,
    relatedDocuments: readonly Document[] = [],
    private readonly commitThreshold = 0.4,
    private readonly diagnostic?: (event: ControlledPageTurnDiagnostic) => void,
  ) {
    this.latestX = start.screenX;
    this.latestY = start.screenY;
    this.latestTime = start.timeStamp;
    this.lastMotionTime = start.timeStamp;
    this.flickPeakX = start.screenX;
    this.flickSamples = [{ x: start.screenX, time: start.timeStamp }];
    const mouse = start.pointerType === "mouse";
    this.flickWindowMs = mouse ? 400 : 250;
    this.flickReleaseGraceMs = mouse ? 250 : 100;
    this.flickReverseTolerance = mouse ? 8 : 0;
    const parentDocument = doc.defaultView?.frameElement?.ownerDocument ?? doc;
    this.parentDocument = parentDocument;
    this.documents = [...new Set([doc, parentDocument, ...relatedDocuments])];
    // A parent-owned shield keeps mouse input stable across publication frames.
    // Touch's implicit capture continues to deliver to the original document.
    this.shield = parentDocument.createElement("div");
    Object.assign(this.shield.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      cursor: "grabbing",
      touchAction: "none",
    });
    this.shield.setAttribute("aria-hidden", "true");
    this.shield.dataset.ambraPageTurnInput = "";
    parentDocument.body.append(this.shield);
    for (const document of this.documents) {
      document.addEventListener("pointermove", this.move, { passive: false });
      document.addEventListener("pointerup", this.up, true);
      document.addEventListener("pointercancel", this.cancel);
      document.addEventListener("keydown", this.key);
    }
    parentDocument.defaultView?.addEventListener("blur", this.focusLost);
    parentDocument.addEventListener("visibilitychange", this.visibilityChanged);
    this.emit("down", start, {
      pointerId: start.pointerId,
      widthPx: width,
      side,
      thresholdPct: commitThreshold * 100,
      flickMinPx: width * 0.05,
      windowMs: this.flickWindowMs,
      graceMs: this.flickReleaseGraceMs,
      jitterPx: this.flickReverseTolerance,
      startMinPx: 8,
      verticalLimitPx: 40,
    });
  }

  private emit(
    phase: ControlledPageTurnDiagnostic["phase"],
    event?: PointerEvent,
    fields: Omit<ControlledPageTurnDiagnostic, "phase"> = {},
  ): void {
    if (this.start.pointerType !== "mouse" || !this.diagnostic) return;
    const round = (value: number) => Math.round(value * 1000) / 1000;
    const source =
      event?.currentTarget === this.parentDocument
        ? "reader"
        : this.documents.some((doc) => event?.currentTarget === doc)
          ? "publication"
          : undefined;
    this.diagnostic({
      phase,
      inputTimeMs: round(this.latestTime),
      ...(source ? { source } : {}),
      ...(phase === "down"
        ? {}
        : {
            elapsedMs: round(this.latestTime - this.start.timeStamp),
            dxPx: round(this.latestX - this.start.screenX),
            dyPx: round(this.latestY - this.start.screenY),
            progressPct: round(this.progress * 100),
            recentPx: round(this.side * (this.flickSamples[0]!.x - this.flickPeakX)),
            swipeMs: round(this.lastMotionTime - this.flickSamples[0]!.time),
            ageMs: round(this.latestTime - this.lastMotionTime),
            reversePx: round(this.side * (this.latestX - this.flickPeakX)),
            started: this.started,
            stage: this.paint ? "renderer" : this.preparationPaint ? "preview" : "preparing",
          }),
      ...(event ? { buttons: event.buttons } : {}),
      ...fields,
    });
  }

  private move = (event: PointerEvent): void => {
    if (event.pointerId !== this.start.pointerId || this.released) return;
    if (event.pointerType === "mouse" && event.buttons === 0) {
      if (this.started && !this.parentDocument.hidden && this.parentDocument.hasFocus()) {
        // A buttons-cleared move can precede pointerup; don't count free mouse movement as drag travel.
        this.finishRelease(event, false);
      } else {
        this.dispose("buttons-lost");
      }
      return;
    }
    this.samplePosition(event);
    const now = performance.now();
    if (now - this.lastMoveDiagnosticAt >= 80) {
      this.lastMoveDiagnosticAt = now;
      this.emit("move", event);
    }
    if (this.started) {
      event.preventDefault();
      try {
        (this.paint ?? this.preparationPaint)?.(this.progress);
      } catch (error) {
        this.paintError = error;
        this.dispose("paint-error");
      }
    }
  };

  private samplePosition(event: PointerEvent): void {
    const reversal = this.side * (event.screenX - this.flickPeakX);
    let reset: "idle" | "reversal" | undefined;
    if (reversal > this.flickReverseTolerance) {
      reset = "reversal";
      this.flickSamples = [{ x: event.screenX, time: event.timeStamp }];
      this.flickPeakX = event.screenX;
      this.lastMotionTime = event.timeStamp;
    } else if (reversal < 0) {
      if (event.timeStamp - this.lastMotionTime > this.flickWindowMs) {
        reset = "idle";
        // An idle hold is not part of the next swipe's timing.
        this.flickSamples = [{ x: this.latestX, time: event.timeStamp }];
      }
      this.flickSamples.push({ x: event.screenX, time: event.timeStamp });
      const cutoff = event.timeStamp - this.flickWindowMs;
      while (this.flickSamples.length > 1 && this.flickSamples[1]!.time <= cutoff) {
        this.flickSamples.shift();
      }
      const first = this.flickSamples[0]!;
      const next = this.flickSamples[1];
      if (next && first.time < cutoff) {
        const fraction = (cutoff - first.time) / (next.time - first.time);
        this.flickSamples[0] = { x: first.x + (next.x - first.x) * fraction, time: cutoff };
      }
      this.flickPeakX = event.screenX;
      this.lastMotionTime = event.timeStamp;
    }
    this.latestX = event.screenX;
    this.latestY = event.screenY;
    this.latestTime = event.timeStamp;
    const travel = this.side * (this.start.screenX - event.screenX);
    const recentTravel = this.side * (this.flickSamples[0]!.x - event.screenX);
    this.progress = Math.max(0, Math.min(1, travel / this.width));
    if (reset) this.emit("reset", event, { reset, resetPx: Math.abs(reversal) });
    if (
      !this.started &&
      Math.max(travel, recentTravel) >= 8 &&
      Math.abs(event.screenY - this.start.screenY) < 40
    ) {
      this.started = true;
      this.emit("start", event);
      this.begin();
    }
  }

  private up = (event: PointerEvent): void => {
    this.finishRelease(event, true);
  };

  private finishRelease(event: PointerEvent, sampleFinalPosition: boolean): void {
    if (event.pointerId !== this.start.pointerId || this.released) return;
    event.preventDefault();
    if (sampleFinalPosition) this.samplePosition(event);
    else this.latestTime = event.timeStamp;
    this.released = true;
    this.emit("up", event, {
      tap: !this.started,
      release: sampleFinalPosition ? "pointerup" : "buttons-cleared",
    });
    if (!this.started) this.tap(event);
    this.release?.();
    this.detach();
  }

  private cancel = (event: PointerEvent): void => {
    if (event.pointerId === this.start.pointerId) this.dispose("pointercancel");
  };

  private key = (event: KeyboardEvent): void => {
    if (event.key === "Escape") this.dispose("escape");
  };

  private focusLost = (): void => {
    if (!this.parentDocument.hasFocus()) this.dispose("blur");
  };

  private visibilityChanged = (): void => {
    if (this.parentDocument.hidden) this.dispose("hidden");
  };

  public previewWhilePreparing(paint: (progress: number) => void, restore: () => void): void {
    this.stopPreparationPreview();
    this.preparationPaint = paint;
    this.restorePreparation = restore;
  }

  public stopPreparationPreview(): void {
    this.preparationPaint = undefined;
    const restore = this.restorePreparation;
    this.restorePreparation = undefined;
    restore?.();
  }

  public async play(
    paint: (progress: number) => void,
    signal?: AbortSignal,
    reducedMotion = false,
  ): Promise<void> {
    this.stopPreparationPreview();
    this.paint = reducedMotion ? undefined : paint;
    const abort = () => {
      this.emit("abort", undefined, { aborted: true });
      this.dispose("abort");
    };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      this.paint?.(this.progress);
      this.emit("prepared", undefined, {
        reducedMotion,
        stage: reducedMotion ? "reduced" : "renderer",
      });
      if (signal?.aborted) this.dispose("abort");
      if (!this.released)
        await new Promise<void>((resolve) => {
          this.release = resolve;
        });
      if (signal?.aborted) return;
      if (this.paintError !== undefined) throw this.paintError;
      const recentTravel = this.side * (this.flickSamples[0]!.x - this.flickPeakX);
      const distancePass = recentTravel >= this.width * 0.05;
      const releasePass = this.latestTime - this.lastMotionTime <= this.flickReleaseGraceMs;
      const flick = distancePass && releasePass;
      const slowPass = this.progress >= this.commitThreshold;
      const commit = !this.cancelled && (slowPass || flick);
      this.emit("decision", undefined, {
        slowPass,
        distancePass,
        releasePass,
        flickPass: flick,
        cancelled: this.cancelled,
        commit,
      });
      const from = this.progress;
      const to = commit ? 1 : 0;
      if (!reducedMotion) {
        const duration = Math.max(100, Math.abs(to - from) * 540);
        await new Promise<void>((resolve, reject) => {
          const start = performance.now();
          let frame = 0;
          const stop = () => {
            cancelAnimationFrame(frame);
            signal?.removeEventListener("abort", stop);
            resolve();
          };
          const tick = (now: number) => {
            const t = Math.min(1, (now - start) / duration);
            try {
              paint(from + (to - from) * t * t * (3 - 2 * t));
            } catch (error) {
              cancelAnimationFrame(frame);
              signal?.removeEventListener("abort", stop);
              reject(error);
              return;
            }
            if (t < 1) frame = requestAnimationFrame(tick);
            else frame = requestAnimationFrame(stop);
          };
          signal?.addEventListener("abort", stop, { once: true });
          frame = requestAnimationFrame(tick);
        });
      }
      this.emit("settled", undefined, { commit, aborted: signal?.aborted ?? false });
      if (!commit) throw new PageTurnGestureCancelled();
    } finally {
      signal?.removeEventListener("abort", abort);
      this.paint = undefined;
      this.detach();
    }
  }

  private detach(): void {
    this.parentDocument.defaultView?.removeEventListener("blur", this.focusLost);
    this.parentDocument.removeEventListener("visibilitychange", this.visibilityChanged);
    for (const document of this.documents) {
      document.removeEventListener("pointermove", this.move);
      document.removeEventListener("pointerup", this.up, true);
      document.removeEventListener("pointercancel", this.cancel);
      document.removeEventListener("keydown", this.key);
    }
    this.shield.remove();
  }

  public dispose(reason: ControlledPageTurnDiagnostic["reason"] = "dispose"): void {
    this.stopPreparationPreview();
    if (this.released) return;
    this.cancelled = true;
    this.released = true;
    this.emit("cancel", undefined, { reason, cancelled: true });
    this.release?.();
    this.detach();
  }
}
