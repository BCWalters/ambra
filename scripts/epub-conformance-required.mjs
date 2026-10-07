#!/usr/bin/env node
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { inventorySuite } from "./epub-conformance.mjs";

const groups = {
  document: [
    "cnt-xhtml-support",
    "ocf-metainf-inc",
    "ocf-metainf-manifest",
    "ocf-package_arbitrary",
    "ocf-package_multiple",
    "ocf-url_manifest",
    "ocf-url_relative",
    "pkg-collections-unknown",
    "pkg-manifest-unknown",
    "pkg-meta-unknown",
    "pkg-spine-unknown",
    "pkg-version-backward",
    "pub-foreign_json-spine",
    "pub-foreign_xml-spine",
    "pub-foreign_xml-suffix-spine",
    "pkg-spine-order",
    "pkg-spine-order-svg",
    "pkg-spine-duplicate-item-rendering",
  ],
  math: ["cnt-mathml-support"],
  svg: ["cnt-svg-support", "cnt-svg-embedded", "cnt-svg-css", "cnt-svg-css-inclusion"],
  media: ["pub-cmt-mp3", "pub-cmt-mp4", "pub-cmt-opus"],
  rejection: ["ocf-zip-comp", "ocf-zip-mult"],
};
const methods = Object.fromEntries(
  Object.entries(groups).flatMap(([kind, ids]) => ids.map((id) => [id, kind])),
);
export const requiredNativeCriteria = Object.entries(methods).map(([id, kind]) => ({ id, kind }));
export const requiredFoundationCriteria = [
  ...[
    "nav-spine_in-spine",
    "nav-spine_not-in-spine",
    "nav-spine_in-spine-hidden-toc-css",
    "nav-spine_in-spine-hidden-toc-html",
    "nav-spine_in-spine-no-list-style",
  ].map((id) => ({ id, kind: "navigation" })),
  ...[
    "pkg-dir_rtl-root-ltr",
    "pkg-dir_rtl-root-unset",
    "pkg-dir_unset-root-rtl",
    "pkg-dir_unset-root-unset",
    "pkg-dir-auto_root-rtl",
    "pkg-dir-auto_root-unset",
  ].map((id) => ({ id, kind: "package" })),
];
export function isRequiredNativeCriterion(value) {
  return !!value && Object.hasOwn(methods, value.id) && methods[value.id] === value.kind;
}
export function isRequiredNativeId(value) {
  return typeof value === "string" && Object.hasOwn(methods, value);
}

