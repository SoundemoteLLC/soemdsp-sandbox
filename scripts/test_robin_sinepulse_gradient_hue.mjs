// Robin Sinepulse gradients must match the shared authored stops.
// The face used to inherit round-shape plate hue 205.714 as backgroundHue,
// and backgroundHue is the shared gradient hue-rotation field, so Ice
// (blue to white) drew yellow to white and Light blue (white to blue)
// drew white to green. Gray survived because hue rotation leaves greys alone.
//   node scripts/test_robin_sinepulse_gradient_hue.mjs
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

const displaySrc = fs.readFileSync(
  path.join(root, "public/modules/robinSinepulse/robin-sinepulse-display.js"),
  "utf8",
);
const editorSrc = fs.readFileSync(
  path.join(root, "public/modules/spectrogram/spectrogram-gradient-editor.js"),
  "utf8",
);

check(
  /backgroundHue:\s*0\s*,/.test(displaySrc)
    && /NODE_GRAPH_ROBIN_SINEPULSE_LEGACY_PLATE_HUE\s*=\s*205\.714/.test(displaySrc),
  "defaults: backgroundHue is 0, legacy plate hue 205.714 is named for migration",
);
check(
  /Math\.abs\(\s*incomingHue\s*-\s*NODE_GRAPH_ROBIN_SINEPULSE_LEGACY_PLATE_HUE\s*\)\s*<\s*1e-3/.test(displaySrc)
    && /merged\.backgroundHue\s*=\s*0/.test(displaySrc),
  "normalize migrates the leftover plate hue 205.714 to hue rotation 0",
);
check(
  /nodeGraphApplyGradientHueRotation\(look\.gradientStops,\s*look\)/.test(displaySrc),
  "draw path still applies shared hue rotation so a real user rotation works",
);
check(
  !/#0066cc|#66ccff|#0000ff|#001a4d/.test(displaySrc),
  "drawer does not hardcode Ice or Light blue colors",
);

function parsePreset(id) {
  const re = new RegExp(`id:\\s*"${id}"[\\s\\S]*?(?:stops:\\s*Object\\.freeze\\(\\s*(\\[[\\s\\S]*?\\])\\s*\\)|colors:\\s*(\\[[\\s\\S]*?\\]))`, "m");
  const m = editorSrc.match(re);
  if (!m) throw new Error(`preset ${id} not found`);
  if (m[1]) {
    const stops = [...m[1].matchAll(/color:\\s*"(#[0-9a-fA-F]{6})"/g)].map((x) => x[1].toLowerCase());
    if (!stops.length) throw new Error(`preset ${id} has no stop colors`);
    return stops;
  }
  const colors = [...m[2].matchAll(/"(#[0-9a-fA-F]{6})"/g)].map((x) => x[1].toLowerCase());
  if (!colors.length) throw new Error(`preset ${id} has no colors`);
  return colors;
}

const ice = parsePreset("ice");
const lightBlue = parsePreset("ps-light-blue");
const gray = parsePreset("grayscale");
check(ice[0] === "#000000" && ice.includes("#0066cc") && ice[ice.length - 1] === "#ffffff", `Ice is black / blue / white (got ${ice.join(", ")})`);
check(lightBlue[0] === "#ffffff" && lightBlue[lightBlue.length - 1] === "#0000ff", `Light blue is white to blue (got ${lightBlue.join(", ")})`);
check(gray[0] === "#000000" && gray[gray.length - 1] === "#ffffff", `Gray is black to white (got ${gray.join(", ")})`);

const ctx = {
  console, Math, Number, Boolean, String, Array, Object, JSON,
  nodeGraphFiniteNumber: (v, fb = 0) => (Number.isFinite(Number(v)) ? Number(v) : fb),
};
ctx.globalThis = ctx;
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, "public/node-graph-visual-utils.js"), "utf8"), ctx);
vm.runInContext(fs.readFileSync(path.join(root, "public/modules/ellipsoid/ellipsoid-settings.js"), "utf8"), ctx);
vm.runInContext(displaySrc, ctx);
const bugDeg = vm.runInContext("NODE_GRAPH_ROBIN_SINEPULSE_LEGACY_PLATE_HUE", ctx);
const hexHueRotate = (hex, deg) => vm.runInContext("nodeGraphHexHueRotate", ctx)(hex, deg);
const gradientHueDeg = (settings) => vm.runInContext("nodeGraphGradientHueRotationDeg", ctx)(settings);
const normalizeLook = (settings) => vm.runInContext("normalizeNodeGraphRobinSinepulseFaceSettings", ctx)(settings);

