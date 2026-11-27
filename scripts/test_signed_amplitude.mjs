// HP-24: one rule for amplitude in the whole app. Amplitude is a signed gain: a negative value inverts the signal at that magnitude,
// and the param definition is the only source of limits. Runs the real combined wasm headless (no browser).
//
// For every module whose definition has an "amp" or "amplitude" param and that the native graph runs, render it at Amplitude 0, +0.5
// and -0.5 (a sine feeds its first two inputs) and check each output Amplitude moves: what -0.5 adds to the Amplitude 0 render must
// be what +0.5 adds, inverted (correlation below -0.99, same RMS within 1%). The definition's min is the spawn range, not a hard
// limit (typing below it extends it), so this holds for every module.
//
//   node scripts/test_signed_amplitude.mjs [--list]
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const listOnly = process.argv.includes("--list");

// Module definitions (browser script) in a sandbox: any other global it reads at load is a pass-through stub.
const dbag = { console, Object, Math, Number, String, Boolean, Array, Map, Set, JSON, parseInt, parseFloat, isFinite, isNaN, Infinity, NaN, undefined };
const defsCtx = new Proxy(dbag, {
  has: () => true,
  get(t, p) { if (p === Symbol.unscopables) return undefined; if (p in t) return t[p]; const fn = function stub(...a) { return a.length ? a[0] : []; }; t[p] = fn; return fn; },
  set(t, p, v) { t[p] = v; return true; },
});
dbag.globalThis = defsCtx;
dbag.window = defsCtx;
vm.createContext(defsCtx);
vm.runInContext(fs.readFileSync(path.join(root, "public/node-graph-module-definitions.js"), "utf8") + "\nthis.__defs = nodeGraphModuleDefinitions;", defsCtx);
const defs = dbag.__defs;

// Native type and param ids from the worklet host (the same tables the app uses).
const hostCtx = { console, Object, Array, Math, Number, String, JSON, Set, Map };
hostCtx.NodeLiveAudioProcessor = function NodeLiveAudioProcessor() {};
hostCtx.NodeLiveAudioProcessor.prototype = {};
vm.createContext(hostCtx);
const host = fs.readFileSync(path.join(root, "public/node-live-audio-worklet-native-graph.js"), "utf8");
const cut = host.indexOf("NodeLiveAudioProcessor.NATIVE_GRAPH_PARAM_KEY_IDS");
const tableEnd = host.indexOf("});", cut) + 3;
vm.runInContext(host.slice(0, tableEnd).replace(/^[\s\S]*?(NodeLiveAudioProcessor\.NATIVE_GRAPH_TYPE_IDS)/, "$1"), hostCtx);
const TYPE_IDS = hostCtx.NodeLiveAudioProcessor.NATIVE_GRAPH_TYPE_IDS;
const PARAM_IDS = hostCtx.NodeLiveAudioProcessor.NATIVE_GRAPH_PARAM_KEY_IDS;

const mod = await WebAssembly.compile(fs.readFileSync(path.join(root, "native_modules/combined/soemdsp_combined.wasm")));
const imports = {};
for (const i of WebAssembly.Module.imports(mod)) {
  imports[i.module] ??= {};
  imports[i.module][i.name] = i.kind === "function" ? () => 0 : undefined;
}
const x = (await WebAssembly.instantiate(mod, imports)).exports;
const SR = 48000;
const BLK = 128;
const BLOCKS = 40;
const OSC = 1; // polyBLEP: the test source
const SINE_PORT = 5;
const PORTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

// Outputs that do not carry Amplitude as a gain, by design (port: why).
const EXCEPTIONS = {
  resonantEnvelope: { 3: "Sidechain out is 1 - Out / Amplitude: a normalized ducking curve, sign-free by design" },
  modeResonator: { 3: "the face's peak tap (a magnitude for the display), not audio" },
};

