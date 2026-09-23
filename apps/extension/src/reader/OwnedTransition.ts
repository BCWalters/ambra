/** Wait for one transform transition, with one owner for all completion paths.
 * Cancelling also cancels the queued RAF: a late frame must not restyle a host
 * after the timeout or a newer navigation has restored it. */
export function runOwnedTransition(
  element: HTMLElement | undefined,
  apply: () => void,
  timeout: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown): void => {
      if (settled) return;
      settled = true;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      element?.removeEventListener("transitionend", onEnd);
      signal?.removeEventListener("abort", onAbort);
      if (error !== undefined) reject(error);
      else resolve();
    };
    const onEnd = (event: TransitionEvent): void => {
      if (event.target === element && event.propertyName === "transform") finish();
    };
    const onAbort = (): void => finish();
    element?.addEventListener("transitionend", onEnd);
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => finish(), timeout);
    const frame = requestAnimationFrame(() => {
      if (settled) return;
      try {
        apply();
      } catch (error) {
        finish(error);
      }
    });
  });
}
