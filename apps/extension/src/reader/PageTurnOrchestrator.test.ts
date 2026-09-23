import { afterEach, expect, it, vi } from "vitest";
import { PaginatedContentHost } from "@ambra/engine";
import { PageTurnAnimator } from "./PageTurnAnimator.js";
import { PageTurnOrchestrator } from "./PageTurnOrchestrator.js";

afterEach(() => {
  document.body.replaceChildren();
});

it("leaves both hosts owned by the caller until it commits the replacement", async () => {
  const context = {
    containerEl: () => document.body,
    width: () => 800,
    height: () => 800,
    pageTheme: () => "white" as const,
    pageTurnAnimationStyle: () => "none" as const,
    setAnimatingPageTurn: vi.fn(),
    notify: vi.fn(),
  };
  const oldHost = new PaginatedContentHost(800, 800);
  const newHost = new PaginatedContentHost(800, 800);
  document.body.append(oldHost.element, newHost.element);
  const dispose = vi.spyOn(oldHost, "dispose");
  await new PageTurnOrchestrator(context, new PageTurnAnimator(context)).animatePageTurn(
    oldHost,
    newHost,
    1,
    { title: "Book", chapterLabel: "Chapter", outgoingPage: 1, incomingPage: 2 },
  );
  expect(dispose).not.toHaveBeenCalled();
  expect(oldHost.element.isConnected).toBe(true);
  oldHost.dispose();
  newHost.dispose();
});

it.each(["slide", "rotate", "scroll"] as const)(
  "restores the current host and removes %s furniture when animation fails",
  async (style) => {
    const context = {
      containerEl: () => document.body,
      width: () => 800,
      height: () => 800,
      pageTheme: () => "white" as const,
      pageTurnAnimationStyle: () => style,
      setAnimatingPageTurn: vi.fn(),
      notify: vi.fn(),
    };
    const animator = new PageTurnAnimator(context);
    vi.spyOn(animator, "playPageTurnAnimation").mockRejectedValue(new Error("animation failed"));
    vi.spyOn(animator, "playScrollTurn").mockRejectedValue(new Error("animation failed"));
    const oldHost = new PaginatedContentHost(800, 800);
    const newHost = new PaginatedContentHost(800, 800);
    document.body.append(oldHost.element, newHost.element);
    await expect(
      new PageTurnOrchestrator(context, animator).animatePageTurn(oldHost, newHost, 1, {
        title: "Book",
        chapterLabel: "Chapter",
        outgoingPage: 1,
        incomingPage: 2,
      }),
    ).rejects.toThrow("animation failed");
    expect(Array.from(document.body.children)).toEqual([oldHost.element, newHost.element]);
    expect(oldHost.element.style.transform).toBe("");
    expect(oldHost.element.style.transition).toBe("");
    expect(context.setAnimatingPageTurn).toHaveBeenLastCalledWith(false);
    oldHost.dispose();
    newHost.dispose();
  },
);
