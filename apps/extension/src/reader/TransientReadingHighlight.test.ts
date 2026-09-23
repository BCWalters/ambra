import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applyNavigationTargetRange } from "./HighlightRenderer.js";
import { TransientReadingHighlight } from "./TransientReadingHighlight.js";

vi.mock("./HighlightRenderer.js", () => ({ applyNavigationTargetRange: vi.fn() }));

let spotlight: TransientReadingHighlight;
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(applyNavigationTargetRange).mockClear();
  spotlight = new TransientReadingHighlight();
});
afterEach(() => {
  spotlight.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function paragraph(text = "The selected passage", owner = document) {
  const element = owner.createElement("p");
  element.textContent = text;
  owner.body.append(element);
  return element;
}

it("highlights the selected element's text for four seconds without modifying its DOM", () => {
  const element = paragraph();
  const original = element.innerHTML;
  spotlight.show(element);
  expect(vi.mocked(applyNavigationTargetRange).mock.calls[0]![1]!.toString()).toBe(element.textContent);
  expect(element.innerHTML).toBe(original);
  vi.advanceTimersByTime(3999);
  expect(applyNavigationTargetRange).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1);
  expect(applyNavigationTargetRange).toHaveBeenLastCalledWith(document);
});

it("clears an earlier document and gives a new destination its own full lifetime", () => {
  spotlight.show(paragraph());
  vi.advanceTimersByTime(3000);
  const next = document.implementation.createHTMLDocument();
  spotlight.show(paragraph("Next", next));
  expect(vi.mocked(applyNavigationTargetRange).mock.calls[1]).toEqual([document]);
  vi.advanceTimersByTime(1000);
  expect(applyNavigationTargetRange).toHaveBeenCalledTimes(3);
  vi.advanceTimersByTime(3000);
  expect(applyNavigationTargetRange).toHaveBeenLastCalledWith(next);
});

it("clears immediately on navigation/disposal and cancels the expiry timer", () => {
  spotlight.show(paragraph());
  spotlight.clear();
  expect(applyNavigationTargetRange).toHaveBeenCalledTimes(2);
  vi.runAllTimers();
  spotlight.clear();
  expect(applyNavigationTargetRange).toHaveBeenCalledTimes(2);
});

it("clears when its reading document becomes hidden", () => {
  spotlight.show(paragraph());
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  document.dispatchEvent(new Event("visibilitychange"));
  expect(applyNavigationTargetRange).toHaveBeenLastCalledWith(document);
  expect(vi.getTimerCount()).toBe(0);
});

it("does not create an empty spotlight for an image-only element", () => {
  spotlight.show(document.createElement("img"));
  expect(applyNavigationTargetRange).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
