// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  childStepIndex,
  elementCfiSteps,
  elementStepsFromRoot,
  resolveElementChild,
  resolveElementSteps,
  resolveOffsetInRun,
  resolveTextRun,
  runCharacterOffset,
} from "./CfiTree.js";

function parseXhtmlFragment(html: string): Document {
  return new DOMParser().parseFromString(
    `<html xmlns="http://www.w3.org/1999/xhtml">${html}</html>`,
    "application/xhtml+xml",
  );
}

describe("childStepIndex", () => {
  it("assigns even indices to elements in order, ignoring surrounding whitespace text", () => {
    const doc = parseXhtmlFragment("<body><p>a</p><p>b</p><p>c</p></body>");
    const body = doc.getElementsByTagName("body")[0]!;
    const [p1, p2, p3] = Array.from(body.children);

    expect(childStepIndex(p1!)).toBe(2);
    expect(childStepIndex(p2!)).toBe(4);
    expect(childStepIndex(p3!)).toBe(6);
  });

  it("assigns odd indices to text runs interleaved between elements", () => {
    // No whitespace between tags here, so each of these text nodes is a
    // real (non-whitespace-only) run — exactly the case the odd-indexing
    // rule exists to normalize regardless of an author's/parser's whitespace choices.
    const doc = parseXhtmlFragment("<body>before<em>x</em>between<em>y</em>after</body>");
    const body = doc.getElementsByTagName("body")[0]!;
    const [beforeText, em1, betweenText, em2, afterText] = Array.from(body.childNodes);

    expect(childStepIndex(beforeText!)).toBe(1);
    expect(childStepIndex(em1!)).toBe(2);
    expect(childStepIndex(betweenText!)).toBe(3);
    expect(childStepIndex(em2!)).toBe(4);
    expect(childStepIndex(afterText!)).toBe(5);
  });

  it("gives every text node in a multi-node run the same odd index", () => {
    const doc = parseXhtmlFragment("<body><p>a</p><p>b</p></body>");
    const body = doc.getElementsByTagName("body")[0]!;
    const p2 = body.children[1]!;
    // Manually split what would normally be one text run into two
    // adjacent Text nodes, simulating a parser (or CDATA boundary) that
    // doesn't merge them — CFI indexing must treat them as one run.
    const extra = doc.createTextNode("-extra-");
    body.insertBefore(extra, p2);

    expect(childStepIndex(extra)).toBe(3);
    expect(childStepIndex(p2)).toBe(4);
  });
});

describe("runCharacterOffset", () => {
  it("returns the local offset directly when there's only one text node in the run", () => {
    const doc = parseXhtmlFragment("<body><p>a</p>hello<p>b</p></body>");
    const body = doc.getElementsByTagName("body")[0]!;
    const textNode = body.childNodes[1]!;

    expect(runCharacterOffset(textNode, 3)).toBe(3);
  });

  it("accumulates the lengths of preceding text-like siblings in the same run", () => {
    const doc = parseXhtmlFragment("<body><p>a</p>xy<p>b</p></body>");
    const body = doc.getElementsByTagName("body")[0]!;
    const p2 = body.children[1]!;
    const secondPiece = doc.createTextNode("zzz");
    body.insertBefore(secondPiece, p2);
    // Run is now: "xy" (2 chars), then "zzz" — offset 1 into "zzz" should
    // be 2 (from "xy") + 1 = 3.

    expect(runCharacterOffset(secondPiece, 1)).toBe(3);
  });
});

describe("resolveTextRun / resolveOffsetInRun (round-trip with childStepIndex/runCharacterOffset)", () => {
  it("resolves a run addressed by an odd step index back to its text nodes", () => {
    const doc = parseXhtmlFragment("<body>before<em>x</em>between<em>y</em>after</body>");
    const body = doc.getElementsByTagName("body")[0]!;

    const run = resolveTextRun(body, 3);
    expect(run.map((n) => n.textContent)).toEqual(["between"]);
  });

  it("round-trips a character offset through generation and resolution", () => {
    const doc = parseXhtmlFragment("<body><p>a</p>hello world<p>b</p></body>");
    const body = doc.getElementsByTagName("body")[0]!;
    const textNode = body.childNodes[1]!;

    const stepIndex = childStepIndex(textNode);
    const cfiOffset = runCharacterOffset(textNode, 6); // right before "world"

    const run = resolveTextRun(body, stepIndex);
    const resolved = resolveOffsetInRun(run, cfiOffset);

    expect(resolved?.node).toBe(textNode);
    expect(resolved?.localOffset).toBe(6);
  });

  it("resolves an offset that spans a multi-text-node run to the correct node and local offset", () => {
    const doc = parseXhtmlFragment("<body><p>a</p>xy<p>b</p></body>");
    const body = doc.getElementsByTagName("body")[0]!;
    const p2 = body.children[1]!;
    const secondPiece = doc.createTextNode("zzz");
    body.insertBefore(secondPiece, p2);

    const run = resolveTextRun(body, 3);
    // Offset 3 = end of "xy" (2 chars) + 1 char into "zzz".
    const resolved = resolveOffsetInRun(run, 3);

    expect(resolved?.node.textContent).toBe("zzz");
    expect(resolved?.localOffset).toBe(1);
  });

  it("resolves an offset equal to the total run length as the end of the last node", () => {
    const doc = parseXhtmlFragment("<body><p>a</p>hello<p>b</p></body>");
    const body = doc.getElementsByTagName("body")[0]!;

    const run = resolveTextRun(body, 3);
    const resolved = resolveOffsetInRun(run, 5);

    expect(resolved?.localOffset).toBe(5);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 6])(
    "rejects invalid or out-of-range offset %s",
    (offset) => {
      const doc = parseXhtmlFragment("<body>hello</body>");
      const body = doc.getElementsByTagName("body")[0]!;

      expect(resolveOffsetInRun(resolveTextRun(body, 1), offset)).toBeUndefined();
    },
  );

  it("rejects overflow across adjacent text nodes while retaining the exact end", () => {
    const doc = parseXhtmlFragment("<body>he<!--split-->llo</body>");
    const body = doc.getElementsByTagName("body")[0]!;
    const run = resolveTextRun(body, 1);

    expect(resolveOffsetInRun(run, 5)).toEqual({ node: run[1], localOffset: 3 });
    expect(resolveOffsetInRun(run, 6)).toBeUndefined();
    expect(resolveOffsetInRun([], 0)).toBeUndefined();
  });
});

