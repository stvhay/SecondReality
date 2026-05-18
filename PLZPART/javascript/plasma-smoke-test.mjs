import assert from "node:assert/strict";
import {
  PLASMA_HEIGHT,
  PLASMA_WIDTH,
  SecondRealityPlasma,
  dropLineCompare,
  generatePalettes,
  generateTables,
} from "./second-reality-plasma.mjs";

const tables = generateTables();

assert.deepEqual(
  Array.from(tables.ptau.slice(0, 17)),
  [0, 1, 1, 1, 1, 1, 2, 2, 3, 3, 4, 5, 6, 7, 8, 9, 10],
);
assert.equal(tables.psini.length, 16384);
assert.equal(tables.lsini4.length, 8192);
assert.equal(tables.lsini16.length, 8192);

const palettes = generatePalettes(tables.ptau);
assert.equal(palettes.length, 5);
assert.equal(palettes[0].length, 256 * 3);

const plasma = new SecondRealityPlasma({ tables, palettes, autoCycle: false });
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
