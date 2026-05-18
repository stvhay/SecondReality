// Match the constant used by PLZ.C's disabled DO_TABLES generator. Math.PI is
// more precise, but the checked-in tables came from this 1993-era literal.
const ORIGINAL_PI = 3.1415926535;
const TWO_PI = ORIGINAL_PI * 2;

export const PLASMA_WIDTH_BYTES = 80;
export const PLASMA_WIDTH = PLASMA_WIDTH_BYTES * 4;
export const PLASMA_HEIGHT = 280;
export const VGA_SIGNAL_WIDTH = 320;
export const VGA_SIGNAL_HEIGHT = 400;
export const VGA_PLASMA_TOP = 60;
export const VGA_FPS = 70;
export const DEFAULT_MUSIC_TICK_RATE = 50;

const PHASE_MASK = 4095;
const PSINI_MASK = 16383;
const LSINI_MASK = 8191;

const INITIAL_L = [1000, 2000, 3000, 4000];
const INITIAL_K = [3500, 2300, 3900, 3670];

const PHASE_PRESETS = [
  { l: [1000, 2000, 3000, 4000], k: [3500, 2300, 3900, 3670] },
  { l: [1000, 2000, 4000, 4000], k: [1500, 2300, 3900, 1670] },
  { l: [3500, 1000, 3000, 1000], k: [3500, 3300, 2900, 2670] },
  { l: [1000, 2000, 3000, 4000], k: [3500, 2300, 3900, 3670] },
  { l: [1000, 2000, 3000, 4000], k: [3500, 2300, 3900, 3670] },
  { l: [1000, 2000, 3000, 4000], k: [3500, 2300, 3900, 3670] },
];

// PLZ.C compares DIS/STMIK music tick frames, not VGA frames. The fifth table
// value is unreachable in practice because the part exits after palette 4's
// drop has crossed frame 64.
const PALETTE_SWITCH_MUSIC_FRAMES = [
  64 * 6 * 2 - 45,
  64 * 6 * 4 - 45,
  64 * 6 * 5 - 45,
  64 * 6 * 6 - 45,
];

function cInt(value) {
  return value < 0 ? Math.ceil(value) : Math.floor(value);
}

function clamp8(value) {
  return Math.max(0, Math.min(255, value));
}

function vga6To8(value) {
  return clamp8(Math.round((value * 255) / 63));
}

function wrapPhase(value) {
  return value & PHASE_MASK;
}

function makeDefaultTables() {
  const psini = new Int16Array(16384);
  const lsini4 = new Int16Array(8192);
  const lsini16 = new Int16Array(8192);
  const ptau = new Int16Array(129);

  for (let a = 0; a < psini.length; a += 1) {
    const theta = (a * TWO_PI) / 4096;
    psini[a] = cInt(
      Math.sin(theta) * 55 +
        Math.sin(theta * 6) * 5 +
        Math.sin(theta * 21) * 4 +
        64,
    );

    if (a < lsini4.length) {
      lsini4[a] = cInt(
        (Math.sin(theta) * 55 +
          Math.sin(theta * 5) * 8 +
          Math.sin(theta * 15) * 2 +
          64) *
          8,
      );
      lsini16[a] = cInt(
        (Math.sin(theta) * 55 +
          Math.sin(theta * 4) * 5 +
          Math.sin(theta * 17) * 3 +
          64) *
          16,
      );
    }
  }

  ptau[0] = 0;
  for (let a = 1; a <= 128; a += 1) {
    ptau[a] = cInt(Math.cos((a * TWO_PI) / 128 + ORIGINAL_PI) * 31 + 32);
  }

  // The source-controlled LSINI4.INC differs from the nominal C formula at the
  // two quarter-turn minima. Keep the port byte-for-byte aligned with the table
  // the assembly actually includes.
  lsini4[3072] = 23;
  lsini4[7168] = 23;

  return { psini, lsini4, lsini16, ptau };
}

let sharedTables;

export function generateTables() {
  return makeDefaultTables();
}

