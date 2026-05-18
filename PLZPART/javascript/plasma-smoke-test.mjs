import assert from "node:assert/strict";
import fs from "node:fs";
import {
  PLASMA_HEIGHT,
  PLASMA_WIDTH,
  SecondRealityPlasma,
  VGA_PLASMA_TOP,
  VGA_SIGNAL_HEIGHT,
  VGA_SIGNAL_WIDTH,
  dropLineCompare,
  generatePaletteDeltas,
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
const paletteDeltas = generatePaletteDeltas(tables.ptau);
assert.equal(palettes.length, 5);
assert.equal(palettes[0].length, 256 * 3);
assert.equal(paletteDeltas.length, 5);
assert.equal(paletteDeltas[0][0], -126);
assert.equal(paletteDeltas[1][3], 8);

const plasma = new SecondRealityPlasma({ tables, palettes, paletteDeltas, autoCycle: false });
assert.equal(plasma.plasmaQuad(0, 0, [3500, 2300, 3900, 3670]), 130);
assert.equal(plasma.plasmaQuad(17, 23, [1000, 2000, 3000, 4000]), 112);
const indexed = plasma.renderIndexedFrame();
assert.equal(indexed.length, PLASMA_WIDTH * PLASMA_HEIGHT);
assert.equal(indexed[0], plasma.plasmaQuad(0, 0, plasma.l));
assert.equal(indexed[4], plasma.plasmaQuad(0, 1, plasma.l));
assert.equal(plasma.plasmaByte(0, 0, plasma.l), plasma.plasmaQuad(0, 0, plasma.l));
assert.notEqual(indexed[0], indexed[1], "planar checkerboard should interleave phase sets");

const rgba = new Uint8ClampedArray(PLASMA_WIDTH * PLASMA_HEIGHT * 4);
plasma.renderRGBAFrame(rgba);
assert.equal(rgba.length, PLASMA_WIDTH * PLASMA_HEIGHT * 4);
assert.equal(rgba[3], 255);

const signal = plasma.renderSignalFrame();
assert.equal(signal.length, VGA_SIGNAL_WIDTH * VGA_SIGNAL_HEIGHT * 4);
assert.deepEqual(
  Array.from(signal.slice(VGA_PLASMA_TOP * VGA_SIGNAL_WIDTH * 4, VGA_PLASMA_TOP * VGA_SIGNAL_WIDTH * 4 + 4)),
  Array.from(rgba.slice(0, 4)),
);
assert.deepEqual(Array.from(signal.slice(0, 4)), [0, 0, 0, 0]);

plasma.step(1);
assert.deepEqual(plasma.k, [3497, 2298, 3901, 3672]);
assert.deepEqual(plasma.l, [999, 1998, 3002, 4003]);

assert.equal(dropLineCompare(0), VGA_PLASMA_TOP);
assert.equal(dropLineCompare(0, 1), VGA_PLASMA_TOP + 1);
assert.equal(dropLineCompare(64), 404);
assert.equal(dropLineCompare(65), VGA_SIGNAL_HEIGHT);
assert.equal(dropLineCompare(128), VGA_PLASMA_TOP);
assert.equal(dropLineCompare(100, 1), VGA_PLASMA_TOP + 1);

const transition = new SecondRealityPlasma({ tables, palettes, paletteDeltas, autoCycle: false });
transition.setPreset(1);
assert.deepEqual(transition.k, [3500, 2300, 3900, 3670]);
assert.equal(transition.dropCounter, 1);
transition.step(63);
assert.equal(transition.dropCounter, 64);
assert.notDeepEqual(transition.k, [1500, 2300, 3900, 1670]);
transition.step(1);
assert.equal(transition.dropCounter, 65);
assert.equal(transition.currentLineCompare(), VGA_SIGNAL_HEIGHT);
assert.deepEqual(transition.k, [1500, 2300, 3900, 1670]);
assert.deepEqual(transition.l, [1000, 2000, 4000, 4000]);
assert.equal(transition.paletteIndex, 1);
assert.equal(transition.fadeHigh[3], 0);
transition.step(1);
assert.equal(transition.fadeHigh[3], 0);
transition.step(30);
assert.equal(transition.fadeHigh[3], 0);
transition.step(1);
assert.equal(transition.dropCounter, 0);
assert.equal(transition.fadeHigh[3], 0);

const auto = new SecondRealityPlasma({ tables, palettes, paletteDeltas });
auto.step(1012);
assert.equal(auto.nextPaletteSwitch, 0);
assert.equal(auto.paletteIndex, 0);
auto.step(1);
assert.equal(auto.nextPaletteSwitch, 1);
assert.equal(auto.paletteIndex, 0);
assert.equal(auto.dropCounter, 2);
auto.step(63);
assert.equal(auto.paletteIndex, 1);
assert.equal(Math.floor(auto.musicFrame), 768);

console.log("Second Reality plasma JavaScript smoke test passed");
