import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EpubInspectionSession } from "../reader/EpubInspectionSession.js";
import { useLibraryInspector } from "./useLibraryInspector.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function session(title: string) {
  const methods = { getEpubInspectionData: vi.fn().mockReturnValue({ title }), dispose: vi.fn() };
  return { methods, value: methods as unknown as EpubInspectionSession };
}

describe("useLibraryInspector", () => {
  let root: Root;
  let container: HTMLDivElement;
  let mounted: boolean;
  let latest: ReturnType<typeof useLibraryInspector>;
  const openSession = vi.fn<(id: string) => Promise<EpubInspectionSession>>();

  function Harness({ bookId }: { bookId: string | undefined }) {
    latest = useLibraryInspector(bookId, openSession);
    return null;
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    openSession.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    mounted = true;
  });
  afterEach(() => {
    if (mounted) act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
  async function render(bookId = "a") {
    await act(async () => { root.render(<Harness bookId={bookId} />); });
  }

  it("disposes a late session after closing instead of reopening the inspector", async () => {
    const pending = deferred<EpubInspectionSession>();
    const late = session("Late");
    openSession.mockReturnValue(pending.promise);
    await render();
    act(() => latest.open());
    expect(latest.isOpen).toBe(true);
    act(() => latest.close());
    await act(async () => { pending.resolve(late.value); });
    expect(late.methods.dispose).toHaveBeenCalledOnce();
    expect(latest.isOpen).toBe(false);
    expect(latest.session).toBeUndefined();
  });

  it("keeps the newest request and disposes both late and replaced sessions", async () => {
    const pending = deferred<EpubInspectionSession>();
    const older = session("Older");
    const newer = session("Newer");
    const replacement = session("Replacement");
    openSession.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(newer.value)
      .mockResolvedValueOnce(replacement.value);
    await render();
    act(() => latest.open());
    await act(async () => latest.open());
    await act(async () => { pending.resolve(older.value); });
    expect(latest.data?.title).toBe("Newer");
    expect(older.methods.dispose).toHaveBeenCalledOnce();
    await act(async () => latest.open());
    expect(newer.methods.dispose).toHaveBeenCalledOnce();
    expect(latest.data?.title).toBe("Replacement");
    act(() => latest.close());
    expect(replacement.methods.dispose).toHaveBeenCalledOnce();
  });

  it("invalidates selection changes and does not reopen when an old selection returns", async () => {
    const pending = deferred<EpubInspectionSession>();
    const old = session("A");
    openSession.mockReturnValue(pending.promise);
    await render("a");
    act(() => latest.open());
    await render("b");
    await act(async () => { pending.resolve(old.value); });
    expect(old.methods.dispose).toHaveBeenCalledOnce();
    expect(latest.isOpen).toBe(false);
    expect(latest.data).toBeUndefined();
    await render("a");
    expect(latest.isOpen).toBe(false);
    expect(openSession).toHaveBeenCalledOnce();
  });

  it("reports current opening failures and allows retry", async () => {
    const ready = session("Recovered");
    openSession.mockRejectedValueOnce(new Error("Missing book file")).mockResolvedValueOnce(ready.value);
    await render();
    await act(async () => latest.open());
    expect(latest.error).toBe("Missing book file");
    expect(latest.isOpen).toBe(false);
    await act(async () => latest.open());
    expect(latest.error).toBeUndefined();
    expect(latest.data?.title).toBe("Recovered");
  });

  it("disposes a session whose data assembly fails", async () => {
    const broken = session("Broken");
    broken.methods.getEpubInspectionData.mockImplementation(() => { throw new Error("Bad metadata"); });
    openSession.mockResolvedValue(broken.value);
    await render();
    await act(async () => latest.open());
    expect(latest.error).toBe("Bad metadata");
    expect(broken.methods.dispose).toHaveBeenCalledOnce();
    act(() => latest.close());
    expect(broken.methods.dispose).toHaveBeenCalledOnce();
  });

  it("ignores late failures and disposes sessions resolving after unmount", async () => {
    const failure = deferred<EpubInspectionSession>();
    const pending = deferred<EpubInspectionSession>();
    const late = session("Late");
    openSession.mockReturnValueOnce(failure.promise).mockReturnValueOnce(pending.promise);
    await render();
    act(() => latest.open());
    act(() => latest.open());
    await act(async () => { failure.reject(new Error("Obsolete failure")); });
    expect(latest.error).toBeUndefined();
    act(() => root.unmount());
    mounted = false;
    await act(async () => { pending.resolve(late.value); });
    expect(late.methods.dispose).toHaveBeenCalledOnce();
  });
});
