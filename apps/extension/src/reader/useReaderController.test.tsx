import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReaderController } from "./ReaderController.js";
import { prepareBookOpeningTransition } from "./BookOpeningTransition.js";
import { useReaderController, type UseReaderControllerResult } from "./useReaderController.js";
import type { LibraryDatabase } from "../library/LibraryDatabase.js";
import type { ReaderSnapshot } from "./ReaderTypes.js";
import type { Translate } from "../i18n/LocaleContext.js";

vi.mock("./ReaderController.js", () => ({ ReaderController: { open: vi.fn() } }));
vi.mock("./BookOpeningTransition.js", () => ({ prepareBookOpeningTransition: vi.fn() }));

let root: Root;
let element: HTMLDivElement;
let latest: UseReaderControllerResult;
let mounted: boolean;
const translate = ((key: string) => key) as Translate;

function Harness() {
  latest = useReaderController(translate);
  return null;
}
function MountedHarness() {
  latest = useReaderController(translate);
  return latest.snapshot ? <div ref={latest.contentHostRef} /> : null;
}
function deferred() {
  let resolve!: (controller: ReaderController) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<ReaderController>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function controller(title: string) {
  const snapshot = { title } as ReaderSnapshot;
  const methods = {
    snapshot: () => snapshot,
    subscribe: () => () => {},
    setTranslate: vi.fn(),
    setShortcutActions: vi.fn(),
    setShortcutPreferences: vi.fn(),
    setShortcutModalOpen: vi.fn(),
    setContentUiDismissal: vi.fn(),
    recordDiagnosticEvent: vi.fn(),
    recordDiagnosticSurfaces: vi.fn(),
    dispose: vi.fn(),
    flushProgress: vi.fn().mockResolvedValue(undefined),
    mount: vi.fn().mockResolvedValue(undefined),
    resize: vi.fn(),
    reportActionFailure: vi.fn(),
  };
  return { methods, value: methods as unknown as ReaderController, snapshot };
}
function library() {
  const close = vi.fn();
  return { close, value: { close } as unknown as LibraryDatabase };
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(ReaderController.open).mockReset();
  vi.mocked(prepareBookOpeningTransition).mockReset().mockReturnValue({
    reveal: vi.fn(),
    cancel: vi.fn(),
  });
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
  mounted = true;
  await act(async () => root.render(<Harness />));
});
afterEach(() => {
  if (mounted) act(() => root.unmount());
  element.remove();
  vi.unstubAllGlobals();
});

it("only adopts the latest requested book, disposing a slow obsolete open", async () => {
  const slow = deferred();
  const first = controller("first");
  const second = controller("second");
  vi.mocked(ReaderController.open)
    .mockReturnValueOnce(slow.promise)
    .mockResolvedValueOnce(second.value);
  const pending = latest.openBook(new ArrayBuffer(0), "first", library().value);
  await act(async () => latest.openBook(new ArrayBuffer(0), "second", library().value));
  expect(latest.snapshot).toBe(second.snapshot);
  await act(async () => {
    slow.resolve(first.value);
    await pending;
  });

  expect(first.methods.dispose).toHaveBeenCalledOnce();
  expect(second.methods.dispose).not.toHaveBeenCalled();
  expect(latest.snapshot).toBe(second.snapshot);
});

it("applies shortcut configuration supplied before opening, and updates the live controller", async () => {
    const opened = controller("configured");
    const actions = { searchBook: vi.fn(), showKeyboardShortcuts: vi.fn() };
    const preferences = { enabled: false };
    latest.setShortcutActions(actions);
    latest.setShortcutPreferences(preferences, "mac");
    latest.setShortcutModalOpen(true);
    vi.mocked(ReaderController.open).mockResolvedValue(opened.value);
    await act(async () => latest.openBook(new ArrayBuffer(0), "configured", library().value));
    expect(opened.methods.setShortcutActions).toHaveBeenCalledWith(actions);
    expect(opened.methods.setShortcutPreferences).toHaveBeenCalledWith(preferences, "mac");
    expect(opened.methods.setShortcutModalOpen).toHaveBeenCalledWith(true);
    latest.setShortcutModalOpen(false);
    expect(opened.methods.setShortcutModalOpen).toHaveBeenLastCalledWith(false);
});

it("routes diagnostics only to the currently owned reader", async () => {
  latest.recordDiagnosticEvent({ kind: "navigation", source: "details", fraction: 0.5 });
  const opened = controller("diagnostics");
  vi.mocked(ReaderController.open).mockResolvedValue(opened.value);
  await act(async () => latest.openBook(new ArrayBuffer(0), "diagnostics", library().value));
  latest.recordDiagnosticEvent({ kind: "navigation", source: "details", fraction: 0.5 });
  latest.recordDiagnosticSurfaces({ details: { open: true } });
  expect(opened.methods.recordDiagnosticEvent).toHaveBeenCalledExactlyOnceWith({
    kind: "navigation", source: "details", fraction: 0.5,
  });
  expect(opened.methods.recordDiagnosticSurfaces).toHaveBeenCalledWith({ details: { open: true } });
  act(() => root.unmount());
  mounted = false;
  latest.recordDiagnosticEvent({ kind: "navigation", source: "scrubber", fraction: 0.2 });
  expect(opened.methods.recordDiagnosticEvent).toHaveBeenCalledTimes(1);
});

