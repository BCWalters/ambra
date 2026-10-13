import assert from "node:assert/strict";
import { test } from "node:test";
import { leafSegments, shouldCommit, easedProgress } from "./motion.mjs";

test("a leaf starts flat and lands flat on its reverse side", () => {
  for (const width of [160, 350, 511.5]) {
    const start = leafSegments(0, width);
    const end = leafSegments(1, width);
    assert.equal(start[0].x, 0);
    assert.ok(Math.abs(start.at(-1).x + start.at(-1).width - width) < 1e-8);
    assert.ok(Math.abs(end.at(-1).x - end.at(-1).width + width) < 1e-8);
    assert.ok(end.every(segment => Math.abs(segment.z) < 1e-8));
    assert.ok(end.every(segment => Math.abs(segment.angle + Math.PI) < 1e-8));
  }
});

test("curl bends a continuous leaf rather than separating rigid strips", () => {
  const segments = leafSegments(0.45, 350);
  assert.notEqual(segments[0].angle, segments.at(-1).angle);
  for (let i = 1; i < segments.length; i++) {
    const previous = segments[i - 1];
    assert.ok(Math.abs(segments[i].x - previous.x - previous.width * Math.cos(previous.angle)) < 1e-8);
    assert.ok(Math.abs(segments[i].z - previous.z + previous.width * Math.sin(previous.angle)) < 1e-8);
  }
  assert.ok(segments.at(-1).z > 250);
});

test("release uses travel or recent intent, including a quick reversal", () => {
  assert.equal(shouldCommit(0.1, 0.7), true);
  assert.equal(shouldCommit(0.8, -0.7), true);
  assert.equal(shouldCommit(0.4, -0.7), true);
  assert.equal(shouldCommit(0.39, -0.7), false);
  assert.equal(shouldCommit(0.39, 0), false);
  assert.equal(shouldCommit(0.4, 0), true);
});

test("automatic motion has bounded endpoints and no overshoot", () => {
  assert.equal(easedProgress(-1), 0);
  assert.equal(easedProgress(2), 1);
  const values = Array.from({ length: 101 }, (_, i) => easedProgress(i / 100));
  assert.ok(values.every((value, i) => i === 0 || value >= values[i - 1]));
});
