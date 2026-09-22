import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaginatedContentHost, SpreadPaginatedHost } from "@ambra/engine";
import type { PageTheme } from "@ambra/engine";
import { PageTurnAnimator, type PageTurnAnimatorContext } from "./PageTurnAnimator.js";

function makeContext(overrides: Partial<PageTurnAnimatorContext> = {}): PageTurnAnimatorContext {
  return {
    containerEl: () => document.body,
    height: () => 800,
    pageTheme: () => "white" as PageTheme,
    pageTurnAnimationStyle: () => "slide",
    ...overrides,
  };
}

/** A fake `matchMedia` — controls `prefersReducedMotion()`'s OS-level
 * check independently of `pageTurnAnimationStyle`. */
function stubMatchMedia(matches: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({ matches } as unknown as MediaQueryList),
  );
}

beforeEach(() => {
  stubMatchMedia(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("PageTurnAnimator", () => {
  it("mirrors RTL motion and hinges while preserving logical forward/backward", () => {
    const animator = new PageTurnAnimator(makeContext({ rtl: () => true, pageTurnAnimationStyle: () => "rotate" }));
    expect(animator.pageTurnPartialAmount(1, 0.5)).toBe(45);
    expect(animator.pageTurnPartialAmount(-1, 0.5)).toBe(-45);
    expect(animator.scrollDragEnterAmount(1, 0)).toBe(-100);
    const host = new SpreadPaginatedHost(1400, 800);
    host.setProgressionDirection("rtl");
    expect(animator.spreadColumnElement(host, 0)).toBe(host.columnElement("right"));
    expect(animator.spreadColumnElement(host, 1)).toBe(host.columnElement("left"));
    animator.stagePageTurn(host.element, host.columnElement("left"), 1);
    expect(host.columnElement("left").style.transformOrigin).toBe("right center");
    host.dispose();
  });
  describe("shouldSkipPageTurnAnimation()", () => {
    it("is false when a real style is chosen and the OS has no reduced-motion preference", () => {
      const animator = new PageTurnAnimator(makeContext({ pageTurnAnimationStyle: () => "rotate" }));
      expect(animator.shouldSkipPageTurnAnimation()).toBe(false);
    });

    it("is true when the reader explicitly chose 'none'", () => {
      const animator = new PageTurnAnimator(makeContext({ pageTurnAnimationStyle: () => "none" }));
      expect(animator.shouldSkipPageTurnAnimation()).toBe(true);
    });

    it("is true when the OS has prefers-reduced-motion set, regardless of style", () => {
      stubMatchMedia(true);
      const animator = new PageTurnAnimator(makeContext({ pageTurnAnimationStyle: () => "slide" }));
      expect(animator.shouldSkipPageTurnAnimation()).toBe(true);
    });
  });

  describe("pageTurnPartialAmount()", () => {
    it("scales to a quarter turn (90) for 'rotate', signed by direction", () => {
      const animator = new PageTurnAnimator(makeContext({ pageTurnAnimationStyle: () => "rotate" }));
      expect(animator.pageTurnPartialAmount(1, 0.5)).toBeCloseTo(-45);
      expect(animator.pageTurnPartialAmount(-1, 0.5)).toBeCloseTo(45);
    });

    it("scales to a full page-width (100) for 'slide'/'none'", () => {
      const animator = new PageTurnAnimator(makeContext({ pageTurnAnimationStyle: () => "slide" }));
      expect(animator.pageTurnPartialAmount(1, 1)).toBe(-100);
      expect(animator.pageTurnPartialAmount(-1, 0.25)).toBe(25);
    });
  });

  describe("scrollDragEnterAmount()", () => {
    it("starts fully off-screen and approaches 0 as fraction nears 1", () => {
      const animator = new PageTurnAnimator(makeContext());
      expect(animator.scrollDragEnterAmount(1, 0)).toBe(100);
      expect(animator.scrollDragEnterAmount(1, 1)).toBe(0);
      expect(animator.scrollDragEnterAmount(-1, 0)).toBe(-100);
    });
  });

  describe("setPageTurnTransform()", () => {
    it("sets a translateX + directional box-shadow for non-rotate styles", () => {
      const animator = new PageTurnAnimator(makeContext({ pageTurnAnimationStyle: () => "slide" }));
      const el = document.createElement("div");
      animator.setPageTurnTransform(el, -50, 0.5);
      expect(el.style.transform).toBe("translateX(-50%)");
      expect(el.style.boxShadow).toContain("16px 0 32px");
    });

    it("sets a rotateY + inset self-shading box-shadow for 'rotate'", () => {
      const animator = new PageTurnAnimator(makeContext({ pageTurnAnimationStyle: () => "rotate" }));
      const el = document.createElement("div");
      animator.setPageTurnTransform(el, 45, 1);
      expect(el.style.transform).toBe("rotateY(45deg)");
      expect(el.style.boxShadow).toContain("inset");
    });

    it("applies the same transform/shadow to every extra element", () => {
      const animator = new PageTurnAnimator(makeContext());
      const el = document.createElement("div");
      const extra = document.createElement("div");
      animator.setPageTurnTransform(el, -20, 0.2, [extra]);
      expect(extra.style.transform).toBe(el.style.transform);
      expect(extra.style.boxShadow).toBe(el.style.boxShadow);
    });
  });

  describe("stagePageTurn()", () => {
    it("is a no-op without a mounted containerEl", () => {
      const animator = new PageTurnAnimator(makeContext({ containerEl: () => undefined }));
      const hostEl = document.createElement("div");
      animator.stagePageTurn(hostEl, hostEl, 1);
      expect(hostEl.style.zIndex).toBe("");
    });

    it("elevates hostEl above the incoming content for every style", () => {
      const animator = new PageTurnAnimator(makeContext({ pageTurnAnimationStyle: () => "slide" }));
      const hostEl = document.createElement("div");
      animator.stagePageTurn(hostEl, hostEl, 1);
      expect(hostEl.style.position).toBe("relative");
      expect(hostEl.style.zIndex).toBe("2");
    });

    it("never downgrades an already-absolute hostEl back to relative", () => {
      const animator = new PageTurnAnimator(makeContext());
      const hostEl = document.createElement("div");
      hostEl.style.position = "absolute";
      animator.stagePageTurn(hostEl, hostEl, 1);
      expect(hostEl.style.position).toBe("absolute");
    });

    it("sets up 3D perspective/hinge-side transform-origin only for 'rotate'", () => {
      const container = document.body;
      const animator = new PageTurnAnimator(makeContext({ pageTurnAnimationStyle: () => "rotate" }));
      const hostEl = document.createElement("div");
      const turnEl = document.createElement("div");
      animator.stagePageTurn(hostEl, turnEl, 1);
      expect(container.style.perspective).toBe("2200px");
      expect(turnEl.style.transformOrigin).toBe("left center");
      expect(turnEl.style.backfaceVisibility).toBe("hidden");
    });

    it("flips the hinge side for a backward (entering) turn", () => {
      const animator = new PageTurnAnimator(makeContext({ pageTurnAnimationStyle: () => "rotate" }));
      const hostEl = document.createElement("div");
      animator.stagePageTurn(hostEl, hostEl, 1, [], true);
      expect(hostEl.style.transformOrigin).toBe("right center");
    });

    it("skips the 3D setup entirely for non-'rotate' styles", () => {
      const animator = new PageTurnAnimator(makeContext({ pageTurnAnimationStyle: () => "slide" }));
      const hostEl = document.createElement("div");
      animator.stagePageTurn(hostEl, hostEl, 1);
      expect(hostEl.style.transformOrigin).toBe("");
    });
  });

  describe("buildTurnBackdrop()/buildTurnGrowthMask()", () => {
    it("buildTurnBackdrop returns undefined without a mounted containerEl", () => {
      const animator = new PageTurnAnimator(makeContext({ containerEl: () => undefined }));
      expect(animator.buildTurnBackdrop(document.createElement("div"))).toBeUndefined();
    });

    it("buildTurnBackdrop sizes to the pane's full height, positioned against matchEl", () => {
      const animator = new PageTurnAnimator(makeContext({ height: () => 800 }));
      const matchEl = document.createElement("div");
      document.body.appendChild(matchEl);
      const backdrop = animator.buildTurnBackdrop(matchEl);
      expect(backdrop).toBeDefined();
      expect(backdrop!.style.position).toBe("absolute");
      expect(backdrop!.style.height).toBe("800px");
      expect(backdrop!.getAttribute("aria-hidden")).toBe("true");
    });

    it("buildTurnGrowthMask returns undefined once matchEl already fills the pane's height", () => {
      const animator = new PageTurnAnimator(makeContext({ height: () => 800 }));
      const matchEl = document.createElement("div");
      document.body.appendChild(matchEl);
      // naturalHeight >= pane height -> nothing left to mask.
      expect(animator.buildTurnGrowthMask(matchEl, 800)).toBeUndefined();
      expect(animator.buildTurnGrowthMask(matchEl, 900)).toBeUndefined();
    });

    it("buildTurnGrowthMask covers exactly the region below matchEl's natural height", () => {
      const animator = new PageTurnAnimator(makeContext({ height: () => 800 }));
      const matchEl = document.createElement("div");
      document.body.appendChild(matchEl);
      const mask = animator.buildTurnGrowthMask(matchEl, 500);
      expect(mask).toBeDefined();
      expect(mask!.style.height).toBe("300px");
    });
  });

  describe("buildTurnFurnitureOverlay()", () => {
    it("returns undefined without a mounted containerEl", () => {
      const animator = new PageTurnAnimator(makeContext({ containerEl: () => undefined }));
      expect(animator.buildTurnFurnitureOverlay(document.createElement("div"), [])).toBeUndefined();
    });

    it("builds one header (+ optional footer) band per entry, sized to the pane's full height", () => {
      const animator = new PageTurnAnimator(makeContext({ height: () => 800 }));
      const matchEl = document.createElement("div");
      document.body.appendChild(matchEl);
      const overlay = animator.buildTurnFurnitureOverlay(matchEl, [
        { left: 0, width: 400, header: { mode: "single", text: "Chapter 1" }, footerText: "Page 3" },
      ]);
      expect(overlay).toBeDefined();
      expect(overlay!.style.height).toBe("800px");
      expect(overlay!.textContent).toContain("Chapter 1");
      expect(overlay!.textContent).toContain("Page 3");
    });

    it("omits the footer band when footerText is undefined", () => {
      const animator = new PageTurnAnimator(makeContext());
      const matchEl = document.createElement("div");
      document.body.appendChild(matchEl);
      const overlay = animator.buildTurnFurnitureOverlay(matchEl, [
        { left: 0, width: 400, header: { mode: "single", text: "Chapter 1" }, footerText: undefined },
      ]);
      expect(overlay!.children).toHaveLength(1);
    });

    it("renders a split header as two separate spans", () => {
      const animator = new PageTurnAnimator(makeContext());
      const matchEl = document.createElement("div");
      document.body.appendChild(matchEl);
      const overlay = animator.buildTurnFurnitureOverlay(matchEl, [
        { left: 0, width: 400, header: { mode: "split", left: "Ch. 2", right: "p. 12" }, footerText: undefined },
      ]);
      expect(overlay!.textContent).toContain("Ch. 2");
      expect(overlay!.textContent).toContain("p. 12");
    });
  });

  describe("buildRotateBackFace()", () => {
    it("returns undefined when turnEl has no parent", () => {
      const animator = new PageTurnAnimator(makeContext());
      expect(animator.buildRotateBackFace(document.createElement("div"))).toBeUndefined();
    });

    it("appends a sibling positioned to overlay turnEl, with a fixed 180deg inner face", () => {
      const animator = new PageTurnAnimator(makeContext());
      const parent = document.createElement("div");
      const turnEl = document.createElement("div");
      parent.appendChild(turnEl);
      document.body.appendChild(parent);
      const backFace = animator.buildRotateBackFace(turnEl);
      expect(backFace).toBeDefined();
      expect(backFace!.parentElement).toBe(parent);
      expect(backFace!.style.transformStyle).toBe("preserve-3d");
      const inner = backFace!.firstElementChild as HTMLElement;
      expect(inner.style.transform).toBe("rotateY(180deg)");
      expect(inner.style.backfaceVisibility).toBe("hidden");
    });
  });

  describe("elementToTurn()", () => {
    it("returns the host's own element for a non-'rotate' style", () => {
      const animator = new PageTurnAnimator(makeContext({ pageTurnAnimationStyle: () => "slide" }));
      const element = document.createElement("div");
      const host = { element } as unknown as PaginatedContentHost;
      expect(animator.elementToTurn(host)).toBe(element);
    });
  });

  describe("playPageTurnAnimation() / playScrollTurn()", () => {
    it("playPageTurnAnimation resolves immediately when the animation should be skipped", async () => {
      const animator = new PageTurnAnimator(makeContext({ pageTurnAnimationStyle: () => "none" }));
      const el = document.createElement("div");
      await expect(animator.playPageTurnAnimation(el, el, 1)).resolves.toBeUndefined();
    });

    it("playPageTurnAnimation resolves once turnEl's transform transition ends", async () => {
      const animator = new PageTurnAnimator(makeContext({ pageTurnAnimationStyle: () => "slide" }));
      const el = document.createElement("div");
      document.body.appendChild(el);
      const donePromise = animator.playPageTurnAnimation(el, el, 1);
      // Let stagePageTurn/the rAF-scheduled transform-set run, then
      // simulate the browser finishing the CSS transition.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const event = new Event("transitionend") as TransitionEvent & { propertyName: string };
      Object.defineProperty(event, "propertyName", { value: "transform" });
      el.dispatchEvent(event);
      await expect(donePromise).resolves.toBeUndefined();
    });

    it("playScrollTurn resolves immediately when the animation should be skipped", async () => {
      const animator = new PageTurnAnimator(makeContext({ pageTurnAnimationStyle: () => "none" }));
      const el = document.createElement("div");
      await expect(animator.playScrollTurn([el], [el], 1)).resolves.toBeUndefined();
    });
  });
});
