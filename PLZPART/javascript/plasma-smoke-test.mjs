import assert from "node:assert/strict";
import fs from "node:fs";
import {
  PLASMA_HEIGHT,
  PLASMA_WIDTH,
  SecondRealityPlasma,
  dropLineCompare,
  generatePalettes,
  generateTables,
} from "./second-reality-plasma.mjs";

function parseAsmNumbers(path) {
  const text = fs.readFileSync(new URL(path, import.meta.url), "utf8");
  return Array.from(text.matchAll(/-?\d+/g), (match) => Number(match[0]));
}

const tables = generateTables();

assert.deepEqual(
  Array.from(tables.ptau.slice(0, 17)),
  [0, 1, 1, 1, 1, 1, 2, 2, 3, 3, 4, 5, 6, 7, 8, 9, 10],
);
assert.equal(tables.psini.length, 16384);
assert.equal(tables.lsini4.length, 8192);
assert.equal(tables.lsini16.length, 8192);
assert.deepEqual(Array.from(tables.ptau), parseAsmNumbers("../PTAU.INC"));
assert.deepEqual(Array.from(tables.psini), parseAsmNumbers("../PSINI.INC"));
assert.deepEqual(Array.from(tables.lsini4), parseAsmNumbers("../LSINI4.INC"));
assert.deepEqual(Array.from(tables.lsini16), parseAsmNumbers("../LSINI16.INC"));

const palettes = generatePalettes(tables.ptau);
assert.equal(palettes.length, 5);
assert.equal(palettes[0].length, 256 * 3);

const plasma = new SecondRealityPlasma({ tables, palettes, autoCycle: false });
assert.equal(plasma.plasmaByte(0, 0, [3500, 2300, 3900, 3670]), 132);
assert.equal(plasma.plasmaByte(17, 23, [1000, 2000, 3000, 4000]), 243);
const indexed = plasma.renderIndexedFrame();
assert.equal(indexed.length, PLASMA_WIDTH * PLASMA_HEIGHT);
assert.notEqual(indexed[0], indexed[1], "planar checkerboard should interleave phase sets");

const rgba = new Uint8ClampedArray(PLASMA_WIDTH * PLASMA_HEIGHT * 4);
plasma.renderRGBAFrame(rgba);
assert.equal(rgba.length, PLASMA_WIDTH * PLASMA_HEIGHT * 4);
assert.equal(rgba[3], 255);

plasma.step(1);
assert.deepEqual(plasma.k, [3497, 2298, 3901, 3672]);
assert.deepEqual(plasma.l, [999, 1998, 3002, 4003]);

assert.equal(dropLineCompare(0), 60);
assert.equal(dropLineCompare(64), 404);

console.log("Second Reality plasma JavaScript smoke test passed");
