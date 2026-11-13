import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function loadModule(relativePath) {
  const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

const { generatePath } = await loadModule("../spline.js");
const { applySplineToProgram } = await loadModule("../gcode-program.js");

const onePointBlock = [
  "G0 X21.6 Y1381.8 Z0.3 A-12.5 C223.5 ; approach",
  "M3 ; weld on",
  "G1 X20.7 Y1381.8 Z0.3 A-12.5 C223.5 F500 ; one linear point",
  "M5 ; weld off"
].join("\r\n");
const unchanged = applySplineToProgram(onePointBlock, generatePath, {}, 3);
assert.equal(unchanged.text, onePointBlock);
assert.equal(unchanged.convertedBlocks, 0);
assert.equal(unchanged.skippedBlocks, 1);

const program = [
  "G90 G21",
  "G0 X1 Y2 Z3 A4 C5 ; keep approach",
  "M3 ; first weld on",
  "G1 X2 Y3 Z4 A5 C6 F500",
  "M5 ; first weld off",
  "G0 X10 Y20 Z30 A0 C0 ; keep travel",
  "M3 ; second weld on",
  "; keep this block comment",
  "G1 X10 Y20 Z30 A0 C0 F500",
  "G1 X30 Y50 Z20 A10 C20 F500",
  "G1 X60 Y70 Z10 A20 C40 F500",
  "M5 ; second weld off",
  "M30"
].join("\r\n");
const transformed = applySplineToProgram(program, generatePath, { step: 10, rotaryStep: 10 }, 3);
const outputLines = transformed.text.split("\r\n");
assert.equal(transformed.convertedBlocks, 1);
assert.equal(transformed.skippedBlocks, 1);
assert.equal(transformed.weldBlocks.length, 2);
assert.equal(transformed.weldBlocks[0].points.length, 1);
assert.equal(transformed.weldBlocks[1].points.length, 3);
assert.ok(transformed.weldBlocks[1].path.length > transformed.weldBlocks[1].points.length);
assert.ok(outputLines.includes("G0 X1 Y2 Z3 A4 C5 ; keep approach"));
assert.ok(outputLines.includes("M3 ; first weld on"));
assert.ok(outputLines.includes("G1 X2 Y3 Z4 A5 C6 F500"));
assert.ok(outputLines.includes("M5 ; first weld off"));
assert.ok(outputLines.includes("G0 X10 Y20 Z30 A0 C0 ; keep travel"));
assert.ok(outputLines.includes("; keep this block comment"));
assert.ok(outputLines.includes("M3 ; second weld on"));
assert.ok(outputLines.includes("M5 ; second weld off"));
assert.ok(outputLines.includes("M30"));
assert.ok((transformed.text.match(/^G1 /gm) || []).length > 3);
assert.match(transformed.text, /G1 X[-\d.]+ Y[-\d.]+ Z[-\d.]+ C[-\d.]+ A[-\d.]+ F500\.000/);
assert.ok(!transformed.text.includes(" W"));

console.log("Tam G-code spline dönüşüm testleri başarılı.");
