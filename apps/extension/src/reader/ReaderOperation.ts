/** One attempt to replace the visible host. Uncommitted resources belong to
 * the attempt, not to the controller; cancelling it never disposes that host. */
export class ReaderOperation {
  private readonly abortController = new AbortController();
  private readonly cleanups = new Set<() => void>();
  private settle!: () => void;
  public readonly settled = new Promise<void>((resolve) => {
    this.settle = resolve;
  });

  public get signal(): AbortSignal {
    return this.abortController.signal;
  }

  public check(): void {
    this.signal.throwIfAborted();
  }

  public own(cleanup: () => void): () => void {
    this.check();
    this.cleanups.add(cleanup);
    return () => this.cleanups.delete(cleanup);
  }

  public cancel(): void {
    if (this.signal.aborted) return;
    this.abortController.abort();
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups.clear();
    this.settle();
  }
}

/** A single authority for loads, turns and session teardown. */
export class ReaderOperations {
  public current: ReaderOperation | undefined;
  public disposed = false;

  public begin(): ReaderOperation {
    if (this.disposed) throw new DOMException("Reader disposed", "AbortError");
    this.current?.cancel();
    return (this.current = new ReaderOperation());
  }

  public owns(operation: ReaderOperation): boolean {
    return !this.disposed && this.current === operation && !operation.signal.aborted;
  }

  public finish(operation: ReaderOperation): void {
    if (this.current === operation) this.current = undefined;
    operation.cancel();
  }

  public dispose(): void {
    this.disposed = true;
    this.current?.cancel();
    this.current = undefined;
  }
}
