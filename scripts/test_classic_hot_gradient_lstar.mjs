// Classic and Hot shared presets should climb in CIELAB L* nearly linearly
// under the app's sRGB stop interpolation, without a yellow brightness spike.
// Patches store copied gradientStops, not a preset id, so picking Classic/Hot
// takes the new look while already-saved custom stops stay as-is.
//   node scripts/test_classic_hot_gradient_lstar.mjs
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
const classic = presets.find((p) => p.id === "classic");
const hot = presets.find((p) => p.id === "hot");
const defaults = vm.runInContext("SPECTROGRAM_DEFAULT_GRADIENT_STOPS", ctx);

const classicColors = ["#000000", "#000391", "#0046a3", "#007097", "#009c27", "#77aa00", "#dca900", "#ffd302", "#ffffff"];
const hotColors = ["#000000", "#570400", "#ae0100", "#ff0000", "#ff6416", "#ff8f00", "#ffd302", "#ffffff"];

check(Boolean(classic?.stops && hot?.stops), "Classic and Hot ship explicit stop positions, not only even colors");
check(
  classic.colors.map((c) => c.toLowerCase()).join() === classicColors.join()
    && classic.stops.map((s) => s.color.toLowerCase()).join() === classicColors.join(),
  "Classic colors are the reworked black / blue / turquoise / green / yellow / white ramp",
);
check(
  hot.colors.map((c) => c.toLowerCase()).join() === hotColors.join()
    && hot.stops.map((s) => s.color.toLowerCase()).join() === hotColors.join(),
  "Hot colors are the reworked black / red / orange / yellow / white ramp",
);
check(
  JSON.stringify(defaults.map((s) => [s.t, s.color.toLowerCase()]))
    === JSON.stringify(classic.stops.map((s) => [s.t, s.color.toLowerCase()])),
  "Spectrogram default stops match the Classic preset so picking Classic equals the face default",
);

function srgbToLin(u) {
  return u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4;
}
function hexToRgb01(hex) {
  const n = Number.parseInt(String(hex).replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
function rgb01ToLstar(rgb) {
  const [R, G, B] = rgb.map(srgbToLin);
  const Y = 0.2126729 * R + 0.7151522 * G + 0.0721750 * B;
  const d = 6 / 29;
  const fy = Y > d ** 3 ? Y ** (1 / 3) : Y / (3 * d * d) + 4 / 29;
  return 116 * fy - 16;
}
function lerp(a, b, u) {
  return a.map((x, i) => x + (b[i] - x) * u);
}
function sampleStops(stops, t) {
  const list = stops.map((s) => ({ t: Number(s.t), rgb: hexToRgb01(s.color) })).sort((a, b) => a.t - b.t);
  if (t <= list[0].t) return list[0].rgb;
  if (t >= list[list.length - 1].t) return list[list.length - 1].rgb;
  for (let i = 1; i < list.length; i += 1) {
    const a = list[i - 1];
    const b = list[i];
    if (t <= b.t) {
      return lerp(a.rgb, b.rgb, (t - a.t) / Math.max(1e-9, b.t - a.t));
    }
  }
  return list[list.length - 1].rgb;
}
function lstarCurve(stops, n = 256) {
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return { t, L: rgb01ToLstar(sampleStops(stops, t)) };
  });
}
function metrics(stops) {
  const rows = lstarCurve(stops);
  let maxAbs = 0;
  let maxDrop = 0;
  let err2 = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const d = rows[i].L - 100 * rows[i].t;
    maxAbs = Math.max(maxAbs, Math.abs(d));
    err2 += d * d;
    if (i > 0 && rows[i].L < rows[i - 1].L) {
      maxDrop = Math.max(maxDrop, rows[i - 1].L - rows[i].L);
    }
  }
  return { maxAbs, rmse: Math.sqrt(err2 / rows.length), maxDrop, L0: rows[0].L, L1: rows[rows.length - 1].L };
}

for (const [name, preset] of [["Classic", classic], ["Hot", hot]]) {
  const m = metrics(preset.stops);
  check(m.L0 < 0.5 && m.L1 > 99.5, `${name} still runs black to white (L* ${m.L0.toFixed(2)}…${m.L1.toFixed(2)})`);
  check(m.maxDrop < 0.05, `${name} L* is monotonic under sRGB interpolation (max drop ${m.maxDrop.toFixed(3)})`);
  check(m.maxAbs < 4 && m.rmse < 1.5, `${name} L* stays close to linear (max |Δ| ${m.maxAbs.toFixed(2)}, RMSE ${m.rmse.toFixed(2)})`);
}

const editorSrc = fs.readFileSync(path.join(root, "public/modules/spectrogram/spectrogram-gradient-editor.js"), "utf8");
check(
  /if \(Array\.isArray\(preset\.stops\) && preset\.stops\.length >= 2\)/.test(editorSrc)
    && /swatchStops = preset\.stops\.map/.test(editorSrc)
    && /next = preset\.stops\.map/.test(editorSrc),
  "Picking a preset copies its current authored stops, so Classic/Hot get the new look",
);

const formIo = fs.readFileSync(path.join(root, "public/node-graph-module-scope-settings-form-io.js"), "utf8");
check(
  /next\.gradientStops = editor\.getStops\(\)/.test(formIo)
    && !/gradientPresetId|presetId.*classic/.test(formIo),
  "Saved settings store a copy of gradientStops, not a Classic/Hot name, so custom stops are not rewritten",
);

if (failed) {
  console.error(`FAILED ${failed}`);
  process.exit(1);
}
console.log("ok  Classic and Hot L* ramps are even, and saved stops stay copies");
