#!/usr/bin/env node
// Dark Velvet Reverb: optional time-axis-only line blur (tapLineBlur).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const lines = require(path.join(root, "public/lib/visual/gl-line-renderer.js"));

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const expoCoverage = lines.nodeGraphGlLinesExpoSkirt;

function xCov(pxCenter, x0, x1, feather) {
  let acc = 0;
  for (let i = 0; i < 4; i += 1) {
    const o = (i + 0.5) * 0.25 - 0.5;
    const x = pxCenter + o;
    let dist = 0;
    if (x < x0) dist = x0 - x;
    else if (x > x1) dist = x - x1;
    acc += dist <= 0 || !(feather > 0)
      ? (dist <= 0 ? 1 : 0)
      : expoCoverage(Math.min(1, dist / feather));
  }
  return acc * 0.25;
}

assert(Math.abs(expoCoverage(0) - 1) < 1e-12, "expo t=0 is 1");
assert(Math.abs(expoCoverage(1)) < 1e-12, "expo t=1 is 0");
assert(expoCoverage(0.25) > expoCoverage(0.5) && expoCoverage(0.5) > expoCoverage(0.75), "expo falls along the skirt");

// Core [10, 11): 1 px solid bar. Mid-core stays fully on with or without blur.
assert(xCov(10.5, 10, 11, 0) === 1, "sharp mid-core is 1");
assert(xCov(10.5, 10, 11, 8) === 1, "blurred mid-core stays 1");
// Far past the feather: off.
assert(xCov(10.5 + 8 + 1, 10, 11, 8) === 0, "past the X feather is 0");
assert(xCov(10.5 - 8 - 1, 10, 11, 8) === 0, "past the left X feather is 0");
// Inside the skirt, between 0 and 1, and symmetric.
const left = xCov(10 - 4, 10, 11, 8);
const right = xCov(11 + 4, 10, 11, 8);
assert(left > 0 && left < 1, `left skirt is a fraction, got ${left}`);
assert(Math.abs(left - right) < 1e-9, "left and right skirts match");
// A point 4 px above the bar is not in this X kernel at all — Y is not blurred.
// (The helper is X-only by construction; height coverage is a separate axis.)
assert(xCov(10.5, 10, 11, 8) === 1, "Y is not part of the X kernel");

const display = fs.readFileSync(path.join(root, "public/node-graph-velvet-taps-display.js"), "utf8");
assert(typeof expoCoverage === "function", "renderer exports nodeGraphGlLinesExpoSkirt");
assert(display.includes("nodeGraphGlLinesExpoSkirt"), "display calls the shared Expo skirt");
assert(!display.includes("nodeGraphVelvetTapsExpoCoverage"), "no local Expo duplicate");
assert(!display.includes("0.95021293163"), "Expo constant lives only in the shared renderer");
assert(display.includes("nodeGraphVelvetTapsXBlurSpans"), "horizontal-only blur spans");
assert(display.includes("look.tapLineBlur"), "reads tapLineBlur");
const renderer = fs.readFileSync(path.join(root, "public/lib/visual/gl-line-renderer.js"), "utf8");
assert(renderer.includes('NODE_GRAPH_GL_LINES_EXPO_SKIRT_GLSL = "1.0 - (1.0 - exp(-3.0 * t)) / 0.95021293163"'), "one GLSL source string");
assert(renderer.includes("return ${NODE_GRAPH_GL_LINES_EXPO_SKIRT_GLSL};"), "GLSL edgeCurve uses the shared source");
assert(Math.abs(expoCoverage(0) - 1) < 1e-12 && Math.abs(expoCoverage(1)) < 1e-12, "shared skirt still 1 at 0 and 0 at 1");
assert(!/featherCss[\s\S]{0,200}AxisSpans\(ya/.test(display.replace("nodeGraphVelvetTapsAxisSpans(ya * k, (ya + ha) * k)", "YSPANS")), "sanity");
// Height path still uses coverage AA with no vertical feather argument.
assert(display.includes("nodeGraphVelvetTapsAxisSpans(ya * k, (ya + ha) * k)"), "Y stays sharp coverage AA");

const train = fs.readFileSync(path.join(root, "public/node-graph-pulse-train-display.js"), "utf8");
assert(train.includes("tapLineBlur: 0"), "Line blur defaults to 0 (off)");

const explode = fs.readFileSync(path.join(root, "public/node-graph-pulse-explosion-display.js"), "utf8");
assert(explode.includes('if ("tapLineBlur" in d) out.tapLineBlur'), "normalizer keeps tapLineBlur");

const form = fs.readFileSync(path.join(root, "public/node-graph-module-scope-settings-form.js"), "utf8");
assert(form.includes('node?.type === "velvetReverb" ? ["tapLineBlur"]'), "form shows Line blur only on Dark Velvet Reverb");
assert(form.includes('label = "Dot blur"'), "velvet relabels lineSmoothing to Dot blur");

const controls = fs.readFileSync(path.join(root, "public/node-graph-module-scope-settings-controls.js"), "utf8");
assert(controls.includes("tapLineBlur: (value) => clampNodeSliderValue(nodeGraphFiniteNumber(value, 0), 0, 32)"), "amount is 0-32 CSS px, default 0");

console.log("ok  velvet taps time-axis line blur");
