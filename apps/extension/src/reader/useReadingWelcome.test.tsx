import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LibraryDatabase } from "../library/LibraryDatabase.js";
import { useReadingWelcome } from "./useReadingWelcome.js";

vi.mock("../library/LibraryDatabase.js", () => ({ LibraryDatabase: { open: vi.fn() } }));
const db = { getReadingWelcomeVersion: vi.fn(), acknowledgeReadingWelcome: vi.fn(), close: vi.fn() };
const onOpen = vi.fn();
let root: Root;
let element: HTMLDivElement;
let welcome: ReturnType<typeof useReadingWelcome>;
function Harness({ successful = false, available = true }) {
  welcome = useReadingWelcome(successful, available, onOpen);
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  db.getReadingWelcomeVersion.mockResolvedValue(0);
  db.acknowledgeReadingWelcome.mockResolvedValue(undefined);
  vi.mocked(LibraryDatabase.open).mockResolvedValue(db as unknown as LibraryDatabase);
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});
afterEach(() => {
  act(() => root.unmount());
  element.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("does not touch storage or offer help during loading/errors, then waits for other modals", async () => {
  await act(async () => root.render(<Harness />));
  expect(LibraryDatabase.open).not.toHaveBeenCalled();
  expect(onOpen).not.toHaveBeenCalled();
  await act(async () => root.render(<Harness successful available={false} />));
  expect(onOpen).not.toHaveBeenCalled();
  await act(async () => root.render(<Harness successful />));
  expect(onOpen).toHaveBeenCalledOnce();
  expect(db.acknowledgeReadingWelcome).not.toHaveBeenCalled();
  await act(async () => welcome.acknowledge());
  await act(async () => root.render(<Harness successful />));
  expect(onOpen).toHaveBeenCalledOnce();
  expect(db.acknowledgeReadingWelcome).toHaveBeenCalledOnce();
});
it.each([1, 2])("does not repeat an acknowledged version %s", async version => {
  db.getReadingWelcomeVersion.mockResolvedValue(version);
  await act(async () => root.render(<Harness successful />));
  expect(onOpen).not.toHaveBeenCalled();
});
it("keeps reading available after a storage failure", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  db.getReadingWelcomeVersion.mockRejectedValue(new Error("unavailable"));
  db.acknowledgeReadingWelcome.mockRejectedValue(new Error("unavailable"));
  await act(async () => root.render(<Harness successful />));
  expect(onOpen).not.toHaveBeenCalled();
  await act(async () => welcome.acknowledge());
  expect(console.warn).toHaveBeenCalledTimes(2);
});
it("ignores an in-flight preference read after unmount", async () => {
  let resolve!: (version: number) => void;
  db.getReadingWelcomeVersion.mockReturnValue(new Promise<number>(done => { resolve = done; }));
  await act(async () => root.render(<Harness successful />));
  await act(async () => root.render(null));
  await act(async () => resolve(0));
  expect(onOpen).not.toHaveBeenCalled();
  expect(db.close).toHaveBeenCalledOnce();
});
