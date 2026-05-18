// Match the constant used by PLZ.C's disabled DO_TABLES generator. Math.PI is
// more precise, but the checked-in tables came from this 1993-era literal.
const ORIGINAL_PI = 3.1415926535;
const TWO_PI = ORIGINAL_PI * 2;

export const PLASMA_WIDTH_BYTES = 84;
export const PLASMA_WIDTH = PLASMA_WIDTH_BYTES * 4;
export const PLASMA_HEIGHT = 280;
export const VGA_FPS = 70;

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

// PLZ.C switches on music frames. In the browser port the same numbers are
// treated as rendered VGA frames so the sequence can run without the DIS player.
const PALETTE_SWITCH_FRAMES = [
  64 * 6 * 2 - 45,
  64 * 6 * 4 - 45,
  64 * 6 * 5 - 45,
  64 * 6 * 6 - 45,
  64 * 6 * 7 + 90,
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

function solidPalette(vgaValue) {
  const palette = new Uint8ClampedArray(256 * 3);
  palette.fill(vga6To8(vgaValue));
  return palette;
}

function blendPalettes(target, from, to, amount) {
  const t = Math.max(0, Math.min(1, amount));
  for (let i = 0; i < target.length; i += 1) {
    target[i] = from[i] + (to[i] - from[i]) * t;
  }
  return target;
}

export function generatePalettes(ptau = getSharedTables().ptau) {
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

  return rawPalettes.map(paletteFromRaw);
}

export function dropLineCompare(dropCounter) {
  if (dropCounter <= 0) {
    return 60;
  }
  if (dropCounter <= 64) {
    return cInt((((dropCounter * dropCounter) / 4) * 43) / 128 + 60);
  }
  return 400;
}

export class SecondRealityPlasma {
  constructor(options = {}) {
    this.tables = options.tables || getSharedTables();
    this.palettes = options.palettes || generatePalettes(this.tables.ptau);
    this.widthBytes = options.widthBytes || PLASMA_WIDTH_BYTES;
    this.width = this.widthBytes * 4;
    this.height = options.height || PLASMA_HEIGHT;
    this.autoCycle = options.autoCycle !== false;
    this.loop = options.loop !== false;
    this.emulatePaletteFades = options.emulatePaletteFades !== false;
    this.paletteSwitchFrames = options.paletteSwitchFrames || PALETTE_SWITCH_FRAMES;
    this.indexedFrame = new Uint8Array(this.width * this.height);
    this.displayPalette = new Uint8ClampedArray(256 * 3);
    this.fadeFromPalette = solidPalette(63);
    this.fadeTargetPalette = this.palettes[0].slice();
    this.fadeFrame = 0;
    this.fadeLength = 128;
    this.reset();
  }

  reset() {
    this.frame = 0;
    this.paletteIndex = 0;
    this.nextPaletteSwitch = 0;
    this.dropCounter = 128;
    this.l = INITIAL_L.slice();
    this.k = INITIAL_K.slice();
    this.fadeFromPalette = solidPalette(63);
    this.fadeTargetPalette = this.palettes[0].slice();
    this.fadeFrame = 0;
    this.fadeLength = 128;
  }

  setPreset(index) {
    const preset = PHASE_PRESETS[index % PHASE_PRESETS.length];
    this.l = preset.l.slice();
    this.k = preset.k.slice();
    this.paletteIndex = Math.min(index, this.palettes.length - 1);
    this.dropCounter = 1;
    this.fadeFromPalette = solidPalette(0);
    this.fadeTargetPalette = this.palettes[this.paletteIndex].slice();
    this.fadeFrame = 0;
    this.fadeLength = 32;
  }

  currentLineCompare() {
    return dropLineCompare(this.dropCounter);
  }

  currentPalette() {
    if (!this.emulatePaletteFades) {
      return this.palettes[this.paletteIndex];
    }
    if (this.fadeFrame >= this.fadeLength) {
      return this.fadeTargetPalette;
    }
    return blendPalettes(
      this.displayPalette,
      this.fadeFromPalette,
      this.fadeTargetPalette,
      this.fadeFrame / this.fadeLength,
    );
  }

  plasmaByte(y, byteX, phases) {
    const [c1, c2, c3, c4] = phases;
    const y2 = y << 1;
    const firstWave =
      this.tables.lsini16[(c2 + y + ((80 - byteX) << 2)) & LSINI_MASK];
    const secondWave =
      this.tables.lsini4[(c4 + y + byteX * 48) & LSINI_MASK];

    const firstIndex = (byteX * 40 + firstWave + c1) & PSINI_MASK;
    const secondIndex = (secondWave + y2 + c3 - (byteX << 2) + 80 * 4) & PSINI_MASK;

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

  drawToCanvas(canvasOrContext) {
    const context =
      typeof canvasOrContext.getContext === "function"
        ? canvasOrContext.getContext("2d")
        : canvasOrContext;
    const canvas = context.canvas;

    if (canvas.width !== this.width) canvas.width = this.width;
    if (canvas.height !== this.height) canvas.height = this.height;

    if (!this.imageData || this.imageData.width !== this.width || this.imageData.height !== this.height) {
      this.imageData = context.createImageData(this.width, this.height);
    }

    this.renderRGBAFrame(this.imageData.data);
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
      if (
        this.autoCycle &&
        this.nextPaletteSwitch < this.paletteSwitchFrames.length &&
        this.frame >= this.paletteSwitchFrames[this.nextPaletteSwitch]
      ) {
        this.setPreset(this.nextPaletteSwitch + 1);
        this.nextPaletteSwitch += 1;
      }

      this.advancePhases();
      this.frame += 1;
      this.fadeFrame += 1;
      if (this.dropCounter > 0 && this.dropCounter < 256) {
        this.dropCounter += 1;
      }

      const restartFrame = this.paletteSwitchFrames[this.paletteSwitchFrames.length - 1] + VGA_FPS * 4;
      if (this.loop && this.frame > restartFrame) {
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
  let requestId = 0;
  let previous = 0;
  let accumulator = 0;
  let running = false;

  function updateStatus() {
    if (!status) return;
    status.textContent = `frame ${plasma.frame} | palette ${plasma.paletteIndex + 1}/${plasma.palettes.length} | line compare ${plasma.currentLineCompare()}`;
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
      plasma.drawToCanvas(canvas);
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

  plasma.drawToCanvas(canvas);
  updateStatus();
  if (options.autostart !== false) {
    start();
  }

  return { plasma, start, stop };
}