const procedures = {
  "Content Documents": [
    "Open every supplied publication and compare the authored example with its pass/fail instructions, not just the import result.",
    "For SVG, inspect inclusion versus reference, stylesheet scope, clipping and actual painted shapes. For MathML, check equation structure and superscript placement.",
    "For fonts, retain loaded-face, applied-family, painted-text and distinct-glyph evidence.",
  ],
  "Fixed Layout": [
    "Read the package and item-level rendition declarations before opening the book.",
    "Exercise the authored page sequence at narrow and wide viewports; measure alignment, page placement and overridden declarations against the authored instructions.",
    "Record viewport, spine index, frame rectangles, scale and a screenshot of the relevant page; opening successfully is insufficient.",
  ],
  "Pre-paginated Layout": [
    "Independently derive effective layout, viewport and spread properties from the package and each content document, preserving first-declaration rules.",
    "Traverse every authored page and mixed-layout boundary at narrow and wide widths. Check spread membership, touching edges, clipping and one-page-per-item behavior.",
    "Compare the actual authored illustrations with the pass instructions; record dimensions, index and evidence for each boundary.",
  ],
  "Roll Layout": [
    "Read the original spine order, intrinsic dimensions and media types, including fallback chains for image spine items.",
    "Scroll through every frame; compare width, aspect ratio, order and inter-frame gaps with the authored expectation.",
    "Verify original asset hashes, native decode and paired child/parent hit points using measured iframe scale.",
  ],
  "Media Overlays": [
    "Derive clip boundaries, text targets and audio-file transitions independently from each original SMIL file.",
    "Start narration with the reader's controls. Observe the actual media clock, highlighted target and reading position before, at and after each boundary.",
    "Exercise navigation and mid-file entry. Listen to the authored expected segment and retain timestamps; loaded audio alone does not establish synchronization.",
    "Resolve feature-conditional applicability against the pinned normative reference; unsupported-feature policy alone is not a verdict.",
  ],
  "Navigation Documents": [
    "Read the authored navigation XML independently of display:none, hidden attributes and list styles.",
    "Open Contents through native reader controls and verify every expected label is visible without publisher numbering.",
    "Activate each link and verify the original target text, fragment, spine occurrence and painted reading position.",
  ],
  "Open Container Format": [
    "Inspect the actual archive structure and container rootfiles, including arbitrary directories and first-rootfile selection.",
    "Verify original content and images reached through each authored URL; do not equate a successful import with URL resolution.",
    "For compression and segmentation cases, verify the deliberately nonconforming archive property before attempting import and require an explicit corresponding error.",
    "For origins and script URL parsing, distinguish native origin isolation from publication-script execution and resolve normative applicability explicitly.",
  ],
  "Package Documents": [
    "Independently read the package metadata, manifest and full spine, preserving duplicate occurrences and fallback chains.",
    "Traverse the reading order and follow authored links. Bookmark duplicate occurrences independently where required.",
    "For pkg-unique-id, import both original publications into one profile and verify independent cards, contents and saved positions.",
    "Unknown-property and backward-version cases require opening the original authored content; unrelated parse errors are not passes.",
  ],
  Internationalization: [
    "Read element and root language/direction declarations independently, including auto and unset values.",
    "Compare actual title/creator text, computed direction and bidi visual ordering with the authored example; do not infer correctness from dir attributes alone.",
    "For progression cases, perform physical next/previous actions and inspect actual page ordering, not only the parsed progression flag.",
  ],
  "Structural Semantics": [
    "Follow the authored footnote links on both pages and inspect whether a popup appears.",
    "Verify the negative title-element case does not inherit an unintended popup behavior.",
    "Resolve the optional-feature condition using the referenced reading-system requirement before recording a verdict.",
  ],
  "Core Media Types": [
    "Verify original resource bytes, native decode, actual painted content or advancing playback and the authored media kind.",
    "Record codec errors explicitly; do not substitute a converted resource or custom decoder.",
    "For audio, use native playback controls and verify the expected audible segment as well as the media clock.",
  ],
  "Publication Resources": [
    "Inspect the authored data/file/entity URLs and malformed XML before opening the publication.",
    "For data URLs, verify the original decoded image remains in the intended content frame and no extra top-level page opens.",
    "For prohibited file/entity access, observe blocked requests and absence of resolution; never read private filesystem contents to validate the test.",
    "For malformed XML, require a surfaced error attributable to the authored defect. Permitted non-validating cases must still display original content.",
  ],
  "Manifest Fallbacks": [
    "Read the original fallback chain and media types independently; identify the authored expected supported target.",
    "Verify the target's original content or image is decoded and painted, including resources outside the spine.",
    "For an entirely unsupported chain, record the explicit error or authored alternative behavior, not a setup timeout.",
  ],
  Scripting: [
    "Keep Ambra's current publication-scripting-disabled policy unchanged.",
    "Review each pinned normative reference separately to identify conditional scripting API obligations versus unconditional origin/isolation obligations.",
    "Verify fallback and negative container-constrained effects without enabling publisher scripts as a measurement shortcut.",
    "Where applicable, compare origins within and between original publications in one profile, then a second user profile; equal serialized opaque origins are not proof of shared origin.",
  ],
};

