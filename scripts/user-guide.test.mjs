import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const guide = fileURLToPath(new URL("../docs/user-guide/", import.meta.url));
const expectedImages = [
  "annotations.png", "find-books.png", "inspector-overview.png",
  "inspector-source.png", "read-along-collapsed.png", "read-along.png", "reading-alice.png",
];

test("docs capture refuses to launch a browser without explicit permission", () => {
  const capture = fileURLToPath(new URL("./capture-user-guide.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [capture], {
    encoding: "utf8", env: { ...process.env, AMBRA_DOCS_ALLOW_BROWSER: "0" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Docs capture requires browser authorization/);
});

test("user-guide local links resolve and every screenshot is referenced", async () => {
  const referencedImages = new Set();
  for (const name of await fs.readdir(guide)) {
    if (!name.endsWith(".md")) continue;
    const text = await fs.readFile(path.join(guide, name), "utf8");
    for (const [, target] of text.matchAll(/\]\(([^)]+)\)/g)) {
      if (/^(?:https?:|mailto:|#)/.test(target)) continue;
      const [relative, fragment] = target.split("#");
      const destination = path.resolve(guide, relative);
      await fs.access(destination);
      if (relative.startsWith("images/") && relative.endsWith(".png")) {
        referencedImages.add(path.basename(relative));
      }
      if (fragment && destination.endsWith(".md")) {
        const linked = await fs.readFile(destination, "utf8");
        const anchors = [...linked.matchAll(/^#+ (.+)$/gm)].map(([, heading]) =>
          heading.toLowerCase().replace(/[^\p{L}\p{N}_ -]/gu, "").replace(/ /g, "-"));
        assert.ok(anchors.includes(fragment), `${name}: missing anchor ${target}`);
      }
    }
  }
  assert.deepEqual([...referencedImages].sort(), expectedImages.toSorted());
});

test("all user-guide images have matching provenance and exact output dimensions", async () => {
  const images = path.join(guide, "images");
  const provenance = JSON.parse(await fs.readFile(path.join(images, "provenance.json"), "utf8"));
  assert.deepEqual((await fs.readdir(images)).filter((name) => name.endsWith(".png")).sort(), expectedImages.toSorted());
  assert.deepEqual(Object.keys(provenance.files).sort(), expectedImages.toSorted());
  assert.match(provenance.sourceCommit, /^[a-f0-9]{40}$/);
  assert.match(provenance.candidateTreeSha256, /^[a-f0-9]{64}$/);
  assert.equal(provenance.version, "2.0.0");
  assert.ok(["premerge-preview", "packaged-runtime"].includes(provenance.capturePurpose));
  assert.equal(provenance.offline, true);
  assert.deepEqual(provenance.viewport, { width: 1280, height: 800 });
  if (provenance.capturePurpose === "packaged-runtime") {
    assert.match(provenance.releasePackage.sha256, /^[a-f0-9]{64}$/);
    assert.match(await fs.readFile(path.join(guide, "screenshots.md"), "utf8"), /packaged-runtime captures/);
    assert.doesNotMatch(await fs.readFile(path.join(guide, "README.md"), "utf8"), /pre-merge/);
  } else {
    assert.equal(provenance.releasePackage, null);
    assert.match(await fs.readFile(path.join(guide, "screenshots.md"), "utf8"), /pre-merge preview captures/);
  }
  for (const name of expectedImages) {
    const bytes = await fs.readFile(path.join(images, name));
    assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.equal(bytes.readUInt32BE(16), 1280, `${name} width`);
    assert.equal(bytes.readUInt32BE(20), 800, `${name} height`);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), provenance.files[name], name);
    assert.ok(provenance.observations[name], `${name} missing browser observations`);
  }
  assert.equal(provenance.observations["annotations.png"].panel, "Annotations");
  assert.equal(provenance.observations["find-books.png"].populatedLibrary, true);
  assert.equal(provenance.observations["read-along.png"].toolbarListenButton, false);
  assert.equal(provenance.observations["read-along.png"].paused, true);
  assert.equal(provenance.observations["read-along-collapsed.png"].playAvailable, true);
});