export function getSharedTables() {
  if (!sharedTables) {
    sharedTables = makeDefaultTables();
  }
  return sharedTables;
}

function writeRaw(raw, color, r, g, b) {
  const offset = color * 3;
  raw[offset] = r;
  raw[offset + 1] = g;
  raw[offset + 2] = b;
}

function makeRawPalette(build) {
  const raw = new Int16Array(256 * 3);
  let color = 1;
  const put = (r, g, b) => {
    writeRaw(raw, color, r, g, b);
    color += 1;
  };
  build(put);
  return raw;
}

function paletteFromRaw(raw) {
  const palette = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < raw.length; i += 1) {
    palette[i] = vga6To8(raw[i]);
  }
  return palette;
}

function paletteFromAccumulator(target, highBytes) {
  for (let i = 0; i < highBytes.length; i += 1) {
    target[i] = vga6To8(highBytes[i] & 63);
  }
  return target;
}

function generateRawPalettes(ptau = getSharedTables().ptau) {
  const rawPalettes = [];

  rawPalettes.push(
    makeRawPalette((put) => {
      for (let a = 1; a < 64; a += 1) put(ptau[a], ptau[0], ptau[0]);
      for (let a = 0; a < 64; a += 1) put(ptau[63 - a], ptau[0], ptau[0]);
      for (let a = 0; a < 64; a += 1) put(ptau[0], ptau[0], ptau[a]);
      for (let a = 0; a < 64; a += 1) put(ptau[a], ptau[0], ptau[63 - a]);
    }),
  );

  rawPalettes.push(
    makeRawPalette((put) => {
      for (let a = 1; a < 64; a += 1) put(ptau[a], ptau[0], ptau[0]);
      for (let a = 0; a < 64; a += 1) put(ptau[63 - a], ptau[0], ptau[a]);
      for (let a = 0; a < 64; a += 1) put(ptau[0], ptau[a], ptau[63 - a]);
      for (let a = 0; a < 64; a += 1) put(ptau[a], ptau[63], ptau[a]);
    }),
  );

  rawPalettes.push(
    makeRawPalette((put) => {
      for (let a = 1; a < 64; a += 1) put(ptau[0] / 2, ptau[0] / 2, ptau[0] / 2);
      for (let a = 0; a < 64; a += 1) put(ptau[a] / 2, ptau[a] / 2, ptau[a] / 2);
      for (let a = 0; a < 64; a += 1) put(ptau[63 - a] / 2, ptau[63 - a] / 2, ptau[63 - a] / 2);
      for (let a = 0; a < 64; a += 1) put(ptau[0] / 2, ptau[0] / 2, ptau[0] / 2);
    }),
  );

  rawPalettes.push(
    makeRawPalette((put) => {
      for (let a = 1; a < 64; a += 1) put(ptau[a], ptau[0], ptau[0]);
      for (let a = 0; a < 64; a += 1) put(ptau[63], ptau[a], ptau[a]);
      for (let a = 0; a < 64; a += 1) put(ptau[63 - a], ptau[63 - a], ptau[63]);
      for (let a = 0; a < 64; a += 1) put(ptau[0], ptau[0], ptau[63]);
    }),
  );

  rawPalettes.push(
    makeRawPalette((put) => {
      for (let a = 1; a < 75; a += 1) {
        const t = ptau[63 - cInt((a * 64) / 75)];
        put(t, t, t);
      }
      for (let a = 0; a < 106; a += 1) put(0, 0, 0);
      for (let a = 0; a < 75; a += 1) {
        const t = ptau[cInt((a * 64) / 75)];
        put(cInt((t * 8) / 10), cInt((t * 9) / 10), t);
      }
    }),
  );

  return rawPalettes;
}

export function generatePalettes(ptau = getSharedTables().ptau) {
  return generateRawPalettes(ptau).map(paletteFromRaw);
}

export function generatePaletteDeltas(ptau = getSharedTables().ptau) {
  return generateRawPalettes(ptau).map((raw, paletteIndex) => {
    const deltas = new Int16Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) {
      // PLZ.C converts the first palette into a 128-frame fade from white.
      // Later palettes are 32-frame-ish black-to-palette fixed-point deltas.
      deltas[i] = paletteIndex === 0 ? (raw[i] - 63) * 2 : raw[i] * 8;
    }
    return deltas;
  });
}