export async function requiredPlan(suitePath, config, existingCriteria) {
  const inventory = (await inventorySuite(suitePath, config)).filter(
    (test) => test.requirement === "must",
  );
  if (inventory.length !== 139)
    throw new Error(`Expected 139 required identifiers, found ${inventory.length}.`);
  const known = new Map(existingCriteria.map((criterion) => [criterion.id, criterion]));
  for (const criterion of [...requiredNativeCriteria, ...requiredFoundationCriteria]) {
    if (known.has(criterion.id)) throw new Error(`Duplicate assessment method: ${criterion.id}.`);
    known.set(criterion.id, criterion);
  }
  if ([...known.keys()].some((id) => !inventory.some((test) => test.id === id)))
    throw new Error("An automated method does not belong to the pinned required inventory.");
  return {
    schemaVersion: 1,
    suite: { repository: config.suite.repository, revision: config.suite.revision },
    identifiers: inventory.length,
    publications: inventory.reduce((sum, test) => sum + test.sourceDirectories.length, 0),
    criteria: inventory.map((test) => {
      if (!procedures[test.coverage]) throw new Error(`No procedure for ${test.coverage}.`);
      const method = known.get(test.id);
      const validationOnly = test.id === "lay-pp-layout-duplication";
      return {
        id: test.id,
        coverage: test.coverage,
        sourceDirectories: test.sourceDirectories,
        references: test.references,
        expected: test.description,
        method: method ? "automated" : "manual",
        nativeKind: method?.kind ?? null,
        subject: validationOnly ? "publication-validator" : "reading-system",
        blocker: method
          ? null
          : validationOnly
            ? "The authored assertion targets EPUBCheck, not a reading-system behavior. Validator evidence and applicability review are required."
            : "Manual review pending. No criterion-specific automated verdict is implemented; generic import/render evidence must not be promoted to a pass.",
        procedure: [
          ...procedures[test.coverage],
          "Use this identifier's original authored pass/fail instructions and normative references for the final verdict. Record reviewer, environment, exact package fingerprint and evidence.",
        ],
      };
    }),
  };
}