function rgb01ToHue(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d < 1e-9) return null;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return h;
}

function hexHue(hex) {
  const n = Number.parseInt(String(hex).replace("#", ""), 16);
  return rgb01ToHue(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function isBlue(hex) {
  const h = hexHue(hex);
  return h != null && h >= 195 && h <= 255;
}

function isYellow(hex) {
  const h = hexHue(hex);
  return h != null && h >= 40 && h <= 70;
}

function isGreenish(hex) {
  const h = hexHue(hex);
  return h != null && h >= 70 && h <= 140;
}

function rotate(hex, deg) {
  return String(hexHueRotate(hex, deg)).toLowerCase();
}

const iceBlue = ice.find((c) => c === "#0066cc");
const lightEnd = lightBlue[lightBlue.length - 1];
check(isBlue(iceBlue), `Ice mid stop ${iceBlue} is blue (hue ${hexHue(iceBlue)?.toFixed(1)})`);
check(isYellow(rotate(iceBlue, bugDeg)), `legacy 205.714 rotation turns Ice blue into yellow (got ${rotate(iceBlue, bugDeg)}, hue ${hexHue(rotate(iceBlue, bugDeg))?.toFixed(1)})`);
check(rotate(iceBlue, 0) === iceBlue, "hue rotation 0 leaves Ice blue unchanged");
check(isBlue(lightEnd), `Light blue end ${lightEnd} is blue`);
check(isGreenish(rotate(lightEnd, bugDeg)), `legacy 205.714 rotation turns Light blue into green (got ${rotate(lightEnd, bugDeg)}, hue ${hexHue(rotate(lightEnd, bugDeg))?.toFixed(1)})`);
check(rotate(lightEnd, 0) === lightEnd, "hue rotation 0 leaves Light blue unchanged");
check(
  gray.every((c) => rotate(c, bugDeg) === c && rotate(c, 0) === c),
  "Gray stops stay black-to-white at both 0 and the legacy plate hue",
);

const fresh = normalizeLook({});
check(fresh.backgroundHue === 0, `fresh settings default hue rotation is 0 (got ${fresh.backgroundHue})`);
const legacy = normalizeLook({ backgroundHue: 205.714 });
check(legacy.backgroundHue === 0, `legacy saved plate hue 205.714 normalizes to 0 (got ${legacy.backgroundHue})`);
const custom = normalizeLook({ backgroundHue: 40 });
check(custom.backgroundHue === 40, `an intentional hue rotation of 40 is kept (got ${custom.backgroundHue})`);

// nodeGraphApplyGradientHueRotation lives in scope-normalize.js; mirror it here
// with the same helpers the drawer uses so this test stays standalone.
function applyHue(stops, settings) {
  const deg = gradientHueDeg(settings);
  return stops.map((stop) => ({ t: stop.t, color: hexHueRotate(stop.color, deg) }));
}

const iceStops = ice.map((color, i) => ({ t: i / (ice.length - 1), color }));
const drawnIce = applyHue(iceStops, fresh);
check(
  drawnIce.every((s, i) => s.color.toLowerCase() === ice[i]),
  `normalized sinepulse look leaves authored Ice stops intact (${drawnIce.map((s) => s.color).join(", ")})`,
);
const drawnLight = applyHue(lightBlue.map((color, i) => ({ t: i / (lightBlue.length - 1), color })), fresh);
check(
  drawnLight.every((s, i) => s.color.toLowerCase() === lightBlue[i]),
  "normalized sinepulse look leaves authored Light blue stops intact",
);

if (failed) {
  console.error(`FAILED ${failed}`);
  process.exit(1);
}
console.log("ok  robin sinepulse gradients match authored stops");
