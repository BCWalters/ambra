import { afterEach, expect, it, vi } from "vitest";
import { PaginatedContentHost, SpreadPaginatedHost } from "@ambra/engine";
import { PageTurnAnimator } from "./PageTurnAnimator.js";
import { PageTurnOrchestrator } from "./PageTurnOrchestrator.js";
import { CurledPageTurn } from "./CurledPageTurn.js";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  document.body.removeAttribute("style");
});

it.each([
  { fails: false, rtl: false }, { fails: true, rtl: false },
  { fails: false, rtl: true }, { fails: true, rtl: true },
])(
  "clips incoming content away from the canonical stationary column and restores it (failure=$fails, rtl=$rtl)",
  async ({ fails, rtl }) => {
    const context = {
      containerEl: () => document.body,
      width: () => 1547,
      height: () => 878,
      pageTheme: () => "white" as const,
      pageTurnAnimationStyle: () => "rotate" as const,
      rtl: () => rtl,
      setAnimatingPageTurn: vi.fn(),
      notify: vi.fn(),
    };
    const animator = new PageTurnAnimator(context);
    vi.spyOn(animator, "shouldSkipPageTurnAnimation").mockReturnValue(false);
    const oldHost = new SpreadPaginatedHost(1547, 878);
    const newHost = new SpreadPaginatedHost(1547, 878);
    document.body.append(oldHost.element, newHost.element);
    newHost.gutterElement.style.opacity = "0.8";
    newHost.element.style.opacity = "0.7";
    newHost.element.style.clipPath = "inset(1px)";
    vi.spyOn(newHost.element, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1547, 878));
    vi.spyOn(oldHost.columnElement(rtl ? "left" : "right"), "getBoundingClientRect")
      .mockReturnValue(new DOMRect(rtl ? 0 : 793.5, 0, 753.5, 878));
    vi.spyOn(CurledPageTurn.prototype, "prepare").mockImplementation(async () => {
      expect(newHost.element.style.opacity).toBe("0");
      expect(oldHost.gutterElement.style.opacity).toBe("");
      expect(newHost.gutterElement.style.opacity).toBe("0");
      const furniture = document.querySelectorAll<HTMLElement>("[data-ambra-turn-furniture]");
      expect(furniture).toHaveLength(4);
      for (const overlay of furniture) expect(overlay.style.opacity).toBe("0");
      if (fails) throw new Error("snapshot failed");
    });
    vi.spyOn(CurledPageTurn.prototype, "hide").mockImplementation(() => {});
    vi.spyOn(CurledPageTurn.prototype, "settle").mockImplementation(async () => {
      expect(newHost.element.style.opacity).toBe("0.7");
      expect(newHost.element.style.clipPath).toBe(rtl ? "inset(0 793.5px 0 0px)" : "inset(0 0px 0 793.5px)");
      expect(oldHost.element.style.zIndex).toBe("");
      expect(document.querySelectorAll("[data-ambra-turn-stationary-paper]")).toHaveLength(0);
    });
    const turn = new PageTurnOrchestrator(context, animator).animateSpreadTurn(
      oldHost,
      newHost,
      1,
      {
        title: "Book",
        outgoingChapterLabel: "Chapter",
        incomingChapterLabel: "Chapter",
        outgoingPrimaryPage: 1,
        outgoingSecondaryPage: 2,
        incomingPrimaryPage: 3,
        incomingSecondaryPage: 4,
      },
    );
    if (fails) await expect(turn).rejects.toThrow("snapshot failed");
    else await turn;
    expect(oldHost.gutterElement.style.opacity).toBe("");
    expect(newHost.gutterElement.style.opacity).toBe("0.8");
    expect(newHost.element.style.opacity).toBe("0.7");
    expect(newHost.element.style.clipPath).toBe("inset(1px)");
    expect(document.querySelectorAll("[data-ambra-turn-stationary-paper]")).toHaveLength(0);
    expect(document.querySelectorAll("[data-ambra-turn-furniture]")).toHaveLength(0);
    oldHost.dispose();
    newHost.dispose();
  },
);

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

it("reuses the single-page host with a separate destination capture and restores its styles", async () => {
  const context = {
    containerEl: () => document.body,
    width: () => 800,
    height: () => 800,
    pageTheme: () => "white" as const,
    pageTurnAnimationStyle: () => "rotate" as const,
    setAnimatingPageTurn: vi.fn(),
    notify: vi.fn(),
  };
  const animator = new PageTurnAnimator(context);
  vi.spyOn(animator, "shouldSkipPageTurnAnimation").mockReturnValue(false);
  const host = new PaginatedContentHost(800, 800);
  document.body.append(host.element);
  const capture = vi.fn(() => vi.fn());
  vi.spyOn(CurledPageTurn.prototype, "prepare").mockImplementation(async (front, back, side, _signal, destination, layout) => {
    expect(front.element).toBe(host.element);
    expect(front.capture).toBeUndefined();
    expect(back.capture).toBe(capture);
    expect(destination?.capture).toBe(capture);
    expect(layout).toBe("single");
    expect(side).toBe(1);
  });
  vi.spyOn(CurledPageTurn.prototype, "hide").mockImplementation(() => {});
  vi.spyOn(CurledPageTurn.prototype, "settle").mockResolvedValue();
  const dispose = vi.spyOn(host, "dispose");
  await new PageTurnOrchestrator(context, animator).animateReusablePageTurn(host, 1, {
    title: "Book", chapterLabel: "Chapter", outgoingPage: 4, incomingPage: 5,
  }, capture);
  expect(dispose).not.toHaveBeenCalled();
  expect(document.body.children).toHaveLength(1);
  expect(host.element.style.transform).toBe("");
  expect(context.setAnimatingPageTurn).toHaveBeenLastCalledWith(false);
  host.dispose();
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
    if (style === "rotate") {
      vi.spyOn(CurledPageTurn.prototype, "prepare").mockResolvedValue();
      vi.spyOn(CurledPageTurn.prototype, "settle").mockRejectedValue(new Error("animation failed"));
      vi.spyOn(CurledPageTurn.prototype, "hide").mockImplementation(() => {});
    }
    const oldHost = new PaginatedContentHost(800, 800);
    const newHost = new PaginatedContentHost(800, 800);
    document.body.append(oldHost.element, newHost.element);
    document.body.style.overflowX = "clip";
    document.body.style.overflowY = "auto";
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
    expect(document.body.style.overflowX).toBe("clip");
    expect(document.body.style.overflowY).toBe("auto");
    oldHost.dispose();
    newHost.dispose();
  },
);
