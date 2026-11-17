// Classic and Hot are inspired-by OKLab-L-linear ramps (cool-to-warm / fire),
// not remakes of the old even-spaced hue lists. OKLab L rises with t at the
// authored stops; sRGB interpolation stays within about 1.5 CIELAB L* of the
// designed lightness polyline, including the first dark interval. No pure
// #ff0000 / #ffff00 stops. Patches store copied gradientStops, not a preset id.
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

const classicStops = [
  { t: 0, color: "#000000" },
  { t: 0.0909, color: "#00020a" },
  { t: 0.1818, color: "#011325" },
  { t: 0.2727, color: "#042b3a" },
  { t: 0.3636, color: "#0a464f" },
  { t: 0.4545, color: "#126550" },
  { t: 0.5455, color: "#4d8117" },
  { t: 0.6364, color: "#9d8c1e" },
  { t: 0.7273, color: "#c3a34b" },
  { t: 0.8182, color: "#ddc087" },
  { t: 0.9091, color: "#f0dfc2" },
  { t: 1, color: "#ffffff" },
];
const hotStops = [
  { t: 0, color: "#000000" },
  { t: 0.0909, color: "#090000" },
  { t: 0.1818, color: "#290201" },
  { t: 0.2727, color: "#471404" },
  { t: 0.3636, color: "#652a09" },
  { t: 0.4545, color: "#834310" },
  { t: 0.5455, color: "#a25c18" },
  { t: 0.6364, color: "#bb7c20" },
  { t: 0.7273, color: "#d99929" },
  { t: 0.8182, color: "#e5be6b" },
  { t: 0.9091, color: "#f2dfb3" },
  { t: 1, color: "#ffffff" },
];

function pack(stops) {
  return JSON.stringify(stops.map((s) => [Number(s.t), String(s.color).toLowerCase()]));
}

check(Boolean(classic?.stops && hot?.stops), "Classic and Hot ship explicit stop positions, not only even colors");
check(classic?.label === "classic" && hot?.label === "hot", "Preset names stay Classic and Hot (labels classic / hot)");
check(
  pack(classic.colors.map((c, i) => ({ t: classic.stops[i].t, color: c }))) === pack(classicStops)
    && pack(classic.stops) === pack(classicStops)
    && classic.stops.length === 12,
  "Classic is the inspired-by OKLab-linear cool-to-warm ramp (12 stops)",
);
check(
  pack(hot.colors.map((c, i) => ({ t: hot.stops[i].t, color: c }))) === pack(hotStops)
    && pack(hot.stops) === pack(hotStops)
    && hot.stops.length === 12,
  "Hot is the inspired-by OKLab-linear fire ramp (12 stops)",
);
check(
  pack(defaults) === pack(classic.stops),
  "Spectrogram default stops match the Classic preset so picking Classic equals the face default",
);
check(
  ![classic, hot].some((p) => p.stops.some((s) => ["#ffff00", "#ff0000"].includes(s.color.toLowerCase()))),
  "Classic and Hot do not use pure #ffff00 / #ff0000 stops",
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
function rgb01ToOkL(rgb) {
  const [r, g, b] = rgb.map(srgbToLin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
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
function designedLstar(stops, t) {
  const list = stops.map((s) => ({ t: Number(s.t), L: rgb01ToLstar(hexToRgb01(s.color)) })).sort((a, b) => a.t - b.t);
  if (t <= list[0].t) return list[0].L;
  if (t >= list[list.length - 1].t) return list[list.length - 1].L;
  for (let i = 1; i < list.length; i += 1) {
    const a = list[i - 1];
    const b = list[i];
    if (t <= b.t) {
      const u = (t - a.t) / Math.max(1e-9, b.t - a.t);
      return a.L + (b.L - a.L) * u;
    }
  }
  return list[list.length - 1].L;
}

function metrics(stops) {
  const n = 256;
  const firstEnd = Number(stops[1]?.t ?? 0);
  let maxAbs = 0;
  let maxDrop = 0;
  let err2 = 0;
  let firstMax = 0;
  let prev = null;
  let maxOkDev = 0;
  const L0 = rgb01ToLstar(sampleStops(stops, 0));
  const L1 = rgb01ToLstar(sampleStops(stops, 1));
  for (let i = 0; i < n; i += 1) {
    const t = i / (n - 1);
    const rgb = sampleStops(stops, t);
    const L = rgb01ToLstar(rgb);
    const d = L - designedLstar(stops, t);
    maxAbs = Math.max(maxAbs, Math.abs(d));
    err2 += d * d;
    if (t <= firstEnd + 1e-12) firstMax = Math.max(firstMax, Math.abs(d));
    if (prev != null && L < prev) maxDrop = Math.max(maxDrop, prev - L);
    prev = L;
    maxOkDev = Math.max(maxOkDev, Math.abs(rgb01ToOkL(rgb) - t));
  }
  let maxStopOk = 0;
  for (const s of stops) {
    maxStopOk = Math.max(maxStopOk, Math.abs(rgb01ToOkL(hexToRgb01(s.color)) - Number(s.t)));
  }
  return {
    maxAbs,
    rmse: Math.sqrt(err2 / n),
    firstMax,
    maxDrop,
    maxOkDev,
    maxStopOk,
    L0,
    L1,
  };
}

for (const [name, preset] of [["Classic", classic], ["Hot", hot]]) {
  const m = metrics(preset.stops);
  check(m.L0 < 0.5 && m.L1 > 99.5, `${name} still runs black to white (L* ${m.L0.toFixed(2)}…${m.L1.toFixed(2)})`);
  check(m.maxDrop < 0.05, `${name} L* is monotonic under sRGB interpolation (max drop ${m.maxDrop.toFixed(3)})`);
  check(
    m.maxStopOk < 0.045,
    `${name} stop OKLab L tracks t (max |okL-t| ${m.maxStopOk.toFixed(4)})`,
  );
  check(
    m.maxAbs < 1.5 && m.firstMax < 1.5 && m.rmse < 0.6,
    `${name} sRGB interp stays within 1.5 L* of the designed curve, including the first interval (max |Δ| ${m.maxAbs.toFixed(2)}, first ${m.firstMax.toFixed(2)}, RMSE ${m.rmse.toFixed(2)})`,
  );
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
console.log("ok  Classic and Hot are inspired-by OKLab-linear ramps, and saved stops stay copies");
