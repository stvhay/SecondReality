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

1. **Active plasma pixels**: the 336x280 chunky reconstruction of
   `ASMYT.ASM::plzline`. This is the lookup-table math and VGA plane
   checkerboard, before display timing.
2. **Raw VGA signal**: a 384x400 frame matching `TWEAK.ASM::tw_opengraph2`
   (`CRTC offset 0x30`, 400 scanlines). The 336x280 plasma is placed starting
   at scanline 60, and `COPPER.ASM::do_drop`'s line-compare curve can move it
   down during transitions.
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
| 384x400 tweaked VGA presentation | `TWEAK.ASM::tw_opengraph2` | Ported as the "Raw VGA signal" view. |
| Line-compare drop | `COPPER.ASM::do_drop`, `dtau` | Partially ported: the band position follows the source curve and pending constants activate at `cop_drop == 65`; exact latch/CRTC side effects are not emulated. |
| DAC fade accumulator | `COPPER.ASM::fadepal` | Approximated; this is a remaining fidelity target. |
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
first = psini[x * 40 + lsini16[c2 + y + (80 - x) * 4] + c1]
second = psini[lsini4[c4 + y + x * 48] + y * 2 + c3 - x * 4 + 80 * 4]
color = (first + second) & 255
```

The `x * 40` and `x * 48` terms are easy to miss because they are split
between the unrolled instruction displacements and the values written by
`setplzparas`.

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

This is why the port renders a 336x280 active image: the original line loop
writes 84 planar bytes, and each VGA byte covers four pixel planes.

## VGA raster behavior

The plasma image itself does not require beam-racing. It is generated in video
memory from lookup tables, and the JavaScript version can reproduce that
directly.

The raster-sensitive parts are the transitions and presentation:

- `tw_opengraph2` disables chain-4, uses byte mode, and sets the CRTC offset to
  384 logical pixels per scanline.
- `set_plzstart` and `do_drop` update CRTC line-compare register `0x18` and the
  high bit in register `0x07`. This creates the moving split/drop used between
  palette/phase presets. The normal visible plasma band begins at scanline 60;
  the 65-entry `dtau` table moves it down to approximately scanline 404.
- `copper2` updates the DAC palette during vertical retrace. The JavaScript
  port keeps the palette presets, 70 Hz stepping, and a black/grey-to-palette
  fade approximation, but it does not depend on a real scanout beam.

In short: the characteristic plasma texture is table math plus planar
interleaving; VGA raster timing mainly affects the drop/palette transitions.
