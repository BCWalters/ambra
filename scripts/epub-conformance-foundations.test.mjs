import assert from "node:assert/strict";
import test from "node:test";
import { foundationVerdict, isFoundationCriterion, rollImageHitPoint } from "./epub-conformance-foundations.mjs";
import { mergeCoreAssessment } from "./epub-conformance-core.mjs";

const criterion = (id) => ({
  id,
  kind: id.startsWith("pkg-") ? "package" : id.startsWith("nav-") ? "navigation" : "roll",
});
const paintGeometry = () => ({
  frame: { x: 10, y: 100, width: 300, height: 200 },
  image: { x: 0, y: 0, width: 600, height: 400 },
  clip: { x: 0, y: 120, width: 400, height: 140 },
  viewport: { width: 400, height: 300 },
  clientWidth: 600,
  clientHeight: 400,
});
test("roll paint maps one visible point between scaled iframe and clipped reader viewport", () => {
  assert.deepEqual(rollImageHitPoint(paintGeometry()), {
    viewport: { x: 160, y: 190 },
    document: { x: 300, y: 180 },
  });
  assert.deepEqual(rollImageHitPoint({ ...paintGeometry(), viewport: { width: 400, height: 160 } }), {
    viewport: { x: 160, y: 140 },
    document: { x: 300, y: 80 },
  });
});
test("roll paint rejects invalid geometry and distinguishes fully clipped images", () => {
  assert.equal(rollImageHitPoint({ ...paintGeometry(), clip: { x: 0, y: 0, width: 400, height: 80 } }), null);
  assert.equal(rollImageHitPoint({ ...paintGeometry(), frame: { x: 10, y: 100, width: 0, height: 200 } }), null);
  for (const clientWidth of [0, -1, NaN, Infinity]) {
    assert.throws(() => rollImageHitPoint({ ...paintGeometry(), clientWidth }), /Invalid native roll paint geometry/);
  }
});
const text = (value, dir = null) => ({
  text: value,
  lang: null,
  dir,
  direction: dir ?? "ltr",
  painted: true,
});
const metadata = () => ({
  kind: "package",
  source: {
    titles: ["First title", "Second title"],
    creators: ["First creator", "Second creator"],
    dir: null,
    lang: "en",
    creatorDir: null,
    contentUnannotated: true,
    contentDigest: "a".repeat(64),
  },
  rendered: { title: text("First title"), creator: text("First creator") },
  content: {
    sha256: "a".repeat(64),
    painted: true,
    htmlLang: null,
    xmlLang: null,
    bodyLang: null,
    frameLang: null,
    direction: "ltr",
    languages: [],
    locale: "en-US",
  },
});
const navigation = () => ({
  kind: "navigation",
  source: [
    {
      label: "Next",
      path: "EPUB/two.xhtml",
      fragment: null,
      title: "Two",
      text: "Native target",
      spineIndex: 1,
    },
  ],
  controls: { available: true, painted: true, labels: ["Next"] },
  activations: [],
});
const hash = "a".repeat(64);
const roll = () => ({
  kind: "roll",
  viewportWidth: 900,
  source: [
    { width: 600, height: 800, images: [hash] },
    { width: 600, height: 400, images: [hash] },
  ],
  frames: [0, 1].map((index) => ({
    x: 0,
    y: index * 1200,
    width: 900,
    height: index ? 600 : 1200,
    images: [{ sha256: hash, painted: true, packaged: true, width: 600, height: 800, error: null }],
  })),
});

test("metadata order, whitespace and RTL use source expectations and painted UI", () => {
  const observed = metadata();
  assert.equal(foundationVerdict(observed, criterion("pkg-title-order")), true);
  assert.equal(foundationVerdict(observed, criterion("pkg-creator-order")), true);
  observed.rendered.title.text = "Second title";
  assert.equal(foundationVerdict(observed, criterion("pkg-title-order")), false);
  observed.rendered.title.text = "First title";
  observed.rendered.creator.text = "Second creator";
  assert.equal(foundationVerdict(observed, criterion("pkg-creator-order")), false);
  observed.source.creators[0] = "  First \t creator\n ";
  observed.rendered.creator.text = "First creator";
  assert.equal(foundationVerdict(observed, criterion("pkg-meta-whitespace")), true);
  observed.source.creatorDir = "rtl";
  observed.rendered.creator = text("First creator", "rtl");
  assert.equal(foundationVerdict(observed, criterion("pkg-dir_creator-rtl")), true);
  observed.rendered.creator.painted = false;
  assert.equal(foundationVerdict(observed, criterion("pkg-dir_creator-rtl")), false);
});

test("package language and direction cannot leak into unannotated content", () => {
  const observed = metadata();
  observed.source.dir = "rtl";
  observed.source.lang = "he";
  assert.equal(foundationVerdict(observed, criterion("pkg-dir_but_not_content")), true);
  observed.content.frameLang = "he";
  assert.equal(foundationVerdict(observed, criterion("pkg-dir_but_not_content")), false);
  observed.content.frameLang = null;
  observed.content.direction = "rtl";
  assert.equal(foundationVerdict(observed, criterion("pkg-dir_but_not_content")), false);
  observed.source.lang = "fr";
  observed.content.direction = "ltr";
  assert.equal(foundationVerdict(observed, criterion("pkg-lang_but_not_content")), true);
  observed.content.htmlLang = "fr";
  assert.equal(foundationVerdict(observed, criterion("pkg-lang_but_not_content")), false);
  observed.content.htmlLang = null;
  observed.content.locale = "fr-FR";
  assert.equal(foundationVerdict(observed, criterion("pkg-lang_but_not_content")), false);
  observed.content.locale = "en-US";
  observed.content.languages = ["fr"];
  assert.equal(foundationVerdict(observed, criterion("pkg-lang_but_not_content")), false);
  observed.content.languages = [];
  observed.content.sha256 = "b".repeat(64);
  assert.equal(foundationVerdict(observed, criterion("pkg-lang_but_not_content")), false);
  observed.content.sha256 = observed.source.contentDigest;
  observed.content.painted = false;
  assert.equal(foundationVerdict(observed, criterion("pkg-lang_but_not_content")), false);
});