function render(typeId, paramId, amp, extraParams, trigger = false) {
  const h = x.soemdsp_graph_create();
  x.soemdsp_graph_set_sample_rate(h, SR);
  x.soemdsp_graph_add_node(h, 1, OSC);
  x.soemdsp_graph_set_param(h, 1, PARAM_IDS.frequency, 220);
  x.soemdsp_graph_add_node(h, 2, typeId);
  for (const [id, v] of extraParams) x.soemdsp_graph_set_param(h, 2, id, v);
  x.soemdsp_graph_set_param(h, 2, paramId, amp);
  x.soemdsp_graph_connect(h, 1, SINE_PORT, 2, 0);
  x.soemdsp_graph_connect(h, 1, SINE_PORT, 2, 1);
  if (trigger) x.soemdsp_graph_connect(h, 1, SINE_PORT, 2, 20); // the sine's positive half-cycles are gates (drums, envelopes)
  x.soemdsp_graph_compile?.(h);
  x.soemdsp_graph_snap_controls(h); // start at the set values: a ramp from the default would hide the sign
  const out = PORTS.map(() => []);
  for (let b = 0; b < BLOCKS; b += 1) {
    x.soemdsp_graph_process_block(h, BLK);
    if (b < BLOCKS / 2) continue; // skip settling (smoothers, envelopes)
    const mem = new Float64Array(x.memory.buffer);
    PORTS.forEach((p, i) => {
      const q = x.soemdsp_graph_node_port_ptr(h, 2, p) / 8;
      for (let k = 0; k < BLK; k += 1) out[i].push(mem[q + k]);
    });
  }
  x.soemdsp_graph_destroy?.(h);
  return out;
}

const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
const corr = (a, b) => {
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i += 1) { ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return ab / Math.sqrt(aa * bb || 1);
};

const rows = [];
for (const [type, def] of Object.entries(defs)) {
  const p = (def.parameters || []).find((q) => q.key === "amp" || q.key === "amplitude");
  if (!p || !Object.hasOwn(TYPE_IDS, type)) continue;
  const paramId = PARAM_IDS[p.key];
  const min = Number(p.min);
  const extra = (def.parameters || [])
    .filter((q) => q !== p && Object.hasOwn(PARAM_IDS, q.key) && Number.isFinite(Number(q.defaultValue)))
    .map((q) => [PARAM_IDS[q.key], Number(q.defaultValue)]);
  if (listOnly) { rows.push({ type, key: p.key, min }); continue; }
  const measure = (trigger) => {
    const zero = render(TYPE_IDS[type], paramId, 0, extra, trigger);
    const pos = render(TYPE_IDS[type], paramId, 0.5, extra, trigger);
    const neg = render(TYPE_IDS[type], paramId, -0.5, extra, trigger);
    let live = 0;
    const bad = [];
    pos.forEach((a, i) => {
      if (!a.every(Number.isFinite)) return;
      if (EXCEPTIONS[type]?.[PORTS[i]]) return;
      // What Amplitude contributes: the render minus the Amplitude 0 render (a bias, a dry thru or a gate output cancels out).
      const up = a.map((v, k) => v - zero[i][k]);
      const down = neg[i].map((v, k) => v - zero[i][k]);
      const r = rms(up);
      if (!(r > 1e-6)) return;
      live += 1;
      const c = corr(up, down);
      const ratio = rms(down) / r;
      if (!(c < -0.99 && Math.abs(ratio - 1) < 0.01)) bad.push(`port ${PORTS[i]}: corr ${c.toFixed(3)} rms ${ratio.toFixed(3)}`);
    });
    return { live, bad };
  };
  // Audio into In; a module that stays silent gets the same sine on its Trigger too.
  let { live, bad } = measure(false);
  if (!live) ({ live, bad } = measure(true));
  rows.push({ type, key: p.key, min, live, bad });
}

if (listOnly) {
  for (const r of rows) console.log(`${r.type}.${r.key} min ${r.min}`);
  process.exit(0);
}
// The definition's min is the spawn range, not a hard limit (typing below it extends it), so every module must take a signed value.
let failures = 0;
for (const r of rows) {
  if (!r.live) { console.log(`skip  ${r.type}.${r.key}: no output moves with Amplitude for this test input`); continue; }
  if (r.bad.length) { failures += 1; console.log(`FAIL  ${r.type}.${r.key}: ${r.bad.join("; ")}`); }
  else console.log(`ok    ${r.type}.${r.key}: -0.5 is +0.5 inverted`);
}
console.log(failures ? `test_signed_amplitude: ${failures} module(s) clamp or rectify a negative amplitude` : "test_signed_amplitude: ok");
process.exit(failures ? 1 : 0);
