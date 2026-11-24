#!/usr/bin/env node
// Spectral Oscillator definition, face and display wiring (no browser):
// the hidden Cycle row appears on Show, A / B face labels follow Shape (8 shapes),
// Gibbs sits on the face, Reset
// uses the trigger symbol, the param definitions are the only limits (no
// tooltips), the face bake is the exact cycle, and the worklet / pages load it.
//   node scripts/test_spectral_osc_show.mjs
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
let failures = 0;
function check(ok, message) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${message}`);
  if (!ok) failures += 1;
}

const bag = {
  console, Object, Math, Number, String, Boolean, Array, Map, Set, JSON, Float32Array, Float64Array,
  parseInt, parseFloat, isFinite, isNaN, Infinity, NaN, undefined,
};
const ctx = new Proxy(bag, {
  has: () => true,
  get(t, p) {
    if (p === Symbol.unscopables) return undefined;
    if (p in t) return t[p];
    const fn = function stub(...a) { return a.length ? a[0] : []; };
    t[p] = fn;
    return fn;
  },
  set(t, p, v) { t[p] = v; return true; },
});
bag.globalThis = ctx;
bag.window = ctx;
vm.createContext(ctx);
vm.runInContext(
  read("public/node-graph-module-definitions.js") + "\nthis.__exportedDefs = nodeGraphModuleDefinitions; this.__labels = nodeGraphNodeLabels;",
  ctx,
  { filename: "node-graph-module-definitions.js" },
);
const defs = bag.__exportedDefs;
ctx.nodeGraphModuleDefinitions = defs;
vm.runInContext(read("public/node-graph-module-face.js"), ctx, { filename: "node-graph-module-face.js" });
vm.runInContext(
  read("public/modules/spectralOsc/spectral-osc-math.js")
    + "\nthis.__math = { SPECTRAL_OSC_SHAPES, SPECTRAL_OSC_CONTROL_LABELS, spectralOscBakeCycle, spectralOscCycle, spectralOscGain };",
  ctx,
  { filename: "spectral-osc-math.js" },
);
const M = bag.__math;
const meta = read("public/node-graph-parameter-metadata.js");
const pick = (src, name) => {
  const start = src.indexOf(`function ${name}(`);
  const m = /\r?\n}\r?\n/.exec(src.slice(start));
  if (start < 0 || !m) throw new Error(`${name} not found`);
  return src.slice(start, start + m.index + m[0].length);
};
bag.nodeGraphParameterEffectiveVisible = vm.runInContext(
  "(function () {\n" + pick(meta, "nodeGraphParameterDefaultVisible") + "\n" + pick(meta, "nodeGraphParameterEffectiveVisible")
    + "\nreturn nodeGraphParameterEffectiveVisible;\n})()",
  ctx,
);
const geo = read("public/node-graph-port-geometry.js");
const isTriggerReset = vm.runInContext(
  "(function () {\n" + pick(geo, "nodeGraphPortIsReset") + "\n" + pick(geo, "nodeGraphPortIsTriggerReset")
    + "\nreturn nodeGraphPortIsTriggerReset;\n})()",
  ctx,
);

const def = defs.spectralOsc;
check(!!def && !defs.wavetable2d, "spectralOsc is defined; wavetable2d is gone");
check(bag.__labels.spectralOsc === "Spectral Oscillator" && !("wavetable2d" in bag.__labels), `display name "${bag.__labels.spectralOsc}"`);
const P = Object.fromEntries((def?.parameters || []).map((p) => [p.key, p]));
check(JSON.stringify(P.shape?.choices) === JSON.stringify([...M.SPECTRAL_OSC_SHAPES]) && P.shape.min === "0" && P.shape.max === "7" && P.shape.choices.length === 8,
  `Shape choices: ${JSON.stringify(P.shape?.choices)}`);
check(P.gibbs?.label === "Gibbs" && P.gibbs.defaultValue === "0" && !P.gibbs.hidden, "Gibbs param: 0..1, default 0 (smooth taper), visible");
check(["shapeA", "shapeB", "gibbs"].every((k) => P[k]?.min === "0" && P[k]?.max === "1"), "A / B / Gibbs limits 0..1 live only in the param definitions (native clamps to the same)");
check((def?.parameters || []).every((p) => !("tooltip" in p)) && !def?.inputTooltips && !def?.outputTooltips, "no tooltips on the module, its params or ports");

// ---- trigger symbol ----
check(def?.resetTrigger === true && isTriggerReset("spectralOsc", "Reset") === true, "Reset uses the TRIGGER symbol (resetTrigger), not the reset symbol");
check(isTriggerReset("samplePlayer", "Reset") === false, "control: a plain Reset (Sample Player) keeps the reset symbol");

// ---- Cycle row on Show ----
const cycleDef = P.cycleMode;
const pbCycle = defs.polyBlep.parameters.find((p) => p.key === "cycleMode");
check(cycleDef?.hidden === true && cycleDef.defaultValue === "0" && JSON.stringify(cycleDef.choices) === JSON.stringify(pbCycle.choices) && cycleDef.label === pbCycle.label,
  "Cycle: hidden param, default Free run, PolyBLEP's label and choices");
const node = (visible, params = {}) => ({ id: "spectralOsc-1", type: "spectralOsc", params, paramMeta: visible === undefined ? {} : { cycleMode: { visible } } });
const keysOf = (spec) => (spec || []).flatMap((row) => ctx.nodeGraphModuleFaceRowParams(row));
const h = (n) => ctx.nodeGraphModuleFaceHeightPx("spectralOsc", n);
check(!keysOf(ctx.nodeGraphModuleFaceSpec("spectralOsc", node())).includes("cycleMode"), "face: Cycle is off the face by default");
const shown = ctx.nodeGraphModuleFaceSpec("spectralOsc", node(true));
const row = shown.find((r) => ctx.nodeGraphModuleFaceRowParams(r).includes("cycleMode"));
check(row?.kind === "choices" && JSON.stringify(row.labels) === JSON.stringify(pbCycle.choices), "face: Show puts the Cycle row (Free run / Single trigger) on the face");
check(h(node(true)) > h(node()) && h(node(false)) === h(node()), `face: grows on Show, closes on Hide (${h(node())} -> ${h(node(true))} px)`);
check(keysOf(shown).filter((k) => k !== "cycleMode").join(",") === "shape,frequency,phase,amplitude,shapeA,shapeB,gibbs",
  `face: Shape, Freq | Phase | Amp, A | B | Gibbs (${keysOf(shown).join(",")})`);

// ---- A / B labels follow Shape ----
const labelsFor = (shape) => {
  const spec = ctx.nodeGraphModuleFaceSpec("spectralOsc", node(undefined, { shape }));
  const r = spec.find((x) => ctx.nodeGraphModuleFaceRowParams(x).includes("shapeA"));
  return r.params.map((c) => c[1]);
};
const expected = [
  ["Edge", "Sine"], ["Width", "Sine"], ["Peak", "Sine"], ["Formant", "Width"],
  ["Spacing", "Depth"], ["Sharp", "Skew"], ["Stretch", "Sine"], ["Stretch", "Sine"],
];
let allLabels = true;
for (let s = 0; s < 8; s++) {
  const got = labelsFor(String(s));
  const ok = got[0] === expected[s][0] && got[1] === expected[s][1] && got[2] === "Gibbs";
  if (!ok) allLabels = false;
  console.log(`      ${M.SPECTRAL_OSC_SHAPES[s].padEnd(12)} -> ${got.join(" | ")}`);
}
check(allLabels, "face: A / B labels follow Shape (each stands alone, Gibbs unchanged)");
check(JSON.stringify(M.SPECTRAL_OSC_CONTROL_LABELS) === JSON.stringify(expected), "face labels match the math module's per-shape labels");
const widgets = ctx.nodeGraphModuleFaceWidgets(ctx.nodeGraphModuleFaceSpec("spectralOsc", node(undefined, { shape: 3 })), 196);
check(widgets.some((w) => w.param === "shapeA" && w.label === "Formant") && widgets.some((w) => w.param === "shapeB" && w.label === "Width"),
  "face widgets draw the per-shape labels (Formant: Formant | Width)");
check(labelsFor(undefined).join("|") === "Edge|Sine|Gibbs", "face: a new node (default Shape) reads Edge | Sine");

// ---- display: exact cycle, never clipped ----
let peakOk = true, exactOk = true;
for (let s = 0; s < 8; s++) {
  for (const [A, B, G] of [[0.05, 0, 0], [0.5, 0.5, 0.5], [0.9, 1, 1], [0.3, 0.2, 1]]) {
    const bake = M.spectralOscBakeCycle({ shape: s, shapeA: A, shapeB: B, gibbs: G }, 200);
    const ref = M.spectralOscCycle(s, A, B, Math.floor(200 / 3), 200, G);
    let mn = 0, mx = 0; for (const v of ref) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
    const g = M.spectralOscGain(s, mn, mx);
    if (Math.max(...bake.map(Math.abs)) > 1 + 1e-12) peakOk = false;
    if (bake.some((v, i) => Math.abs(v - ref[i] * g) > 1e-12)) exactOk = false;
  }
}
check(exactOk, "display bake = the exact formula cycle for every shape and Gibbs");
check(/\|\$\{p\.gibbs\}`/.test(read("public/modules/additiveGenerator/additive-waveform-display.js")), "display re-bakes when Gibbs moves (bake key)");
check(peakOk, "display peak <= 1: the plot (0.42 h per unit) never clips");
const disp = read("public/modules/additiveGenerator/additive-waveform-display.js");
check(/nodeType === "spectralOsc"/.test(disp) && /spectralOscBakeCycle\(/.test(disp), "the Additive waveform display draws spectralOsc from spectralOscBakeCycle");
check(def?.displayType === "additiveWaveform" && def.displayModes?.[0]?.settingsSchema === "additiveWaveform", "display settings: Additive waveform schema (line thickness, blur, colours)");

// ---- worklet + pages ----
const wk = read("public/node-live-audio-worklet-native-graph.js");
check(/spectralOsc: 180,/.test(wk) && !/wavetable2d: 180/.test(wk), "worklet type map: spectralOsc -> engine type 180");
const push = wk.slice(wk.indexOf('if (type === "spectralOsc") {'), wk.indexOf("continue;", wk.indexOf('if (type === "spectralOsc") {')));
for (const [k, id] of [["shape", "WAVEFORM"], ["shapeA", "SHAPE"], ["shapeB", "RESONANCE"], ["gibbs", "WIDTH"], ["frequency", "FREQUENCY"], ["phase", "PHASE"], ["amplitude", "AMPLITUDE"], ["cycleMode", "TIMING_MODE"]]) {
  if (!push.includes(`push("${k}", P.NATIVE_GRAPH_PARAM_${id},`)) { check(false, `worklet pushes ${k} as ${id}`); }
}
check(Object.keys(P).every((k) => push.includes(`push("${k}",`)), "worklet pushes every param to the engine");
for (const page of ["public/index.html", "public/perform.html"]) {
  const s = read(page);
  const a = s.indexOf("modules/spectralOsc/spectral-osc-math.js"), b = s.indexOf("modules/additiveGenerator/additive-waveform-display.js");
  check(a > 0 && a < b, `${page} loads spectral-osc-math.js before the display`);
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exitCode = failures ? 1 : 0;