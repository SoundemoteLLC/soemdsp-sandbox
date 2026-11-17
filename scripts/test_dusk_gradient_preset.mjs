// Dusk is a shared gradient preset: black, dark purple, blue, icy light blue, white.
// It must be pickable everywhere the other color presets are, including
// Robin Sinepulse and Spectrogram, and its six colors must stay evenly spaced.
//   node scripts/test_dusk_gradient_preset.mjs
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;
const check = (ok, msg) => {
  if (!ok) {
    failed += 1;
    console.error("FAIL", msg);
  } else {
    console.log("ok  ", msg);
  }
};

const want = ["#000000", "#3d1350", "#343e77", "#2a5e8b", "#3889ab", "#ffffff"];
const ctx = { console, Math, Number, Boolean, String, Array, Object, JSON, Infinity, undefined };
ctx.globalThis = ctx;
ctx.window = ctx;
ctx.document = {
  getElementById: () => null,
  createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
  head: { appendChild() {} },
};
vm.createContext(ctx);
vm.runInContext(
  fs.readFileSync(path.join(root, "public/modules/spectrogram/spectrogram-gradient-editor.js"), "utf8"),
  ctx,
);

const presets = vm.runInContext("SHARED_GRADIENT_PRESETS", ctx);
const spectro = vm.runInContext("SPECTROGRAM_GRADIENT_PRESETS", ctx);
const phosphor = vm.runInContext("PHOSPHOR_GRADIENT_PRESETS", ctx);
const dusk = presets.find((p) => p.id === "dusk");
check(Boolean(dusk), "SHARED_GRADIENT_PRESETS includes dusk");
check(spectro === presets && phosphor === presets, "Spectrogram and phosphor preset lists are the same shared array");
check(dusk?.label === "dusk", `dusk label is "dusk" (got ${dusk?.label})`);
check(
  Array.isArray(dusk?.colors) && dusk.colors.map((c) => String(c).toLowerCase()).join(",") === want.join(","),
  `dusk colors are the authored twilight ramp ending in white (${dusk?.colors?.join(", ")})`,
);
check(!Array.isArray(dusk?.stops), "dusk has no custom stop positions, so the picker spaces the six colors evenly");

const sel = vm.runInContext("NodeGraphGradientSelector", ctx);
const stops = sel.normalizeStops(dusk.colors);
check(stops.length === 6, `normalizeStops expands dusk to 6 stops (got ${stops.length})`);
check(
  stops.every((s, i) => Math.abs(s.t - i / 5) < 1e-12 && s.color.toLowerCase() === want[i]),
  `dusk stops are even at 0, 0.2, 0.4, 0.6, 0.8, 1 (${stops.map((s) => `${s.color} ${s.t}`).join("; ")})`,
);
check(sel.usesDisplayGradient("robinSinepulseFace"), "Robin Sinepulse uses the shared gradient picker");
check(sel.usesDisplayGradient("spectrogramBurn"), "Spectrogram uses the shared gradient picker");

const sinepulseSrc = fs.readFileSync(
  path.join(root, "public/modules/robinSinepulse/robin-sinepulse-display.js"),
  "utf8",
);
check(
  /nodeGraphPhosphorGradientStopsFromSettings/.test(sinepulseSrc)
    && /nodeGraphApplyGradientHueRotation\(look\.gradientStops,\s*look\)/.test(sinepulseSrc),
  "Robin Sinepulse draws from shared gradient stops, not a private preset list",
);
const spectroSrc = fs.readFileSync(
  path.join(root, "public/modules/spectrogram/spectrogram-display.js"),
  "utf8",
);
check(
  /gradientStops/.test(spectroSrc)
    && /nodeGraphApplyGradientHueRotation\(settings\.gradientStops,\s*settings\)/.test(spectroSrc),
  "Spectrogram draws from shared gradient stops, not a private preset list",
);

const ids = presets.map((p) => p.id);
check(ids.filter((id) => id === "dusk").length === 1, "dusk id is unique in the shared list");

if (failed) {
  console.error(`FAILED ${failed}`);
  process.exit(1);
}
console.log("ok  dusk is a shared, evenly spaced twilight gradient");
