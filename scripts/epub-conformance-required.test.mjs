import assert from "node:assert/strict";
import test from "node:test";
import {
  isRequiredNativeCriterion,
  requiredNativeCriteria,
  requiredFoundationCriteria,
  requiredNativeVerdict,
  mergeRequiredPlan,
} from "./epub-conformance-required.mjs";
import { isFoundationCriterion } from "./epub-conformance-foundations.mjs";
import { mergeCoreAssessment } from "./epub-conformance-core.mjs";

const digest = "a".repeat(64);
const criterion = (id) => requiredNativeCriteria.find((test) => test.id === id);
const documents = () => [
  {
    path: "EPUB/original.xhtml",
    expectedPath: "EPUB/original.xhtml",
    contentPath: "EPUB/original.xhtml",
    spineIndex: 0,
    expectedSpineIndex: 0,
    expectedTextHash: digest,
    actualTextHash: digest,
    painted: true,
  },
];
const reading = {
  sourceSpine: ["EPUB/original.xhtml"],
  readingOrder: ["EPUB/original.xhtml"],
  acceptedSpinePaths: [["EPUB/original.xhtml"]],
};

test("expanded registry has unique, typed methods, including additional foundation cases", () => {
  const all = [...requiredNativeCriteria, ...requiredFoundationCriteria];
  assert.equal(all.length, 39);
  assert.equal(new Set(all.map((test) => test.id)).size, all.length);
  assert.ok(requiredNativeCriteria.every(isRequiredNativeCriterion));
  assert.ok(requiredFoundationCriteria.every(isFoundationCriterion));
  assert.equal(isRequiredNativeCriterion({ id: "cnt-mathml-support", kind: "document" }), false);
});

test("document verdict requires original text, actual paint and independently expected path", () => {
  const value = { kind: "document", documents: documents(), ...reading };
  assert.equal(requiredNativeVerdict(value, criterion("cnt-xhtml-support")), true);
  for (const changes of [
    { path: "wrong.xhtml" },
    { actualTextHash: "b".repeat(64) },
    { painted: false },
  ]) {
    assert.equal(
      requiredNativeVerdict(
        {
          ...value,
          documents: [{ ...value.documents[0], ...changes }],
        },
        criterion("cnt-xhtml-support"),
      ),
      false,
    );
  }
  assert.throws(() =>
    requiredNativeVerdict({ ...value, documents: [] }, criterion("cnt-xhtml-support")),
  );
  assert.throws(() =>
    requiredNativeVerdict(
      {
        ...value,
        documents: [{ ...value.documents[0], painted: "true" }],
      },
      criterion("cnt-xhtml-support"),
    ),
  );
});

test("MathML requires a native superscript above and smaller than the base", () => {
  const value = {
    kind: "math",
    documents: documents(),
    ...reading,
    math: {
      namespace: true,
      superscript: true,
      painted: true,
      baseTop: 20,
      exponentTop: 10,
      baseHeight: 20,
      exponentHeight: 12,
    },
  };
  assert.equal(requiredNativeVerdict(value, criterion("cnt-mathml-support")), true);
  for (const changes of [
    { namespace: false },
    { painted: false },
    { exponentTop: 20 },
    { exponentHeight: 20 },
  ])
    assert.equal(
      requiredNativeVerdict(
        {
          ...value,
          math: { ...value.math, ...changes },
        },
        criterion("cnt-mathml-support"),
      ),
      false,
    );
});

test("SVG CSS requires a resolvable star fill and native shapes rather than document import", () => {
  const value = {
    kind: "svg",
    documents: documents(),
    ...reading,
    expectedShapeHashes: [digest],
    shapes: [
      {
        namespace: true,
        painted: true,
        pattern: true,
        dHash: digest,
        fill: 'url("#star")',
        width: 120,
        height: 100,
      },
    ],
  };
  assert.equal(requiredNativeVerdict(value, criterion("cnt-svg-css")), true);
  for (const changes of [
    { fill: "rgb(255, 0, 0)" },
    { pattern: false },
    { painted: false },
    { height: 0 },
  ])
    assert.equal(
      requiredNativeVerdict(
        {
          ...value,
          shapes: [{ ...value.shapes[0], ...changes }],
        },
        criterion("cnt-svg-css"),
      ),
      false,
    );
});

