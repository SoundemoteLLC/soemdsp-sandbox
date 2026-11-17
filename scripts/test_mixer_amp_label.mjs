#!/usr/bin/env node
// Mixer master-amplitude display labels are "Amp". Param ids stay
// "amplitude" so saved patches still load. Channel labels (Amplitude1, etc.)
// are unchanged.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const src = fs.readFileSync(path.join(root, "public/node-graph-module-definitions.js"), "utf8");
assert(!/Amplitude \(All\)/.test(src), "no mixer should still use the long Amplitude (All) label");

const bag = { console, Object, Math, Number, String, Boolean, Array, Map, Set, JSON, parseInt, parseFloat, isFinite, isNaN, Infinity, NaN, undefined };
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
vm.createContext(ctx);
vm.runInContext(src + "\nthis.__exportedDefs = nodeGraphModuleDefinitions;", ctx, { filename: "node-graph-module-definitions.js" });
const defs = bag.__exportedDefs;
assert(defs, "definitions must load");

function labelOf(type, key) {
  const p = (defs[type]?.parameters || []).find((item) => item.key === key);
  return p ? p.label : null;
}

const mixers = ["mixStereo4", "mixStereo2", "mixStereo", "mix2"];
for (const type of mixers) {
  assert(defs[type], type + " must exist");
  const p = (defs[type].parameters || []).find((item) => item.key === "amplitude");
  assert(p, type + " keeps param id amplitude");
  assert(p.label === "Amp", type + " master amplitude label must be Amp (got " + p.label + ")");
}

assert(labelOf("mix2", "amplitude1") === "Amplitude1", "mix2 channel Amplitude1 is unchanged");
assert(labelOf("mix2", "amplitude2") === "Amplitude2", "mix2 channel Amplitude2 is unchanged");
assert(labelOf("exponentialMix", "amplitude") === "Amplitude", "exponentialMix output scale is not a mixer master-all control");
assert(labelOf("mix4", "amplitude") === null && labelOf("mix", "amplitude") === null, "legacy Mix4 aliases have no master amplitude param");

const changed = mixers.map((type) => type + ' amplitude -> "' + labelOf(type, "amplitude") + '"').join(", ");
console.log("ok  mixer master labels: " + changed);
