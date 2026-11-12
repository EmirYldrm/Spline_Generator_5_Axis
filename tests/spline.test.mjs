import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
async function loadModule(relativePath) {
  const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

const { generatePath } = await loadModule("../spline.js");
const { generateGcode } = await loadModule("../gcode.js");
const recorded = [
  { x: -30, y: 0, z: 20, c: 350, a: 0 },
  { x: -21.2, y: 0, z: 41.2, c: 355, a: 5 },
  { x: 0, y: 0, z: 50, c: 0, a: 10 },
  { x: 21.2, y: 0, z: 41.2, c: 5, a: 5 },
  { x: 30, y: 0, z: 20, c: 10, a: 0 }
];

for (const method of ["centripetal", "natural", "clamped", "linear"]) {
  const result = generatePath(recorded, { method, step: 1, rotaryStep: 5, unwrap: true });
  assert.ok(result.points.length > 5, `${method} should produce a sampled path`);
  for (const point of recorded) {
    assert.ok(result.points.some(sample =>
      Math.hypot(sample.x - point.x, sample.y - point.y, sample.z - point.z) < 1e-7),
    `${method} should pass through each recorded point`);
  }
}

const unwrapped = generatePath(recorded, { step: 1, rotaryStep: 5, unwrap: true }).points;
assert.ok(unwrapped.some(point => Math.abs(point.c - 360) < 1e-7));
for (let i = 1; i < unwrapped.length; i += 1) {
  assert.ok(Math.abs(unwrapped[i].c - unwrapped[i - 1].c) <= 5 + 1e-7);
}

const coarse = generatePath(recorded, { step: 4, rotaryStep: 5 });
const fine = generatePath(recorded, { step: 0.5, rotaryStep: 5 });
assert.ok(fine.points.length > coarse.points.length);
const looseTolerance = generatePath(recorded, {
  samplingMode: "tolerance", chordTolerance: 1, rotaryStep: 5
});
const tightTolerance = generatePath(recorded, {
  samplingMode: "tolerance", chordTolerance: 0.1, rotaryStep: 5
});
assert.ok(tightTolerance.points.length > looseTolerance.points.length);

const directedTurn = generatePath([
  { x: 0, y: 0, z: 0, c: 0, a: 0 },
  { x: 10, y: 0, z: 0, c: 10, a: 0 },
  { x: 20, y: 0, z: 0, c: 350, a: 0 }
], { step: 5, rotaryStep: 20, unwrap: true });
assert.equal(directedTurn.points.at(-1).c, 350);

const rotaryOnly = generatePath([
  { x: 0, y: 0, z: 0, c: 0, a: 0 },
  { x: 0, y: 0, z: 0, c: 30, a: 0 }
], { step: 2, rotaryStep: 5 });
assert.ok(rotaryOnly.points.length > 2);
for (let i = 1; i < rotaryOnly.points.length; i += 1) {
  assert.ok(Math.abs(rotaryOnly.points[i].c - rotaryOnly.points[i - 1].c) <= 5 + 1e-7);
}

const closed = generatePath(recorded, { step: 2, rotaryStep: 5, closed: true });
assert.deepEqual(
  [closed.points[0].x, closed.points[0].y, closed.points[0].z],
  [closed.points.at(-1).x, closed.points.at(-1).y, closed.points.at(-1).z]
);

const code = generateGcode(fine.points, {
  header: "G90\nG21", safeZ: 50, weldStart: "M3", weldEnd: "M5",
  startDelay: 0.5, endDelay: 0.5, retract: 5, feedRate: 300,
  firstFeed: 120, lastFeed: 80, decimals: 1,
  lineNumbers: true
});
assert.ok(code.includes("N10 G90"));
assert.ok(code.includes("G4 P0.5"));
assert.match(code, /G1 X-30\.0 Y0\.0 Z20\.0 C350\.0 A0\.0 F300\.0/);
assert.equal((code.match(/G1 X/g) || []).length, fine.points.length);
const moves = code.split("\n").filter(line => line.includes("G1 X"));
assert.match(moves[1], / F120\.0$/);
assert.match(moves.at(-1), / F80\.0$/);

assert.throws(() => generatePath(recorded, { step: 0 }), /adımı/);
console.log("Spline ve G-code testleri başarılı.");