export function dropLineCompare(dropCounter, frame = 0) {
  if (dropCounter <= 0) {
    return VGA_PLASMA_TOP + (frame & 1);
  }
  if (dropCounter <= 64) {
    return cInt((((dropCounter * dropCounter) / 4) * 43) / 128 + VGA_PLASMA_TOP);
  }
  if (dropCounter === 65) {
    return VGA_SIGNAL_HEIGHT;
  }
  if (dropCounter > 96 && dropCounter < 128) {
    return VGA_PLASMA_TOP + (frame & 1);
  }
  return VGA_PLASMA_TOP;
}

export class SecondRealityPlasma {
  constructor(options = {}) {
    this.tables = options.tables || getSharedTables();
    this.palettes = options.palettes || generatePalettes(this.tables.ptau);
    this.paletteDeltas = options.paletteDeltas || generatePaletteDeltas(this.tables.ptau);
    this.widthBytes = options.widthBytes || PLASMA_WIDTH_BYTES;
    this.width = this.widthBytes * 4;
    this.height = options.height || PLASMA_HEIGHT;
    this.signalWidth = options.signalWidth || VGA_SIGNAL_WIDTH;
    this.signalHeight = options.signalHeight || VGA_SIGNAL_HEIGHT;
    this.autoCycle = options.autoCycle !== false;
    this.loop = options.loop !== false;
    this.emulatePaletteFades = options.emulatePaletteFades !== false;
    this.musicTickRate = options.musicTickRate || DEFAULT_MUSIC_TICK_RATE;
    this.musicTicksPerFrame = this.musicTickRate / VGA_FPS;
    this.paletteSwitchMusicFrames =
      options.paletteSwitchMusicFrames || PALETTE_SWITCH_MUSIC_FRAMES;
    this.indexedFrame = new Uint8Array(this.width * this.height);
    this.rgbaFrame = new Uint8ClampedArray(this.width * this.height * 4);
    this.signalFrame = new Uint8ClampedArray(this.signalWidth * this.signalHeight * 4);
    this.displayPalette = new Uint8ClampedArray(256 * 3);
    this.fadeHigh = new Uint8Array(256 * 3);
    this.fadeLow = new Uint8Array(256 * 3);
    this.fadeDeltaIndex = 0;
    this.pendingPresetIndex = null;
    this.reset();
  }

  reset() {
    this.frame = 0;
    this.musicFrame = 0;
    this.paletteIndex = 0;
    this.nextPaletteSwitch = 0;
    this.dropCounter = 128;
    this.l = INITIAL_L.slice();
    this.k = INITIAL_K.slice();
    this.fadeHigh.fill(63);
    this.fadeLow.fill(0);
    this.fadeDeltaIndex = 0;
    this.pendingPresetIndex = null;
  }

  applyPreset(index) {
    const preset = PHASE_PRESETS[index % PHASE_PRESETS.length];
    this.l = preset.l.slice();
    this.k = preset.k.slice();
    this.paletteIndex = Math.min(index, this.palettes.length - 1);
  }

  setPreset(index, options = {}) {
    if (options.immediate) {
      this.applyPreset(index);
      this.dropCounter = 1;
      this.fadeHigh.fill(0);
      this.fadeDeltaIndex = Math.min(index, this.paletteDeltas.length - 1);
      this.pendingPresetIndex = null;
      return;
    }

    this.pendingPresetIndex = index;
    this.fadeDeltaIndex = Math.min(index, this.paletteDeltas.length - 1);
    // PLZ.C clears only the visible DAC bytes; the fractional accumulator at
    // fadepal+768 is intentionally left as-is.
    this.fadeHigh.fill(0);
    this.dropCounter = 1;
  }

  currentLineCompare() {
    return dropLineCompare(this.dropCounter, this.frame);
  }