it("disposes a controller that finishes opening after unmount", async () => {
  const slow = deferred();
  const opened = controller("late");
  vi.mocked(ReaderController.open).mockReturnValueOnce(slow.promise);
  const pending = latest.openBook(new ArrayBuffer(0), "late", library().value);
  act(() => root.unmount());
  mounted = false;
  slow.resolve(opened.value);
  await pending;
  expect(opened.methods.dispose).toHaveBeenCalledOnce();
});

it("caches UI dismissal before open, updates it live, and clears it without retaining a stale callback", async () => {
  const first = controller("first");
  const second = controller("second");
  const dismiss = vi.fn(() => true);
  const updated = vi.fn(() => false);
  latest.setContentUiDismissal(dismiss);
  vi.mocked(ReaderController.open).mockResolvedValueOnce(first.value).mockResolvedValueOnce(second.value);
  await act(async () => latest.openBook(new ArrayBuffer(0), "first", library().value));
  expect(first.methods.setContentUiDismissal).toHaveBeenCalledWith(dismiss);
  latest.setContentUiDismissal(updated);
  expect(first.methods.setContentUiDismissal).toHaveBeenLastCalledWith(updated);
  latest.setContentUiDismissal(undefined);
  expect(first.methods.setContentUiDismissal).toHaveBeenLastCalledWith(undefined);
  await act(async () => latest.openBook(new ArrayBuffer(0), "second", library().value));
  expect(second.methods.setContentUiDismissal).toHaveBeenCalledWith(undefined);
  act(() => root.unmount());
  mounted = false;
  latest.setContentUiDismissal(dismiss);
  expect(second.methods.setContentUiDismissal).toHaveBeenCalledTimes(1);
});

it("suppresses obsolete open failures but reports current failures and releases their connection", async () => {
  const slow = deferred();
  const firstLibrary = library();
  const secondLibrary = library();
  vi.mocked(ReaderController.open)
    .mockReturnValueOnce(slow.promise)
    .mockRejectedValueOnce(new Error("current failure"));
  const pending = latest.openBook(new ArrayBuffer(0), "first", firstLibrary.value);
  await expect(latest.openBook(new ArrayBuffer(0), "second", secondLibrary.value)).rejects.toThrow(
    "current failure",
  );
  slow.reject(new Error("obsolete failure"));
  await expect(pending).resolves.toBeUndefined();
  expect(firstLibrary.close).toHaveBeenCalledOnce();
  expect(secondLibrary.close).toHaveBeenCalledOnce();
});

it("flushes and disposes an adopted but unmounted controller", async () => {
  const opened = controller("active");
  vi.mocked(ReaderController.open).mockResolvedValueOnce(opened.value);
  await act(async () => latest.openBook(new ArrayBuffer(0), "active", library().value));
  act(() => root.unmount());
  mounted = false;
  expect(opened.methods.flushProgress).toHaveBeenCalledOnce();
  expect(opened.methods.dispose).toHaveBeenCalledOnce();
});

it("reveals the opening only after mount restores the reading position", async () => {
  const opened = controller("ready");
  let finish!: () => void;
  opened.methods.mount.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
  vi.mocked(ReaderController.open).mockResolvedValueOnce(opened.value);
  await act(async () => root.render(<MountedHarness />));
  await act(async () => latest.openBook(new ArrayBuffer(0), "ready", library().value));
  const opening = vi.mocked(prepareBookOpeningTransition).mock.results[0]!.value;
  expect(opening.reveal).not.toHaveBeenCalled();
  expect(opened.methods.mount).toHaveBeenCalledOnce();
  await act(async () => finish());
  expect(opening.reveal).toHaveBeenCalledOnce();
  act(() => root.unmount());
  mounted = false;
  expect(opening.cancel).toHaveBeenCalledOnce();
});

it("removes the opening cover and reports a failed mount", async () => {
  const opened = controller("failed");
  const error = new Error("Cannot mount book");
  opened.methods.mount.mockRejectedValue(error);
  vi.mocked(ReaderController.open).mockResolvedValueOnce(opened.value);
  await act(async () => root.render(<MountedHarness />));
  await act(async () => latest.openBook(new ArrayBuffer(0), "failed", library().value));
  const opening = vi.mocked(prepareBookOpeningTransition).mock.results[0]!.value;
  expect(opening.cancel).toHaveBeenCalledOnce();
  expect(opening.reveal).not.toHaveBeenCalled();
  expect(opened.methods.reportActionFailure).toHaveBeenCalledExactlyOnceWith(error);
});
