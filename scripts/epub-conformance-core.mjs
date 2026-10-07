#!/usr/bin/env node
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { foundationVerdict, isFoundationCriterion, isFoundationId } from "./epub-conformance-foundations.mjs";

const releaseFields = ["archive", "version", "commit", "sha256"];
const verdicts = new Set(["pass", "fail", "not-run"]);

function text(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value;
}

function nativeVerdict(observations, criterion) {
  if (isFoundationCriterion(criterion)) return foundationVerdict(observations, criterion);
  if (!Array.isArray(observations?.fonts) || !Array.isArray(observations.images)) {
    throw new Error(`${criterion.id} lacks native font/image measurement arrays.`);
  }
  if (criterion.kind === "font") {
    if (observations.images.length !== 0) {
      throw new Error(`${criterion.id} contains measurements for the wrong resource kind.`);
    }
    for (const face of observations.fonts) {
      if (
        typeof face?.family !== "string" ||
        face.family.replace(/^['"]|['"]$/g, "") !== criterion.family ||
        !["unloaded", "loading", "loaded", "error"].includes(face.status) ||
        !["used", "painted", "distinctGlyphs"].every(field => typeof face[field] === "boolean")
      ) {
        throw new Error(`${criterion.id} has malformed native font measurements.`);
      }
    }
    return observations.fonts.length > 0 && observations.fonts.every(
      face => face.status === "loaded" && face.used && face.painted && face.distinctGlyphs,
    );
  }
  if (observations.fonts.length !== 0) {
    throw new Error(`${criterion.id} contains measurements for the wrong resource kind.`);
  }
  for (const image of observations.images) {
    if (
      !image ||
      !["complete", "painted", "packaged"].every(field => typeof image[field] === "boolean") ||
      !["width", "height"].every(field => Number.isSafeInteger(image[field]) && image[field] >= 0) ||
      !(image.decodeError === null || typeof image.decodeError === "string")
    ) {
      throw new Error(`${criterion.id} has malformed native image measurements.`);
    }
  }
  return observations.images.length > 0 && observations.images.every(
    image => image.complete && image.width > 0 && image.height > 0 &&
      image.painted && image.packaged && image.decodeError === null,
  );
}

export function mergeCoreAssessment(assessment, records, { criteria, evidenceUrl }) {
  if (
    !Array.isArray(criteria) || criteria.length === 0 ||
    criteria.some(criterion =>
      !criterion || typeof criterion.id !== "string" || !/^[a-z0-9_-]+$/.test(criterion.id) ||
      (isFoundationId(criterion.id) && !isFoundationCriterion(criterion)) ||
      (!["font", "image"].includes(criterion.kind) && !isFoundationCriterion(criterion)) ||
      (criterion.kind === "font" && (typeof criterion.family !== "string" || !criterion.family.trim())),
    ) ||
    new Set(criteria.map(criterion => criterion.id)).size !== criteria.length
  ) {
    throw new Error("The core-media profile must contain unique, typed criteria.");
  }
  const ids = criteria.map(criterion => criterion.id);
  if (!/^https:\/\/github\.com\/BCWalters\/ambra\/actions\/runs\/[1-9]\d*$/.test(evidenceUrl)) {
    throw new Error("A specific GitHub assessment run is required as evidence.");
  }
  if (!assessment?.tests || !assessment.release || !Array.isArray(records)) {
    throw new Error("An assessment worksheet and observation records are required.");
  }
  const expected = new Set(ids);
  const byId = new Map(criteria.map(criterion => [criterion.id, criterion]));
  const seen = new Set();
  const merged = structuredClone(assessment);
  const environments = [];
  let operatingSystem;
  let latest = Number.NEGATIVE_INFINITY;
  for (const record of records) {
    if (!expected.has(record?.id) || seen.has(record.id)) {
      throw new Error(`Unknown or duplicate core-media observation: ${record?.id}.`);
    }
    seen.add(record.id);
    if (!(record.id in assessment.tests)) {
      throw new Error(`The worksheet does not contain ${record.id}.`);
    }
    if (
      !releaseFields.every(
        (field) =>
          typeof assessment.release[field] === "string" &&
          record.release?.[field] === assessment.release[field],
      )
    ) {
      throw new Error(`${record.id} does not match the worksheet's exact package fingerprint.`);
    }
    const result = record.result;
    if (
      !verdicts.has(result?.status) ||
      result.method !== "automated" ||
      result.evidence !== evidenceUrl
    ) {
      throw new Error(`${record.id} has an invalid automated verdict or evidence link.`);
    }
    text(result.reason, `${record.id} verdict reason`);
    if (
      result.status === "fail" &&
      !/^https:\/\/github\.com\/BCWalters\/ambra\/issues\/[1-9]\d*$/.test(result.trackingIssue)
    ) {
      throw new Error(`${record.id} requires a failure tracking issue.`);
    }
    if (result.status !== "not-run") {
      const passed = nativeVerdict(record.observations, byId.get(record.id));
      if ((result.status === "pass") !== passed) {
        throw new Error(`${record.id} verdict contradicts its native measurements.`);
      }
    }
    const environment = record.environment;
    const testedAt = Date.parse(text(environment?.testedAt, `${record.id} testedAt`));
    if (!Number.isFinite(testedAt)) throw new Error(`${record.id} has an invalid assessment date.`);
    latest = Math.max(latest, testedAt);
    const os = {
      name: text(environment?.os?.name, `${record.id} OS name`),
      version: text(environment?.os?.version, `${record.id} OS version`),
    };
    if (operatingSystem && JSON.stringify(operatingSystem) !== JSON.stringify(os)) {
      throw new Error("Core-media measurements contain inconsistent operating systems.");
    }
    operatingSystem = os;
    if (environment?.browser?.version) {
      environments.push({
        name: text(environment.browser.name, `${record.id} browser name`),
        version: text(environment.browser.version, `${record.id} browser version`),
      });
    } else if (result.status !== "not-run") {
      throw new Error(`${record.id} lacks measured browser provenance.`);
    }
    merged.tests[record.id] = { ...result };
  }
  const missing = ids.filter((id) => !seen.has(id));
  if (missing.length) throw new Error(`Missing core-media observations: ${missing.join(", ")}.`);
  if (
    environments.length === 0 ||
    environments.some(
      (environment) => JSON.stringify(environment) !== JSON.stringify(environments[0]),
    )
  ) {
    throw new Error("A consistent measured browser environment is required.");
  }
  merged.environment = {
    testedAt: new Date(latest).toISOString(),
    tester: "Ambra GitHub automated native assessment",
    browser: environments[0],
    os: operatingSystem,
    runner: {
      mode: "automated",
      configuration:
        `Exact production archive; isolated persistent Chromium profiles; 900x900 viewport; ${criteria.length} pinned native criteria. core-media.spec.ts retains font/image glyph/paint methods.${criteria.some(isFoundationCriterion) ? " foundations.spec.ts uses independently parsed source metadata, native controls, content language/direction, and roll geometry/decode/asset hashes." : ""} No live assistive-technology claim. Other criteria remain unchanged and unassessed by this profile.`,
    },
  };
  return merged;
}

async function main() {
  const { values } = parseArgs({
    options: {
      assessment: { type: "string" },
      observations: { type: "string" },
      output: { type: "string" },
      evidence: { type: "string" },
      foundations: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });
  for (const key of ["assessment", "observations", "output", "evidence"])
    text(values[key], `--${key}`);
  const profile = JSON.parse(
    await readFile(
      new URL("../conformance/epub-3.4/core-media-profile.json", import.meta.url),
      "utf8",
    ),
  );
  if (values.foundations) {
    profile.push(...JSON.parse(await readFile(
      new URL("../conformance/epub-3.4/foundations-profile.json", import.meta.url), "utf8",
    )));
  }
  const assessment = JSON.parse(await readFile(values.assessment, "utf8"));
  const files = (await readdir(values.observations))
    .filter((file) => file.endsWith(".json"))
    .sort();
  const records = await Promise.all(
    files.map(async (file) =>
      JSON.parse(await readFile(path.join(values.observations, file), "utf8")),
    ),
  );
  const result = mergeCoreAssessment(assessment, records, {
    criteria: profile,
    evidenceUrl: values.evidence,
  });
  await mkdir(path.dirname(values.output), { recursive: true });
  await writeFile(values.output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(
    `Merged ${records.length} package-bound core-media verdicts. Other criteria were not promoted.`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