  currentPalette() {
    if (!this.emulatePaletteFades) {
      return this.palettes[this.paletteIndex];
    }
    return paletteFromAccumulator(this.displayPalette, this.fadeHigh);
  }

  updatePaletteAccumulator() {
    const deltas = this.paletteDeltas[this.fadeDeltaIndex];
    for (let i = 0; i < deltas.length; i += 1) {
      const delta = deltas[i];
      const lowAdd = delta & 255;
      const highAdd = (delta >> 8) & 255;
      const low = this.fadeLow[i] + lowAdd;
      this.fadeLow[i] = low & 255;
      this.fadeHigh[i] = (this.fadeHigh[i] + highAdd + (low > 255 ? 1 : 0)) & 255;
    }
  }

  advanceDropAndPalette() {
    if (this.dropCounter <= 0) {
      return;
    }

    this.dropCounter += 1;
    if (this.dropCounter >= 256) {
      this.dropCounter = 0;
      return;
    }

    if (this.dropCounter <= 64) {
      return;
    }

    if (this.dropCounter > 96 && this.dropCounter < 128) {
      this.dropCounter = 0;
      return;
    }

    if (this.dropCounter === 65) {
      if (this.pendingPresetIndex !== null) {
        this.applyPreset(this.pendingPresetIndex);
        this.pendingPresetIndex = null;
      }
      return;
    }

    this.updatePaletteAccumulator();
  }

  plasmaByte(y, byteX, phases) {
    const [c1, c2, c3, c4] = phases;
    const y2 = y << 1;
    const reverseX = PLASMA_WIDTH_BYTES - byteX;
    const firstWave = this.tables.lsini16[(c2 + y + reverseX * 4) & LSINI_MASK];
    const secondWave = this.tables.lsini4[(c4 + y + byteX * 16) & LSINI_MASK];

    const firstIndex = (byteX * 8 + firstWave + c1) & PSINI_MASK;
    const secondIndex = (secondWave + y2 + c3 + reverseX * 4) & PSINI_MASK;

    return (this.tables.psini[firstIndex] + this.tables.psini[secondIndex]) & 255;
  }

  renderIndexedFrame(target = this.indexedFrame) {
    for (let y = 0; y < this.height; y += 1) {
      let offset = y * this.width;
      const oddLine = y & 1;

      for (let byteX = 0; byteX < this.widthBytes; byteX += 1) {
        const k = this.plasmaByte(y, byteX, this.k);
        const l = this.plasmaByte(y, byteX, this.l);

        if (oddLine) {
          target[offset] = k;
          target[offset + 1] = l;
          target[offset + 2] = k;
          target[offset + 3] = l;
        } else {
          target[offset] = l;
          target[offset + 1] = k;
          target[offset + 2] = l;
          target[offset + 3] = k;
        }

        offset += 4;
      }
    }
    return target;
  }

  renderRGBAFrame(target, palette = this.currentPalette()) {
    const indexed = this.renderIndexedFrame();
    for (let i = 0, o = 0; i < indexed.length; i += 1, o += 4) {
      const color = indexed[i] * 3;
      target[o] = palette[color];
      target[o + 1] = palette[color + 1];
      target[o + 2] = palette[color + 2];
      target[o + 3] = 255;
    }
    return target;
  }

  renderSignalFrame(target = this.signalFrame, palette = this.currentPalette()) {
    target.fill(0);
    this.renderRGBAFrame(this.rgbaFrame, palette);

    const plasmaTop = this.currentLineCompare();
    for (let y = 0; y < this.height; y += 1) {
      const destY = plasmaTop + y;
      if (destY < 0 || destY >= this.signalHeight) continue;

      const srcOffset = y * this.width * 4;
      const destOffset = destY * this.signalWidth * 4;
      target.set(this.rgbaFrame.subarray(srcOffset, srcOffset + this.width * 4), destOffset);
    }

    return target;
  }

