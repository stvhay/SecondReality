# Second Reality PLZ plasma JavaScript port

This directory ports the plasma part listed in `SCRIPT` as `Plasma (WILDF)`,
immediately before `Plasmacube`, from the original DOS/VGA code to JavaScript.

Live demo:

https://stvhay.github.io/SecondReality/

Run it from this directory with any static HTTP server, then open
`index.html`:

```sh
python3 -m http.server 8000
```

The repository also includes `.github/workflows/plasma-pages.yml`, which
publishes this directory to GitHub Pages after changes land on `master`. It can
also be run manually from the Actions tab with `workflow_dispatch`.

## Source map

- `PLZPART/PLZ.C` owns the high-level part loop, palette presets, phase
  presets, and music-frame timing.
- `PLZPART/ASMYT.ASM` contains `plzline` and `setplzparas`, the hot plasma
  renderer.
- `PLZPART/COPPER.ASM` runs once per retrace via the demo system's interrupt
  hook. It advances the plasma phases, changes the VGA line-compare register
  during drops, and streams palette fades to the DAC.
- `PLZPART/TWEAK.ASM` sets the custom planar VGA mode used by the part.

## Three layers in this port

The demo now separates the effect into three layers so fidelity changes can be
traced back to the original source:

1. **Active plasma pixels**: the 320x280 chunky reconstruction of
   `ASMYT.ASM::plzline`. This is the lookup-table math and VGA plane
   checkerboard, before display timing.
2. **Raw VGA signal**: a 320x400 visible frame extracted from
   `TWEAK.ASM::tw_opengraph2`'s 384-byte scanline buffer. The 320x280 plasma is
   placed starting at scanline 60, and `COPPER.ASM::do_drop`'s line-compare
   curve can move it down during transitions.
3. **CRT/video transfer**: a deliberately non-source layer that applies browser
   presentation effects such as blur, saturation, scanlines, and vignette. This
   is where captured-video/CRT matching belongs; the raw VGA signal remains
   available for source-faithful comparisons.

The button in `index.html` cycles through these layers.

## Deterministic frame capture

The root `package.json` includes a Playwright helper for comparing exact frames
from the live demo or a local server:

```sh
npm install
npx playwright install chromium
npm run capture:plasma -- --presentation signal --frames 0,70,350,700,1012,1013,1076
```

Useful presentations are `active`, `signal`, and `crt`. The default output
directory is `captures/plasma`.

## Port status and traceability

| Original behavior | Source | Port status |
| --- | --- | --- |
| Sine lookup tables and palette ramps | `PLZ.C`, `*.INC` | Ported; smoke test compares generated tables to checked-in include files. |
| Unrolled plasma byte renderer | `ASMYT.ASM::plzline` | Ported as `plasmaByte` / `renderIndexedFrame`. |
| Plane-mask checkerboard interleave | `PLZ.C` writes masks `0x0a`/`0x05` | Ported into chunky pixels. |
| 70 Hz retrace phase stepping | `COPPER.ASM::moveplz` | Ported as fixed-step animation. |
| 320x400 visible VGA presentation | `TWEAK.ASM::tw_opengraph2`, `COPPER.ASM::pompota` | Ported as the "Raw VGA signal" view; the hidden 384-byte stride is collapsed to the visible 320-pixel window. |
| Line-compare drop | `COPPER.ASM::do_drop`, `dtau` | Partially ported: the band position follows the source curve, pending constants activate at `cop_drop == 65`, and transition drops reset after `cop_drop > 96`; exact latch/CRTC side effects are not emulated. |
| DAC fade accumulator | `COPPER.ASM::fadepal` | Ported as an 8.8 fixed-point high/low-byte accumulator using the same `pals[]` deltas and high-byte-only clear on transitions. |
| CRT/capture glow, blur, persistence | Outside the original source | Treated as a separate transfer layer, not part of the source-faithful raw VGA signal. |

## Source timing notes

`PLZ.C::plz` starts when `dis_musplus() >= 0`, immediately resets the DIS music
tick counter with `dis_setmframe(0)`, then compares `dis_getmframe()` against:

```text
723, 1491, 1875, 2259
```

The source table contains a fifth value (`2778`), but the part exits after the
fourth transition once `curpal == 5 && cop_drop > 64`, so the fifth value is not
reached in normal playback. These are STMIK music ticks, not VGA retraces; the
standalone JavaScript demo advances them at a configurable 50 Hz default while
the VGA phase animation still advances at 70 Hz. On each threshold the C code
clears `fadepal`, sets `cop_drop = 1`, stores the next palette target in
`cop_fadepal`, and writes the next phase constants only to `il*/ik*`. The
visible `l*/k*` phases keep moving until `COPPER.ASM::do_drop` reaches
`cop_drop == 65`, where `initpparas` copies the pending phase constants into the
live phases. This delayed activation is part of the transition and is ported
explicitly.

## What the original renderer does

The plasma is not a per-pixel `sin(x) + sin(y)` loop. The assembly self-patches
four constants into an unrolled line renderer and samples three tables:

- `psini[16384]`, a 4096-step sine blend repeated four times.
- `lsini4[8192]`, a low-frequency sine blend scaled by 8.
- `lsini16[8192]`, a related sine blend scaled by 16.

For each rendered VGA byte column `x` and line `y`, the JavaScript port
implements the same effective expression as `plzline`:

```js
reverseX = 80 - x
first = psini[x * 8 + lsini16[c2 + y + reverseX * 4] + c1]
second = psini[lsini4[c4 + y + x * 16] + y * 2 + c3 + reverseX * 4]
color = (first + second) & 255
```

The original assembly writes through planar VGA byte lanes. Independent ports
(`second-reality-js` and `sr-port`'s GLSL path) model the visible result as 80
logical four-pixel groups, which is the form used here.

`COPPER.ASM::moveplz` advances two independent phase sets every retrace:

```text
k = [-3, -2, +1, +2]
l = [-1, -2, +2, +3]
```

The C loop renders the two phase sets through VGA plane masks `0x0a` and
`0x05`, alternating even and odd lines. In normal chunky pixels that becomes a
checkerboard interleave:

```text
even line: l k l k ...
odd line:  k l k l ...
```

This is why the port renders a 320x280 active image: each logical plasma group
produces two even or odd pixels, and the second overlaid plasma fills the
alternate pixels.

## VGA raster behavior

The plasma image itself does not require beam-racing. It is generated in video
memory from lookup tables, and the JavaScript version can reproduce that
directly.

The raster-sensitive parts are the transitions and presentation:

- `tw_opengraph2` disables chain-4, uses byte mode, and sets the CRTC offset to
  384 logical pixels per scanline; the visible window is 320 pixels wide.
- `set_plzstart` and `do_drop` update CRTC line-compare register `0x18` and the
  high bit in register `0x07`. This creates the moving split/drop used between
  palette/phase presets. The normal visible plasma band begins at scanline 60;
  the 65-entry `dtau` table moves it down to approximately scanline 404.
- `copper2` updates the DAC palette during vertical retrace using `fadepal` as
  768 visible high bytes plus 768 fractional low bytes. The JavaScript port now
  follows that accumulator model, but it does not depend on a real scanout beam.

In short: the characteristic plasma texture is table math plus planar
interleaving; VGA raster timing mainly affects the drop/palette transitions.
