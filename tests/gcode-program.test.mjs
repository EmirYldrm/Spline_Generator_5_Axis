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

const ankaraProgram = [
  "G0 X0 Y0 Z0.3 W-437 A-12.5 C223.5 F250 ; approach must stay unchanged",
  "M3 ; weld on",
  "G1 X1 Y2 Z101 W-456.2 A-12.5 C223.5 F500",
  "G1 X5 Y20 Z202 W-416.2 A-10.5 C255.5 F500",
  "G1 X50 Y45 Z303 W-406.2 A-5.5 C285.5 F500",
  "M5 ; weld off"
].join("\r\n");
const ankaraLinearBlock = [
  "G0 X21.6 Y1381.8 Z0.3 W-445.5 A-12.5 C223.5",
  "M3",
  "G1 X20.7 Y1381.8 Z0.3 W-472.2 A-12.5 C223.5 F500",
  "M5"
].join("\r\n");
assert.equal(
  applySplineToProgram(ankaraLinearBlock, generatePath, {}, 3, "ankara-6eksen").text,
  ankaraLinearBlock,
  "single-G1 Ankara weld blocks are preserved byte-for-byte"
);
const ankara = applySplineToProgram(ankaraProgram, generatePath, { step: 10, rotaryStep: 10 }, 3, "ankara-6eksen");
const ankaraLines = ankara.text.split("\r\n");
assert.equal(ankara.convertedBlocks, 1);
assert.ok(ankaraLines.includes("G0 X0 Y0 Z0.3 W-437 A-12.5 C223.5 F250 ; approach must stay unchanged"));
assert.ok(ankaraLines.includes("M3 ; weld on"));
assert.ok(ankaraLines.includes("M5 ; weld off"));
const ankaraMoves = ankaraLines.filter(line => line.startsWith("G1 "));
assert.ok(ankaraMoves.length > 3);
assert.match(ankaraMoves[0], /^G1 X1\.000 Y2\.000 W-456\.200 A-12\.500 C223\.500 F500\.000$/);
assert.match(ankaraMoves.at(-1), /^G1 X50\.000 Y45\.000 W-406\.200 A-5\.500 C285\.500 F500\.000$/);
assert.ok(ankaraMoves.every(line => !/\bZ[-+.\d]/.test(line)), "Ankara spline rows omit physical Z");
assert.ok(ankaraMoves.every(line => /\bW[-+.\d]/.test(line)), "Ankara spline rows output logical Z as W");
assert.equal(ankara.weldBlocks[0].points[0].z, -456.2, "W is interpreted as logical Z");
assert.equal(ankara.weldBlocks[0].points[0].a, -12.5);

const multipleSplineProgram = [
  "G0 X0 Y0 Z0 W0 A0 C0 ; initial approach",
  "M3 ; first weld on",
  "G1 X1 Y0 Z900 W-10 A0 C0 F100",
  "G1 X5 Y5 Z901 W-20 A5 C5 F100",
  "M5 ; first weld off",
  "G0 X100 Y100 Z0 W-100 A0 C0 ; untouched travel",
  "M3 ; second weld on",
  "G1 X100 Y100 Z800 W-100 A0 C0 F250",
  "G1 X110 Y120 Z801 W-120 A10 C20 F250",
  "M5 ; second weld off",
  "M30"
].join("\r\n");
const multipleSplines = applySplineToProgram(
  multipleSplineProgram, generatePath, { step: 5, rotaryStep: 10 }, 2, "ankara-6eksen"
);
const multipleLines = multipleSplines.text.split("\r\n");
assert.equal(multipleSplines.convertedBlocks, 2, "both separate multi-G1 weld blocks are splined");
assert.equal(multipleSplines.weldBlocks.length, 2);
assert.equal(multipleSplines.weldBlocks[0].path[0].z, -10);
assert.equal(multipleSplines.weldBlocks[0].path.at(-1).z, -20);
assert.equal(multipleSplines.weldBlocks[1].path[0].z, -100);
assert.equal(multipleSplines.weldBlocks[1].path.at(-1).z, -120);
assert.ok(multipleLines.includes("G0 X100 Y100 Z0 W-100 A0 C0 ; untouched travel"));
assert.ok(multipleLines.includes("M3 ; first weld on"));
assert.ok(multipleLines.includes("M5 ; first weld off"));
assert.ok(multipleLines.includes("M3 ; second weld on"));
assert.ok(multipleLines.includes("M5 ; second weld off"));
const firstWeldStart = multipleLines.indexOf("M3 ; first weld on");
const firstWeldEnd = multipleLines.indexOf("M5 ; first weld off");
const secondWeldStart = multipleLines.indexOf("M3 ; second weld on");
const secondWeldEnd = multipleLines.indexOf("M5 ; second weld off");
const firstWeldRows = multipleLines.slice(firstWeldStart + 1, firstWeldEnd);
const secondWeldRows = multipleLines.slice(secondWeldStart + 1, secondWeldEnd);
assert.ok(firstWeldRows.every(line => line.startsWith("G1 ") && /\bW[-+.\d]/.test(line) && !/\bZ[-+.\d]/.test(line)));
assert.ok(secondWeldRows.every(line => line.startsWith("G1 ") && /\bW[-+.\d]/.test(line) && !/\bZ[-+.\d]/.test(line)));
assert.match(firstWeldRows[0], /W-10\.00/);
assert.match(firstWeldRows.at(-1), /W-20\.00/);
assert.match(secondWeldRows[0], /W-100\.00/);
assert.match(secondWeldRows.at(-1), /W-120\.00/);

console.log("Tam G-code spline dönüşüm testleri başarılı.");
