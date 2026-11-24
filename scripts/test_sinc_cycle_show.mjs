#!/usr/bin/env node
// Sinc's hidden Cycle (cycleMode) parameter: the Show toggle (paramMeta.visible)
// must put it on the hand-written face, and Hide must take it off again, the way
// PolyBLEP's generic rows do. A face only draws params its rows list, so Cycle
// needs a face row; hidden rows drop out and the face height closes up.
//   node scripts/test_sinc_cycle_show.mjs
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
// The real visibility rule (definition hidden = default off; paramMeta.visible overrides).
const meta = read("public/node-graph-parameter-metadata.js");
const pick = (name) => {
  const start = meta.indexOf(`function ${name}(`);
  const m = /\r?\n}\r?\n/.exec(meta.slice(start));
  if (start < 0 || !m) throw new Error(`${name} not found`);
  return meta.slice(start, start + m.index + m[0].length);
};
// (Assigned explicitly: the loaders above already probed the name and got a stub.)
bag.nodeGraphParameterEffectiveVisible = vm.runInContext(
  "(function () {\n" + pick("nodeGraphParameterDefaultVisible") + "\n" + pick("nodeGraphParameterEffectiveVisible")
    + "\nreturn nodeGraphParameterEffectiveVisible;\n})()",
  ctx,
);
if (bag.nodeGraphParameterEffectiveVisible({ hidden: true }, undefined) !== false) throw new Error("visibility rule did not load");

const cycleDef = defs.sinc.parameters.find((p) => p.key === "cycleMode");
const pbCycle = defs.polyBlep.parameters.find((p) => p.key === "cycleMode");
check(cycleDef && cycleDef.hidden === true && cycleDef.defaultValue === "0", "sinc: Cycle is a hidden parameter, default Free run");
check(JSON.stringify(cycleDef?.choices) === JSON.stringify(pbCycle?.choices) && cycleDef?.label === pbCycle?.label,
  "sinc: Cycle has PolyBLEP's label and choices");

const node = (visible) => ({ id: "sinc-1", type: "sinc", params: {}, paramMeta: visible === undefined ? {} : { cycleMode: { visible } } });
const keysOf = (spec) => (spec || []).flatMap((row) => ctx.nodeGraphModuleFaceRowParams(row));
const specDefault = ctx.nodeGraphModuleFaceSpec("sinc", node());
const specShown = ctx.nodeGraphModuleFaceSpec("sinc", node(true));
const specHidden = ctx.nodeGraphModuleFaceSpec("sinc", node(false));
const h = (n) => ctx.nodeGraphModuleFaceHeightPx("sinc", n);

check(!keysOf(specDefault).includes("cycleMode"), "sinc face: Cycle is off the face by default (hidden on spawn)");
check(keysOf(specShown).includes("cycleMode"), "sinc face: Show puts Cycle on the face");
const row = (specShown || []).find((r) => ctx.nodeGraphModuleFaceRowParams(r).includes("cycleMode"));
check(row?.kind === "choices" && JSON.stringify(row.labels) === JSON.stringify(pbCycle.choices),
  `sinc face: Cycle draws as a choice switch (${row ? row.kind + " " + JSON.stringify(row.labels) : "no row"})`);
check(h(node(true)) > h(node()), `sinc face: the face grows when Cycle is shown (${h(node())} -> ${h(node(true))} px)`);
check(!keysOf(specHidden).includes("cycleMode") && h(node(false)) === h(node()),
  "sinc face: Hide takes Cycle off again and the face closes back up");
// The other rows are untouched.
const others = (spec) => keysOf(spec).filter((k) => k !== "cycleMode").join(",");
check(others(specShown) === others(specDefault) && others(specDefault) === "bandLimit,freq,phase,lobes,amplitude",
  `sinc face: the other controls stay as they were (${others(specDefault)})`);

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);