test("navigation needs visible controls and correctly relocated native targets", () => {
  const observed = navigation();
  assert.equal(foundationVerdict(observed, criterion("nav-access")), true);
  observed.controls.painted = false;
  assert.equal(foundationVerdict(observed, criterion("nav-access")), false);
  observed.controls.painted = true;
  observed.activations = [
    {
      path: "EPUB/two.xhtml",
      title: "Two",
      text: "Native target",
      spineIndex: 1,
      found: true,
      painted: true,
    },
  ];
  assert.equal(foundationVerdict(observed, criterion("nav-activation")), true);
  for (const field of ["path", "title", "text", "spineIndex", "found", "painted"]) {
    const changed = structuredClone(observed);
    changed.activations[0][field] =
      field === "spineIndex"
        ? 0
        : typeof changed.activations[0][field] === "boolean"
          ? false
          : "Wrong";
    assert.equal(foundationVerdict(changed, criterion("nav-activation")), false);
  }
});

test("roll requires original decoded/painted assets, source aspect and gapless width fit within one CSS pixel", () => {
  const observed = roll();
  for (const id of ["lay-roll-embedded-images", "lay-roll-embedded-images-svg"]) {
    assert.equal(foundationVerdict(observed, criterion(id)), true);
    for (const mutate of [
      (value) => {
        value.frames[1].y += 1.01;
      },
      (value) => {
        value.frames[0].height += 1.01;
      },
      (value) => {
        value.frames[1].width -= 1.01;
      },
      (value) => {
        value.frames[1].x += 1.01;
      },
      (value) => {
        value.frames[0].images[0].sha256 = "b".repeat(64);
      },
      (value) => {
        value.frames[0].images[0].painted = false;
      },
      (value) => {
        value.frames[0].images[0].packaged = false;
      },
      (value) => {
        value.frames[0].images[0].width = 0;
      },
      (value) => {
        value.frames.pop();
      },
    ]) {
      const changed = structuredClone(observed);
      mutate(changed);
      assert.equal(foundationVerdict(changed, criterion(id)), false);
    }
    const boundary = structuredClone(observed);
    boundary.frames[1].y += 1;
    assert.equal(foundationVerdict(boundary, criterion(id)), true);
  }
});

test("malformed, mismatched-kind and unknown foundation observations are rejected", () => {
  assert.equal(isFoundationCriterion({ id: "pkg-title-order", kind: "font" }), false);
  assert.throws(() => foundationVerdict({}, criterion("pkg-title-order")), /malformed/);
  const empty = metadata();
  empty.source.titles = ["", ""];
  empty.rendered.title.text = "";
  assert.throws(() => foundationVerdict(empty, criterion("pkg-title-order")), /malformed/);
  assert.throws(() => foundationVerdict(metadata(), criterion("invented")), /Unknown/);
  const missing = metadata();
  missing.content.direction = undefined;
  assert.throws(() => foundationVerdict(missing, criterion("pkg-title-order")), /malformed/);
  const invalid = roll();
  invalid.frames[0].height = NaN;
  assert.throws(
    () => foundationVerdict(invalid, criterion("lay-roll-embedded-images")),
    /malformed/,
  );
});

test("foundation records retain strict package, evidence, completeness and verdict checks", () => {
  const id = "pkg-title-order";
  const release = { archive: "ambra.zip", version: "2.2.0", commit: "abc", sha256: hash };
  const evidenceUrl = "https://github.com/BCWalters/ambra/actions/runs/123";
  const worksheet = {
    release,
    tests: { [id]: { status: "not-run" }, untouched: { status: "not-run" } },
  };
  const record = {
    id,
    release,
    environment: {
      testedAt: "2026-10-07T00:00:00Z",
      browser: { name: "Chromium", version: "Chrome/153" },
      os: { name: "Linux", version: "6" },
    },
    result: {
      status: "pass",
      method: "automated",
      reason: "Native metadata.",
      evidence: evidenceUrl,
      trackingIssue: null,
    },
    observations: metadata(),
  };
  const merge = (records) =>
    mergeCoreAssessment(worksheet, records, { criteria: [criterion(id)], evidenceUrl });
  assert.throws(
    () =>
      mergeCoreAssessment(worksheet, [record], {
        criteria: [{ id, kind: "font", family: "Invented face" }],
        evidenceUrl,
      }),
    /typed criteria/,
  );
  assert.deepEqual(merge([record]).tests.untouched, worksheet.tests.untouched);
  assert.throws(() => merge([]), /Missing/);
  for (const mutate of [
    (value) => {
      value.release.sha256 = "different";
    },
    (value) => {
      value.result.evidence = "https://example.invalid";
    },
    (value) => {
      value.observations.rendered.title.painted = false;
    },
    (value) => {
      value.observations.kind = "font";
    },
  ]) {
    const changed = structuredClone(record);
    mutate(changed);
    assert.throws(() => merge([changed]));
  }
});