  drawToCanvas(canvasOrContext, options = {}) {
    const context =
      typeof canvasOrContext.getContext === "function"
        ? canvasOrContext.getContext("2d")
        : canvasOrContext;
    const canvas = context.canvas;
    const signal = options.signal === true;
    const width = signal ? this.signalWidth : this.width;
    const height = signal ? this.signalHeight : this.height;

    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;

    if (!this.imageData || this.imageData.width !== width || this.imageData.height !== height) {
      this.imageData = context.createImageData(width, height);
    }

    if (signal) {
      this.renderSignalFrame(this.imageData.data);
    } else {
      this.renderRGBAFrame(this.imageData.data);
    }
    context.putImageData(this.imageData, 0, 0);
  }

  advancePhases() {
    this.k[0] = wrapPhase(this.k[0] - 3);
    this.k[1] = wrapPhase(this.k[1] - 2);
    this.k[2] = wrapPhase(this.k[2] + 1);
    this.k[3] = wrapPhase(this.k[3] + 2);

    this.l[0] = wrapPhase(this.l[0] - 1);
    this.l[1] = wrapPhase(this.l[1] - 2);
    this.l[2] = wrapPhase(this.l[2] + 2);
    this.l[3] = wrapPhase(this.l[3] + 3);
  }

  step(frames = 1) {
    for (let i = 0; i < frames; i += 1) {
      const nextMusicFrame = this.musicFrame + this.musicTicksPerFrame;
      if (
        this.autoCycle &&
        this.nextPaletteSwitch < this.paletteSwitchMusicFrames.length &&
        nextMusicFrame > this.paletteSwitchMusicFrames[this.nextPaletteSwitch]
      ) {
        this.setPreset(this.nextPaletteSwitch + 1);
        this.nextPaletteSwitch += 1;
      }

      this.advancePhases();
      this.frame += 1;
      this.musicFrame = nextMusicFrame;
      this.advanceDropAndPalette();

      const restartMusicFrame =
        this.paletteSwitchMusicFrames[this.paletteSwitchMusicFrames.length - 1] + 64 + this.musicTickRate * 4;
      if (this.loop && this.musicFrame > restartMusicFrame) {
        this.reset();
      }
    }
  }
}

export function mountSecondRealityPlasma(options = {}) {
  const canvas =
    typeof options.canvas === "string"
      ? document.querySelector(options.canvas)
      : options.canvas || document.querySelector("[data-second-reality-plasma]");
  if (!canvas) {
    throw new Error("No canvas supplied for Second Reality plasma");
  }

  const status =
    typeof options.status === "string" ? document.querySelector(options.status) : options.status;
  const plasma = new SecondRealityPlasma(options);
  const fps = options.fps || VGA_FPS;
  const frameMs = 1000 / fps;
  let presentation = options.presentation || "crt";
  let requestId = 0;
  let previous = 0;
  let accumulator = 0;
  let running = false;

  function updateStatus() {
    if (!status) return;
    status.textContent = `vga ${plasma.frame} | music ${Math.floor(plasma.musicFrame)} | palette ${plasma.paletteIndex + 1}/${plasma.palettes.length} | line compare ${plasma.currentLineCompare()} | ${presentation}`;
  }

  function draw() {
    plasma.drawToCanvas(canvas, { signal: presentation !== "active" });
    canvas.dataset.presentation = presentation;
  }

  function tick(now) {
    if (!running) return;
    if (!previous) previous = now;
    accumulator += now - previous;
    previous = now;

    const frames = Math.min(4, Math.floor(accumulator / frameMs));
    if (frames > 0) {
      accumulator = Math.max(0, accumulator - frames * frameMs);
      plasma.step(frames);
      draw();
      updateStatus();
    }
    requestId = requestAnimationFrame(tick);
  }

  function start() {
    if (running) return;
    running = true;
    previous = 0;
    requestId = requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    if (requestId) {
      cancelAnimationFrame(requestId);
      requestId = 0;
    }
  }

  function setPresentation(nextPresentation) {
    presentation = nextPresentation;
    draw();
    updateStatus();
  }

  draw();
  updateStatus();
  if (options.autostart !== false) {
    start();
  }

  return { plasma, start, stop, draw, setPresentation };
}
