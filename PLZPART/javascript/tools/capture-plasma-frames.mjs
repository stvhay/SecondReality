#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const defaults = {
  url: "https://stvhay.github.io/SecondReality/",
  out: "captures/plasma",
  frames: "0,70,350,700,1012,1013,1076,2087,2088,2151,2624,2625,2688,3162,3163,3226",
  presentation: "signal",
  selector: ".screen",
};

function parseArgs(argv) {
  const args = { ...defaults };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (value && !value.startsWith("--")) {
      args[key] = value;
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function parseFrames(value) {
  return String(value)
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((frame) => Number.isFinite(frame) && frame >= 0);
}

const args = parseArgs(process.argv.slice(2));
const frames = parseFrames(args.frames);
if (frames.length === 0) {
  throw new Error("No frames requested. Use --frames 0,64,128");
}

await mkdir(args.out, { recursive: true });

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 960, height: 720 },
    deviceScaleFactor: 1,
  });

  await page.goto(args.url, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.secondRealityPlasmaDemo);

  const element = page.locator(args.selector);
  await element.waitFor();

  for (const frame of frames) {
    await page.evaluate(
      ({ frame: targetFrame, presentation }) => {
        const demo = window.secondRealityPlasmaDemo;
        demo.stop();
        demo.plasma.reset();
        demo.setPresentation(presentation);
        demo.plasma.step(targetFrame);
        demo.draw();
      },
      { frame, presentation: args.presentation },
    );

    const filename = `plasma-${args.presentation}-f${String(frame).padStart(5, "0")}.png`;
    await element.screenshot({ path: path.join(args.out, filename) });
    console.log(`wrote ${filename}`);
  }
} finally {
  await browser.close();
}