export function requiredNativeVerdict(value, criterion) {
  if (!isRequiredNativeCriterion(criterion)) throw new Error("Unknown required native criterion.");
  const validDigest = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
  const positive = (v) => Number.isFinite(v) && v > 0;
  if (criterion.kind === "rejection") {
    if (
      value?.kind !== "rejection" ||
      typeof value.multiDisk !== "boolean" ||
      !Array.isArray(value.compressionMethods) ||
      !value.compressionMethods.length ||
      value.compressionMethods.some((method) => !Number.isSafeInteger(method) || method < 0) ||
      typeof value.error !== "string" ||
      typeof value.imported !== "boolean"
    )
      throw new Error(`${criterion.id} has malformed native rejection measurements.`);
    if (criterion.id === "ocf-zip-comp") {
      if (value.multiDisk || !value.compressionMethods.includes(12))
        throw new Error("The compression fixture does not actually contain BZIP2 entries.");
      return !value.imported && /compression/i.test(value.error);
    }

    if (!value.multiDisk) throw new Error("The segmentation fixture is not multi-disk.");
    return !value.imported && /multi.disk|split|segment/i.test(value.error);
  }
  if (
    value?.kind !== criterion.kind ||
    !Array.isArray(value.documents) ||
    !value.documents.length ||
    !Array.isArray(value.sourceSpine) ||
    !value.sourceSpine.length ||
    !Array.isArray(value.readingOrder) ||
    !Array.isArray(value.acceptedSpinePaths) ||
    value.acceptedSpinePaths.length !== value.sourceSpine.length ||
    value.acceptedSpinePaths.some(
      (paths) =>
        !Array.isArray(paths) ||
        !paths.length ||
        paths.some((item) => typeof item !== "string" || !item),
    ) ||
    [...value.sourceSpine, ...value.readingOrder].some(
      (item) => typeof item !== "string" || !item,
    ) ||
    value.documents.length !== value.sourceSpine.length ||
    value.documents.some(
      (doc) =>
        typeof doc.path !== "string" ||
        !doc.path ||
        typeof doc.expectedPath !== "string" ||
        !doc.expectedPath ||
        typeof doc.contentPath !== "string" ||
        !doc.contentPath ||
        !Number.isSafeInteger(doc.spineIndex) ||
        !Number.isSafeInteger(doc.expectedSpineIndex) ||
        !validDigest(doc.expectedTextHash) ||
        !validDigest(doc.actualTextHash) ||
        typeof doc.painted !== "boolean",
    )
  )
    throw new Error(`${criterion.id} has malformed required native document measurements.`);
  if (
    value.readingOrder.length !== value.sourceSpine.length ||
    !value.readingOrder.every((path, index) => value.acceptedSpinePaths[index].includes(path))
  )
    return false;
  if (
    !value.documents.every(
      (doc) =>
        [doc.expectedPath, doc.contentPath].includes(doc.path) &&
        doc.spineIndex === doc.expectedSpineIndex &&
        doc.actualTextHash === doc.expectedTextHash &&
        doc.painted,
    )
  )
    return false;
  if (criterion.kind === "document") return true;
  if (criterion.kind === "math") {
    const { math } = value;
    if (
      !math ||
      !["namespace", "superscript", "painted"].every((key) => typeof math[key] === "boolean") ||
      !["baseTop", "exponentTop", "baseHeight", "exponentHeight"].every((key) =>
        Number.isFinite(math[key]),
      )
    )
      throw new Error(`${criterion.id} has malformed native MathML measurements.`);
    return (
      math.namespace &&
      math.superscript &&
      math.painted &&
      positive(math.baseHeight) &&
      positive(math.exponentHeight) &&
      math.exponentTop < math.baseTop &&
      math.exponentHeight < math.baseHeight
    );
  }
  if (criterion.kind === "svg") {
    if (
      !Array.isArray(value.expectedShapeHashes) ||
      !value.expectedShapeHashes.length ||
      !value.expectedShapeHashes.every(validDigest)
    )
      throw new Error(`${criterion.id} lacks original SVG geometry hashes.`);
    if (
      !Array.isArray(value.shapes) ||
      !value.shapes.length ||
      value.shapes.some(
        (shape) =>
          !shape ||
          !["painted", "namespace", "pattern"].every((key) => typeof shape[key] === "boolean") ||
          !validDigest(shape.dHash) ||
          typeof shape.fill !== "string" ||
          !Number.isFinite(shape.width) ||
          !Number.isFinite(shape.height),
      )
    )
      throw new Error(`${criterion.id} has malformed native SVG measurements.`);
    const patterned = ["cnt-svg-css", "cnt-svg-css-inclusion"].includes(criterion.id);
    return (
      value.expectedShapeHashes.every((hash) =>
        value.shapes.some((shape) => shape.dHash === hash),
      ) &&
      value.shapes.every(
        (shape) =>
          value.expectedShapeHashes.includes(shape.dHash) &&
          shape.namespace &&
          shape.painted &&
          positive(shape.width) &&
          positive(shape.height) &&
          (patterned
            ? shape.pattern && /url\(["']?[^)]*#star["']?\)/.test(shape.fill)
            : shape.fill === "rgb(255, 0, 0)"),
      )
    );
  }
  if (
    !Array.isArray(value.media) ||
    !value.media.length ||
    value.media.some(
      (media) =>
        !validDigest(media.expectedHash) ||
        !validDigest(media.actualHash) ||
        !Number.isFinite(media.before) ||
        !Number.isFinite(media.after) ||
        !Number.isFinite(media.readyState) ||
        !Number.isFinite(media.duration) ||
        !Number.isFinite(media.signalPeak) ||
        !(media.error === null || typeof media.error === "string"),
    )
  )
    throw new Error(`${criterion.id} has malformed native playback measurements.`);
  return value.media.every(
    (media) =>
      media.expectedHash === media.actualHash &&
      media.error === null &&
      media.readyState >= 2 &&
      positive(media.duration) &&
      media.after - media.before >= 0.25 &&
      media.signalPeak > 0.0001,
  );
}

export function mergeRequiredPlan(assessment, plan, criteria, evidenceUrl) {
  if (!/^https:\/\/github\.com\/BCWalters\/ambra\/actions\/runs\/[1-9]\d*$/.test(evidenceUrl))
    throw new Error("An exact assessment run is required for the required inventory.");
  const releaseFields = ["archive", "version", "commit", "sha256"];
  if (
    plan?.schemaVersion !== 1 ||
    plan.identifiers !== 139 ||
    plan.publications !== 140 ||
    plan.suite?.revision !== assessment.suite?.revision ||
    plan.suite?.repository !== assessment.suite?.repository ||
    !releaseFields.every(
      (field) =>
        typeof plan.release?.[field] === "string" &&
        plan.release[field] === assessment.release[field],
    ) ||
    !Array.isArray(plan.criteria) ||
    plan.criteria.length !== 139 ||
    new Set(plan.criteria.map((test) => test.id)).size !== 139 ||
    plan.criteria.some(
      (test) =>
        !Object.hasOwn(assessment.tests, test.id) ||
        !["manual", "automated"].includes(test.method) ||
        !["publication-validator", "reading-system"].includes(test.subject) ||
        !Array.isArray(test.sourceDirectories) ||
        !test.sourceDirectories.length ||
        test.sourceDirectories.some(
          (directory) => typeof directory !== "string" || !/^[a-z0-9_-]+$/.test(directory),
        ) ||
        !Array.isArray(test.procedure) ||
        !test.procedure.length ||
        test.procedure.some((step) => typeof step !== "string" || !step.trim()) ||
        (test.method === "manual" && (typeof test.blocker !== "string" || !test.blocker.trim())),
    ) ||
    plan.criteria.flatMap((test) => test.sourceDirectories).length !== 140 ||
    new Set(plan.criteria.flatMap((test) => test.sourceDirectories)).size !== 140 ||
    plan.criteria
      .filter((test) => test.method === "automated")
      .map((test) => `${test.id}:${test.nativeKind}`)
      .sort()
      .join("\n") !==
      criteria
        .map((test) => `${test.id}:${test.kind}`)
        .sort()
        .join("\n")
  )
    throw new Error(
      "Required inventory does not match the exact worksheet, procedures and automated methods.",
    );
  const result = structuredClone(assessment);
  for (const test of plan.criteria.filter((test) => test.method === "manual")) {
    if (result.tests[test.id].status === "not-run") {
      result.tests[test.id] = {
        ...result.tests[test.id],
        reason: test.blocker,
        evidence: evidenceUrl,
      };
    }
  }
  result.requiredPlan = structuredClone(plan);
  return result;
}

async function main() {
  const { values } = parseArgs({
    options: {
      suite: { type: "string" },
      output: { type: "string" },
      assessment: { type: "string" },
      evidence: { type: "string" },
    },
  });
  if (!values.suite || !values.output) throw new Error("--suite and --output are required.");
  const load = async (name) =>
    JSON.parse(
      await readFile(new URL(`../conformance/epub-3.4/${name}.json`, import.meta.url), "utf8"),
    );
  const existing = [...(await load("core-media-profile")), ...(await load("foundations-profile"))];
  const plan = await requiredPlan(values.suite, await load("config"), existing);
  if (values.assessment) {
    const assessment = JSON.parse(await readFile(values.assessment, "utf8"));
    if (assessment.suite?.revision !== plan.suite.revision)
      throw new Error("Worksheet and required inventory revisions differ.");
    plan.release = assessment.release;
    if (values.evidence) {
      const updated = mergeRequiredPlan(
        assessment,
        plan,
        [...existing, ...requiredFoundationCriteria, ...requiredNativeCriteria],
        values.evidence,
      );
      await writeFile(values.assessment, `${JSON.stringify(updated, null, 2)}\n`);
    }
  }
  await mkdir(values.output, { recursive: true });
  await writeFile(
    path.join(values.output, "required-plan.json"),
    `${JSON.stringify(plan, null, 2)}\n`,
  );
  await writeFile(
    path.join(values.output, "required-procedures.md"),
    [
      "# Full required EPUB assessment procedures",
      "",
      `Pinned revision: ${plan.suite.revision}. ${plan.identifiers} identifiers / ${plan.publications} publications.`,
      "An inventory/procedure is not an executed verdict. Manual entries remain not-run until evidenced review.",
      "",
      ...plan.criteria.flatMap((test) => [
        `## ${test.id}`,
        "",
        `Method: ${test.method}; subject: ${test.subject}.`,
        `Sources: ${test.sourceDirectories.join(", ")}.`,
        "",
        `Authored expectation: ${test.expected}`,
        "",
        ...test.procedure.map((step, index) => `${index + 1}. ${step}`),
        "",
        ...test.references.map((reference) => `Reference: ${reference}`),
        ...(test.blocker ? ["", `Pending: ${test.blocker}`] : []),
        "",
      ]),
    ].join("\n"),
  );
  console.log(
    `Inventoried ${plan.identifiers} required identifiers; ${plan.criteria.filter((test) => test.method === "automated").length} automated methods.`,
  );
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
