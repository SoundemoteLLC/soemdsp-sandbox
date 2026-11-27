#!/usr/bin/env node
// T-module / Display Height 0: hiding or Off must hide the face and collapse layout.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sizing = fs.readFileSync(path.join(root, "public/node-graph-module-sizing.js"), "utf8");
const gl = fs.readFileSync(path.join(root, "public/node-graph-gl-graph.js"), "utf8");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(
  /function nodeGraphModuleDisplayVisibleForUi\(type, ui = \{\}\) \{[\s\S]*?ConfiguredDisplayHeightUnits\(type, ui\) <= 0/.test(sizing),
  "DisplayVisibleForUi must treat Display Height 0 as hidden",
);

assert(
  /function nodeGraphLayoutBShellHeightGu\(type, ui = \{\}, options = \{\}\) \{[\s\S]*?const sliderGu = typeof nodeGraphModuleSliderBodyHeightGu === "function"[\s\S]*?return Math\.max\(0, ioGu - Math\.max\(0, sliderGu\)\) \+ stripGu;/.test(sizing),
  "LayoutB hidden-face shell only covers IO height beyond the slider rows",
);

assert(
  /layoutBFaceOff[\s\S]*?DisplayHeightUnits\([\s\S]*?\) <= 0/.test(sizing),
  "LayoutB Display Height 0 must omit the face track",
);

assert(
  /oscilloscope-hidden[\s\S]*?face-track-omitted[\s\S]*?NODE_GRAPH_DISPLAY_FACE_SELECTOR/.test(gl),
  "GL graph must not collect faces from hidden or face-track-omitted modules",
);

console.log("ok  t-display collapse: height 0 and Hide stay hidden; GL skips omitted faces");
