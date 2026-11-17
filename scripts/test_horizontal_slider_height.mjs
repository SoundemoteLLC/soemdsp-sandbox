#!/usr/bin/env node
// Horizontal sliders share one height: the generic Attenuverter Amplitude /
// PolyBLEP Frequency readout (--node-slider-readout-height / 30px). Face
// rows that used a custom h (Cinematic Reverb Amp at 40, Dark Velvet Length
// at 26, etc.) must resolve to that same height. Vertical fill sliders,
// knobs, and choice switches are left alone.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const styles = read("public/styles.css");
const cssMatch = styles.match(/--node-slider-readout-height:\s*([0-9.]+)px/);
assert(cssMatch, "styles.css must define --node-slider-readout-height");
const cssPx = Number(cssMatch[1]);
assert(cssPx === 30, `--node-slider-readout-height must be 30px (got ${cssPx})`);

const bag = {
  console,
  Object,
  Math,
  Number,
  String,
  Boolean,
  Array,
  Map,
  Set,
  JSON,
  parseInt,
  parseFloat,
  isFinite,
  isNaN,
  Infinity,
  NaN,
  undefined,
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
assert(defs && defs.reverbEffect && defs.polyBlep && defs.attenuverter, "definitions must load");
ctx.nodeGraphModuleDefinitions = defs;
vm.runInContext(read("public/node-graph-module-face.js"), ctx, { filename: "node-graph-module-face.js" });

const STD = ctx.NODE_GRAPH_HORIZONTAL_SLIDER_HEIGHT_PX;
assert(STD === 30 && STD === cssPx, "JS constant must match the CSS readout height (30px)");
assert(ctx.NODE_GRAPH_FACE_JACK_SLOT_PX === 17, "jack slot size is the existing 17px");

// Attenuverter and PolyBLEP have no custom face: they use the generic DOM slider.
assert(!defs.attenuverter.face && !defs.polyBlep.face, "Attenuverter and PolyBLEP use the generic horizontal readout, not a custom face");

function paramsOf(type) {
  return defs[type]?.parameters || [];
}

const cinematicSpec = ctx.nodeGraphModuleFaceSpec("reverbEffect");
const cinematicAmp = cinematicSpec.find((row) => row.kind === "cells" && row.params?.some((c) => c[0] === "amplitude"));
assert(cinematicAmp, "Cinematic Reverb has an Amp row");
assert(cinematicAmp.params.length === 1, "Cinematic Reverb Amp is a single-key horizontal row");
assert(cinematicAmp.h === STD, "Cinematic Reverb Amp must use the shared horizontal height, not h:40");
assert(
  ctx.nodeGraphModuleFaceRowHeight(cinematicAmp, paramsOf("reverbEffect")) === STD,
  "Cinematic Reverb Amp resolved height is the standard 30px",
);

const velvetSpec = ctx.nodeGraphModuleFaceSpec("velvetReverb");
const velvetLen = velvetSpec.find((row) => row.kind === "cells" && row.params?.some((c) => c[0] === "decay"));
assert(velvetLen && velvetLen.h === STD, "Dark Velvet Length (was h:26) must use the shared horizontal height");
assert(ctx.nodeGraphModuleFaceRowHeight(velvetLen, paramsOf("velvetReverb")) === STD);

const rawThick = { kind: "cells", params: [["amplitude", "Amp"]], h: 40 };
assert(
  ctx.nodeGraphModuleFaceRowIsContinuousHorizontalSlider(rawThick, [{ key: "amplitude" }]),
  "a lone Amp cell is a continuous horizontal slider",
);
assert(
  ctx.nodeGraphModuleFaceRowHeight(rawThick, [{ key: "amplitude" }]) === STD,
  "raw h:40 lone Amp rows still resolve to 30px",
);

const vertical = { kind: "cells", params: [["mix", "Mix"], ["recycle", "Recyc"]], h: 52 };
assert(
  !ctx.nodeGraphModuleFaceRowIsContinuousHorizontalSlider(vertical, [{ key: "mix" }, { key: "recycle" }]),
  "two-up column fill sliders are not horizontal sliders",
);
assert(
  ctx.nodeGraphModuleFaceRowHeight(vertical) === 52,
  "vertical fill slider rows keep their own height",
);

const choice = { kind: "cells", params: [["mode", "Mode"]], horizontal: true, h: 26 };
const choiceDefs = [{ key: "mode", choices: ["Off", "On"] }];
assert(
  !ctx.nodeGraphModuleFaceRowIsContinuousHorizontalSlider(choice, choiceDefs),
  "horizontal choice switches are not sliders",
);
assert(
  ctx.nodeGraphModuleFaceRowHeight(choice, choiceDefs) === 26,
  "choice switches keep their declared height in RowHeight (FaceSpec may still stack a lone switch)",
);

const off = [];
const kept = [];
for (const type of Object.keys(defs)) {
  const spec = ctx.nodeGraphModuleFaceSpec(type);
  if (!spec) continue;
  const plist = paramsOf(type);
  for (const row of spec) {
    if (row.kind !== "cells" || !row.params?.length) continue;
    if (!ctx.nodeGraphModuleFaceRowIsContinuousHorizontalSlider(row, plist)) continue;
    const n = row.params.length;
    const jackMin = n * ctx.NODE_GRAPH_FACE_JACK_SLOT_PX;
    const resolved = ctx.nodeGraphModuleFaceRowHeight(row, plist);
    const expected = Math.max(STD, jackMin);
    if (row.h !== STD || resolved !== expected) {
      off.push(type + " h=" + row.h + " resolved=" + resolved + " expected=" + expected + " n=" + n + " " + row.params.map((c) => c[1] || c[0]).join(","));
    } else {
      kept.push(type);
    }
  }
}
assert(off.length === 0, "horizontal sliders must resolve to the standard height (or jack-slot min):\n" + off.join("\n"));
assert(kept.length > 0, "audit must find horizontal slider rows");

const cinematicMixRow = cinematicSpec.find((row) => row.kind === "cells" && row.params?.some((c) => c[0] === "mix"));
assert(
  cinematicMixRow && cinematicMixRow.params.length === 3 && cinematicMixRow.h === 52,
  "Cinematic Reverb Mix|DSize|DAmt stays a tall vertical fill row",
);

console.log("ok  horizontal sliders: " + STD + "px SSOT, " + kept.length + " face rows, Cinematic Amp and Velvet Length fixed");
