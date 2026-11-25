#!/usr/bin/env node
// Pitch Quantizer / Sturmian Grid Display Settings: the form-io "sync controls" branches sat in
// readNodeGraphTraceDisplaySettingsForm (where `normalized` does not exist, so every read threw a
// ReferenceError, and the real read further down never ran) instead of the write path. Reading the
// form must reach the module's own reader; writing must sync the module's controls.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "public/node-graph-module-scope-settings-form-io.js"), "utf8");
function assert(c, m) { if (!c) throw new Error(m); }

function extractFunction(name) {
  const start = src.indexOf(`function ${name}(`);
  assert(start >= 0, `${name} not found`);
  let i = src.indexOf("{", src.indexOf(")", start));
  let depth = 0;
  for (let j = i; j < src.length; j += 1) {
    const ch = src[j];
    if (ch === "{") depth += 1;
    else if (ch === "}") { depth -= 1; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error(`${name} unterminated`);
}

for (const [type, readerName, syncName, panelAttr] of [
  ["pitchQuantizerFace", "readNodeGraphPitchQuantizerDisplaySettingsForm", "syncNodeGraphPitchQuantizerDisplaySettingsControls", "data-pitch-quantizer-display-settings-panel"],
  ["sturmianGridFace", "readNodeGraphSturmianGridDisplaySettingsForm", "syncNodeGraphSturmianGridDisplaySettingsControls", "data-sturmian-grid-display-settings-panel"],
]) {
  const calls = [];
  const panel = { id: "panel" };
  const rootEl = { querySelector: (sel) => (sel.includes(panelAttr) ? panel : null) };
  const ctx = {
    document: { getElementById: () => ({}) },
    nodeGraphTraceDisplaySettingsFormType: () => type,
    nodeGraphTraceDisplaySettingsRoot: () => rootEl,
    nodeGraphTraceDisplayCurrentSettingsForFormType: () => ({ current: true }),
    normalizeNodeGraphDisplaySettingsForFormType: (s) => ({ ...s, normalized: true }),
    clearNodeGraphTraceDisplaySettingsDirty: () => {},
    syncNodeGraphTraceDisplayColorWidgets: () => calls.push("colors"),
    [readerName]: (r, current) => { calls.push("read"); return { fromForm: true, root: r, current }; },
    [syncName]: (p, s) => { calls.push(["sync", p, s]); },
  };
  vm.createContext(ctx);
  vm.runInContext(
    extractFunction("readNodeGraphTraceDisplaySettingsForm") + "\n" + extractFunction("nodeGraphWriteTraceDisplaySettingsFormInner"),
    ctx,
  );
  const read = vm.runInContext("readNodeGraphTraceDisplaySettingsForm()", ctx);
  assert(read && read.fromForm === true, `${type}: reading the form must return the module reader's result, got ${JSON.stringify(read)}`);
  assert(calls.includes("read"), `${type}: module reader was not called`);

  calls.length = 0;
  vm.runInContext("nodeGraphWriteTraceDisplaySettingsFormInner({ a: 1 })", ctx);
  const sync = calls.find((c) => Array.isArray(c) && c[0] === "sync");
  assert(sync && sync[1] === panel, `${type}: writing the form must sync the module's controls into its panel`);
  assert(sync[2].normalized === true, `${type}: sync must receive the normalized settings`);
}
console.log("test_display_settings_form_io_sync: ok");