test("audio requires original bytes, actual advancing time and a nonzero native PCM signal", () => {
  const value = {
    kind: "media",
    documents: documents(),
    ...reading,
    media: [
      {
        expectedHash: digest,
        actualHash: digest,
        before: 0,
        after: 1,
        readyState: 4,
        duration: 10,
        signalPeak: 0.1,
        muted: false,
        paused: false,
        ended: false,
        volume: 1,
        error: null,
      },
    ],
  };
  assert.equal(requiredNativeVerdict(value, criterion("pub-cmt-mp3")), true);
  for (const changes of [
    { actualHash: "b".repeat(64) },
    { after: 0.249 },
    { signalPeak: 0 },
    { muted: true },
    { paused: true },
    { volume: 0 },
    { readyState: 1 },
    { error: "Unsupported codec" },
  ])
    assert.equal(
      requiredNativeVerdict(
        {
          ...value,
          media: [{ ...value.media[0], ...changes }],
        },
        criterion("pub-cmt-mp3"),
      ),
      false,
    );
});

test("rejection requires a real deliberately nonconforming archive and a related explicit error", () => {
  const compression = {
    kind: "rejection",
    multiDisk: false,
    compressionMethods: [0, 12],
    versionNeededValues: [10, 46],
    imported: false,
    error: "Unsupported compression method: 12",
  };
  assert.equal(requiredNativeVerdict(compression, criterion("ocf-zip-comp")), true);
  assert.equal(
    requiredNativeVerdict(
      {
        ...compression,
        error: 'Unsupported ZIP version-needed-to-extract 46 for "EPUB/content_001.xhtml".',
      },
      criterion("ocf-zip-comp"),
    ),
    true,
  );
  assert.equal(
    requiredNativeVerdict(
      {
        ...compression,
        versionNeededValues: [10, 20],
        error: "Unsupported ZIP version-needed-to-extract 46.",
      },
      criterion("ocf-zip-comp"),
    ),
    false,
  );
  assert.equal(
    requiredNativeVerdict(
      { ...compression, error: "Unrelated failure" },
      criterion("ocf-zip-comp"),
    ),
    false,
  );
  assert.equal(
    requiredNativeVerdict({ ...compression, imported: true }, criterion("ocf-zip-comp")),
    false,
  );
  assert.throws(() =>
    requiredNativeVerdict(
      { ...compression, compressionMethods: [0, 8] },
      criterion("ocf-zip-comp"),
    ),
  );
  const segmented = {
    ...compression,
    multiDisk: true,
    compressionMethods: [0, 8],
    error: "Multi-disk ZIP files are not supported",
  };
  assert.equal(requiredNativeVerdict(segmented, criterion("ocf-zip-mult")), true);
  assert.throws(() =>
    requiredNativeVerdict({ ...segmented, multiDisk: false }, criterion("ocf-zip-mult")),
  );
});

