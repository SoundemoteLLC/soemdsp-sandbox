#!/usr/bin/env node
// Additive Out's hidden Cycle (cycleMode) parameter: Additive Out has no hand-written
// face (its parameters are generic rows under the harmonic-lines display, as
// PolyBLEP's), so the Show toggle (paramMeta.visible) must add a row and Hide must
// take it away again. Also: the Reset inlet is a trigger, and the harmonic-lines
// display draws its stems with the shared Expo antialiasing (Line blur).
//   node scripts/test_additive_cycle_show.mjs
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
  console, Object, Math, Number, String, Boolean, Array, Map, Set, JSON,
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
  read("public/node-graph-module-definitions.js") + "\nthis.__exportedDefs = nodeGraphModuleDefinitions;",
  ctx,
  { filename: "node-graph-module-definitions.js" },
);
const defs = bag.__exportedDefs;
ctx.nodeGraphModuleDefinitions = defs;
vm.runInContext(read("public/node-graph-module-face.js"), ctx, { filename: "node-graph-module-face.js" });
vm.runInContext(read("public/node-graph-module-sizing.js"), ctx, { filename: "node-graph-module-sizing.js" });
const meta = read("public/node-graph-parameter-metadata.js");
const pick = (name) => {
  const start = meta.indexOf(`function ${name}(`);
  const m = /\r?\n}\r?\n/.exec(meta.slice(start));
  if (start < 0 || !m) throw new Error(`${name} not found`);
  return meta.slice(start, start + m.index + m[0].length);
};
// (Assigned explicitly: the loaders above already probed these names and got stubs.)
bag.nodeGraphParameterEffectiveVisible = vm.runInContext(
  "(function () {\n" + pick("nodeGraphParameterDefaultVisible") + "\n" + pick("nodeGraphParameterEffectiveVisible")
    + "\nreturn nodeGraphParameterEffectiveVisible;\n})()",
  ctx,
);
bag.nodeGraphPatchNodeParameterDefinitions = (node) => defs[node.type]?.parameters || [];
if (bag.nodeGraphParameterEffectiveVisible({ hidden: true }, undefined) !== false) throw new Error("visibility rule did not load");

const out = defs.additiveOut;
const cycleDef = out.parameters.find((p) => p.key === "cycleMode");
const pbCycle = defs.polyBlep.parameters.find((p) => p.key === "cycleMode");
check(cycleDef && cycleDef.hidden === true && cycleDef.defaultValue === "0", "additiveOut: Cycle is a hidden parameter, default Free run");
check(JSON.stringify(cycleDef?.choices) === JSON.stringify(pbCycle?.choices) && cycleDef?.label === pbCycle?.label
  && cycleDef?.min === pbCycle?.min && cycleDef?.max === pbCycle?.max && cycleDef?.step === pbCycle?.step,
  "additiveOut: Cycle has PolyBLEP's label, choices and limits");
check(out.resetTrigger === true && defs.polyBlep.resetTrigger === true && out.inputs[0] === "Reset",
  "additiveOut: Reset inlet is a trigger, like PolyBLEP's");
check(defs.additiveGenerator.parameters.every((p) => p.key !== "cycleMode"), "additiveGenerator: no Cycle (it has no phase; the partial phases live in Additive Out)");

const node = (visible) => ({ id: "aout-1", type: "additiveOut", params: {}, paramMeta: visible === undefined ? {} : { cycleMode: { visible } } });
const spec = ctx.nodeGraphModuleFaceSpec("additiveOut", node(true));
check(!Array.isArray(spec) || spec.length === 0, "additiveOut: no hand-written face, so parameters are generic rows (as PolyBLEP)");
const rows = (n) => ctx.nodeGraphModuleVisibleBodyRowCount("additiveOut", n);
const pbRows = (visible) => ctx.nodeGraphModuleVisibleBodyRowCount("polyBlep", { id: "pb", type: "polyBlep", params: {}, paramMeta: visible === undefined ? {} : { cycleMode: { visible } } });
check(rows(node(true)) === rows(node()) + 1, `additiveOut: Show adds the Cycle row (${rows(node())} -> ${rows(node(true))} rows)`);
check(rows(node(false)) === rows(node()), "additiveOut: Hide takes the Cycle row away again");
check(pbRows(true) === pbRows() + 1, `polyBlep reference: Show adds its Cycle row the same way (${pbRows()} -> ${pbRows(true)})`);

// ---------------------------------------------------------------- harmonic lines (Additive Out display)
const hl = read("public/modules/harmonicLines/harmonic-lines-display.js");
const hctx = vm.createContext({ Math, Number, Object, clampAuthoredInkPx: (v, d) => (Number.isFinite(v) ? v : d) });
vm.runInContext(hl.slice(0, hl.indexOf("function nodeGraphHarmonicLinesSettingsForNode")) + "\nthis.n = normalizeNodeGraphHarmonicLinesSettings;", hctx);
const norm = hctx.n;
check(norm(undefined).lineSmoothing === 1 && norm({}).lineSmoothing === 1, "harmonic lines: Line blur defaults to 1 px (antialiasing on), old patches without it load");
check(norm({ lineSmoothing: 0 }).lineSmoothing === 0 && norm({ lineSmoothing: 20 }).lineSmoothing === 8 && norm({ lineSmoothing: "x" }).lineSmoothing === 1,
  "harmonic lines: Line blur 0..8 CSS px (0 = hard core kept, out of range clamps, junk -> default)");
const html = hl.slice(hl.indexOf("function buildNodeGraphHarmonicLinesDisplaySettingsBodyHtml"));
check(/<span>Line blur<\/span>\s*<input type="range" min="0" max="8"[^>]*data-harmonic-lines-field="lineSmoothing"/.test(html),
  "harmonic lines settings: Line blur slider 0..8, same name and range as Plot / Waterfall");
const paint = hl.slice(hl.indexOf("function drawNodeGraphHarmonicLinesDisplay"));
check(!/nodeGraphGlLinesRect\(/.test(paint) && (paint.match(/nodeGraphGlLinesSegment\(batch, x,[^;]*smoothing, rgba, "square"\)/g) || []).length === 2,
  "harmonic lines: partial stems draw with the shared Expo-edge segment and the Line blur skirt (no aliased rects)");
check(/nodeGraphLineSmoothingPx\(hlLook/.test(paint) && !/lineSmoothing\) \|\| 1/.test(paint),
  "harmonic lines: Line blur goes through the shared nodeGraphLineSmoothingPx (0 no longer snaps back to 1)");

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exitCode = failures ? 1 : 0;