describe("resolveElementChild", () => {
  it("finds the Nth element child by 1-based position, ignoring text/comment nodes", () => {
    const doc = parseXhtmlFragment("<body>text<!--comment--><p>a</p>more<p>b</p></body>");
    const body = doc.getElementsByTagName("body")[0]!;

    expect(resolveElementChild(body, 1)?.textContent).toBe("a");
    expect(resolveElementChild(body, 2)?.textContent).toBe("b");
    expect(resolveElementChild(body, 3)).toBeUndefined();
  });
});

describe("elementStepsFromRoot / resolveElementSteps (round-trip)", () => {
  it("computes and resolves a nested element path", () => {
    const doc = parseXhtmlFragment(
      "<body><div><p>a</p><p>b</p></div><div><p>c</p><p id='target'>d</p></div></body>",
    );
    const body = doc.getElementsByTagName("body")[0]!;
    const target = doc.getElementById("target")!;

    const steps = elementStepsFromRoot(body, target);
    // body -> 2nd div (step 4) -> 2nd p (step 4)
    expect(steps).toEqual([4, 4]);

    const resolved = resolveElementSteps(body, steps);
    expect(resolved).toBe(target);
  });

  it("returns an empty step array when root and target are the same element", () => {
    const doc = parseXhtmlFragment("<body><p>a</p></body>");
    const body = doc.getElementsByTagName("body")[0]!;

    expect(elementStepsFromRoot(body, body)).toEqual([]);
    expect(resolveElementSteps(body, [])).toBe(body);
  });
});

describe("elementCfiSteps", () => {
  it("attaches an XML ID assertion to a step whose element has an id", () => {
    const doc = parseXhtmlFragment('<body><div><p id="para">a</p></div></body>');
    const body = doc.getElementsByTagName("body")[0]!;
    const p = doc.getElementById("para")!;

    const steps = elementCfiSteps(body, p);

    expect(steps.map((s) => s.index)).toEqual([2, 2]);
    expect(steps[0]?.idAssertion).toBeUndefined(); // the <div> has no id
    expect(steps[1]?.idAssertion).toBe("para");
  });

  it("omits the id assertion for a step whose element has no id", () => {
    const doc = parseXhtmlFragment("<body><p>a</p></body>");
    const body = doc.getElementsByTagName("body")[0]!;
    const p = body.children[0]!;

    expect(elementCfiSteps(body, p)[0]?.idAssertion).toBeUndefined();
  });

  it("round-trips through resolveElementSteps by discarding the id assertions (positional resolution)", () => {
    const doc = parseXhtmlFragment(
      '<body><div id="d1"><p>a</p></div><div id="d2"><p id="target">b</p></div></body>',
    );
    const body = doc.getElementsByTagName("body")[0]!;
    const target = doc.getElementById("target")!;

    const steps = elementCfiSteps(body, target);
    const resolved = resolveElementSteps(
      body,
      steps.map((s) => s.index),
    );

    expect(resolved).toBe(target);
  });
});

describe("comments and processing instructions", () => {
  it("does not consume a step index and does not break a surrounding text run", () => {
    // "a" and "b" are both plain text either side of a comment, with no
    // element in between — per spec, they're one run (odd index 1), and
    // the comment itself is invisible to the indexing scheme entirely.
    const doc = parseXhtmlFragment("<body>a<!--comment-->b<p>c</p></body>");
    const body = doc.getElementsByTagName("body")[0]!;
    const [textA, , textB] = Array.from(body.childNodes);

    expect(childStepIndex(textA!)).toBe(1);
    expect(childStepIndex(textB!)).toBe(1);

    const run = resolveTextRun(body, 1);
    expect(run.map((n) => n.textContent)).toEqual(["a", "b"]);
  });

  it("does not shift element indices when comments precede or follow them", () => {
    const doc = parseXhtmlFragment("<body><!--c1--><p>a</p><!--c2--><p>b</p><!--c3--></body>");
    const body = doc.getElementsByTagName("body")[0]!;
    const [p1, p2] = Array.from(body.children);

    expect(childStepIndex(p1!)).toBe(2);
    expect(childStepIndex(p2!)).toBe(4);
  });

  it("counts a character offset correctly across a run split by a comment", () => {
    const doc = parseXhtmlFragment("<body><p>x</p>hel<!--c-->lo<p>y</p></body>");
    const body = doc.getElementsByTagName("body")[0]!;
    const loNode = Array.from(body.childNodes).find((n) => n.textContent === "lo")!;

    // Run is "hel" (3 chars) + "lo" — offset 1 into "lo" should be 3 + 1 = 4.
    expect(runCharacterOffset(loNode, 1)).toBe(4);

    const run = resolveTextRun(body, 3);
    const resolved = resolveOffsetInRun(run, 4);
    expect(resolved?.node).toBe(loNode);
    expect(resolved?.localOffset).toBe(1);
  });
});