test("collector checks expanded verdicts against exact package-bound observations", () => {
  const release = { archive: "ambra.zip", version: "2.2.0", commit: "abc", sha256: digest };
  const evidenceUrl = "https://github.com/BCWalters/ambra/actions/runs/123";
  const selected = criterion("cnt-xhtml-support");
  const worksheet = { release, tests: { [selected.id]: { status: "not-run" } } };
  const record = {
    id: selected.id,
    release,
    environment: {
      testedAt: "2026-10-07T00:00:00Z",
      browser: { name: "Chromium", version: "Chrome/153" },
      os: { name: "Linux", version: "6" },
    },
    result: {
      status: "pass",
      method: "automated",
      reason: "Native measurement.",
      evidence: evidenceUrl,
    },
    observations: { kind: "document", documents: documents(), ...reading },
  };
  const merge = (record) =>
    mergeCoreAssessment(worksheet, [record], { criteria: [selected], evidenceUrl });
  assert.equal(merge(record).tests[selected.id].status, "pass");
  assert.throws(
    () =>
      merge({
        ...record,
        observations: {
          ...record.observations,
          documents: [{ ...documents()[0], painted: false }],
        },
      }),
    /contradicts/,
  );
  assert.throws(
    () => merge({ ...record, release: { ...release, sha256: "wrong" } }),
    /fingerprint/,
  );
  assert.throws(
    () =>
      mergeCoreAssessment(worksheet, [record], {
        criteria: [{ id: selected.id, kind: "image" }],
        evidenceUrl,
      }),
    /unique, typed/,
  );
});

test("a surfaced rejection of original content is a failure, not a setup timeout", () => {
  const value = {
    kind: "svg",
    sourceSpine: ["EPUB/original.svg"],
    openingError: { stage: "reader", message: "Unsupported content document." },
  };
  assert.equal(requiredNativeVerdict(value, criterion("cnt-svg-support")), false);
  assert.throws(
    () =>
      requiredNativeVerdict(
        {
          ...value,
          openingError: { stage: "reader", message: "" },
        },
        criterion("cnt-svg-support"),
      ),
    /opening-error/,
  );
  assert.throws(
    () =>
      requiredNativeVerdict(
        {
          ...value,
          sourceSpine: [],
        },
        criterion("cnt-svg-support"),
      ),
    /opening-error/,
  );
});

test("full inventory is exact-package-bound and cannot promote pending manual procedures", () => {
  const release = { archive: "ambra.zip", version: "2.2.0", commit: "abc", sha256: digest };
  const suite = { repository: "https://github.com/w3c/epub-tests.git", revision: "pinned" };
  const selected = criterion("cnt-xhtml-support");
  const criteria = [selected];
  const rows = Array.from({ length: 139 }, (_, index) => ({
    id: index ? `manual-${index}` : selected.id,
    method: index ? "manual" : "automated",
    nativeKind: index ? null : selected.kind,
    subject: "reading-system",
    sourceDirectories:
      index === 138
        ? ["manual-138", "manual-138_duplicate"]
        : [index ? `manual-${index}` : selected.id],
    procedure: ["Verify the authored expectation against native evidence."],
    blocker: index ? "Manual review pending." : null,
  }));
  const plan = {
    schemaVersion: 1,
    identifiers: 139,
    publications: 140,
    suite,
    release,
    criteria: rows,
  };
  const worksheet = {
    release,
    suite,
    tests: Object.fromEntries(rows.map((row) => [row.id, { status: "not-run", method: "manual" }])),
  };
  const evidence = "https://github.com/BCWalters/ambra/actions/runs/123";
  const result = mergeRequiredPlan(worksheet, plan, criteria, evidence);
  assert.equal(result.tests["manual-1"].status, "not-run");
  assert.equal(result.tests["manual-1"].reason, "Manual review pending.");
  assert.equal(worksheet.tests["manual-1"].reason, undefined);
  for (const mutate of [
    (plan) => {
      plan.release.sha256 = "wrong";
    },
    (plan) => {
      plan.criteria.pop();
    },
    (plan) => {
      plan.criteria[1].method = "not-applicable";
    },
    (plan) => {
      plan.criteria[1].procedure = [];
    },
    (plan) => {
      plan.criteria[1].blocker = "";
    },
    (plan) => {
      plan.criteria[0].nativeKind = "image";
    },
    (plan) => {
      plan.criteria[2].sourceDirectories = plan.criteria[1].sourceDirectories;
    },
  ]) {
    const invalid = structuredClone(plan);
    mutate(invalid);
    assert.throws(
      () => mergeRequiredPlan(worksheet, invalid, criteria, evidence),
      /Required inventory/,
    );
  }
});
