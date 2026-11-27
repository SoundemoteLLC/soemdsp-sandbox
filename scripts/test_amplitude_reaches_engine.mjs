// SPECTRAL_FACE_FIX_PLAN 1: Amp must reach the engine through the path the app uses. The knob writes node.params; the worklet's
// syncNativeGraphParams pushes the keys its per-type list names (node-live-audio-worklet-native-graph.js) to the native graph. A key
// missing from that list never sounds, whatever the definition or the key map say (that was why Amp did nothing on Spectral Smear,
// Cloud and Warble).
//   - every module with an Amplitude param: the worklet's push list names it (reported for all, asserted for the spectral modules);
//   - Cloud, Warble, Smear: the shipped worklet code, driving the real combined wasm, makes Amp 0.5 = -6.02 dB, 0 = silence and
//     -1 = the same output inverted (sine on the input, defaults from the definitions).
//   node scripts/test_amplitude_reaches_engine.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbag = { console, Object, Math, Number, String, Boolean, Array, Map, Set, JSON, parseInt, parseFloat, isFinite, isNaN, Infinity, NaN, undefined };
const defsCtx = new Proxy(dbag, {
  has: () => true,
  get(t, p) { if (p === Symbol.unscopables) return undefined; if (p in t) return t[p]; const stub = function stub(...a) { return a.length ? a[0] : []; }; t[p] = stub; return stub; },
  set(t, p, v) { t[p] = v; return true; },
});
dbag.globalThis = defsCtx; dbag.window = defsCtx;
vm.createContext(defsCtx);
vm.runInContext(fs.readFileSync(path.join(root, "public/node-graph-module-definitions.js"), "utf8") + "\nthis.__defs = nodeGraphModuleDefinitions;", defsCtx);
const defs = dbag.__defs;

// The shipped worklet host code, on a stub processor class (as the other worklet tests load it).
const ctx = vm.createContext({
  console, sampleRate: 48000, nodeGraphModuleDefinitions: defs,
  nodeGraphFiniteNumber: (v, f = 0) => (Number.isFinite(Number(v)) ? Number(v) : f),
});
vm.runInContext("class NodeLiveAudioProcessor {}; globalThis.NodeLiveAudioProcessor = NodeLiveAudioProcessor;", ctx);
vm.runInContext(fs.readFileSync(path.join(root, "public/node-live-audio-worklet-native-graph.js"), "utf8"), ctx, { filename: "native-graph.js" });
const P = ctx.NodeLiveAudioProcessor;

// 1. Which modules' Amplitude the push list names.
const gaps = [];
let named = 0;
for (const [type, def] of Object.entries(defs)) {
  if (!Object.hasOwn(P.NATIVE_GRAPH_TYPE_IDS, type)) continue;
  const amp = (def.parameters || []).find((p) => p.key === "amplitude" || p.key === "amp");
  if (!amp) continue;
  const proc = Object.create(P.prototype);
  proc.nodes = new Map([["n1", { id: "n1", type, params: {} }]]);
  try { proc.syncNativeGraphParams(128, true); } catch (e) { gaps.push(`${type} (push list threw: ${String(e).slice(0, 60)})`); continue; }
  if (Number.isFinite(proc._nativeParamIdsByType?.get(type)?.[amp.key])) named += 1;
  else gaps.push(`${type}.${amp.key}`);
}
console.log(`push list names Amplitude for ${named} modules; not named: ${gaps.length ? gaps.join(", ") : "none"}`);
const SPECTRAL = ["spectralBlur", "spectralWarble", "spectralSmear"];
for (const t of SPECTRAL) assert.ok(!gaps.some((g) => g.startsWith(`${t}.`) || g.startsWith(`${t} `)), `${t}: the worklet pushes Amplitude`);

// 2. The shipped sync code drives the real engine.
const mod = await WebAssembly.compile(fs.readFileSync(path.join(root, "native_modules/combined/soemdsp_combined.wasm")));
const imports = {};
for (const i of WebAssembly.Module.imports(mod)) { imports[i.module] ??= {}; imports[i.module][i.name] = i.kind === "function" ? () => 0 : undefined; }
const x = (await WebAssembly.instantiate(mod, imports)).exports;
const sr = 48000;
const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
const render = (type, amp) => {
  // The module's params as the knobs left them; the worklet pushes them by its own list, keyed by its own node hash.
  const proc = Object.create(P.prototype);
  const params = {};
  for (const q of defs[type].parameters || []) if (Number.isFinite(Number(q.defaultValue))) params[q.key] = Number(q.defaultValue);
  params.amplitude = amp;
  proc.nodes = new Map([["mod", { id: "mod", type, params }]]);
  const h = x.soemdsp_graph_create();
  x.soemdsp_graph_set_sample_rate(h, sr);
  const modHash = proc.fnv1aHash32("mod");
  x.soemdsp_graph_add_node(h, 1, P.NATIVE_GRAPH_TYPE_IDS.polyBlep);
  x.soemdsp_graph_set_param(h, 1, P.NATIVE_GRAPH_PARAM_FREQUENCY, 220);
  assert.equal(x.soemdsp_graph_add_node(h, modHash, P.NATIVE_GRAPH_TYPE_IDS[type]), 0, `${type} added`);
  x.soemdsp_graph_add_node(h, 9, P.NATIVE_GRAPH_TYPE_IDS.output);
  x.soemdsp_graph_connect(h, 1, P.NATIVE_GRAPH_PORT_SINE ?? 5, modHash, 0);
  for (const port of [0, 1, 2]) x.soemdsp_graph_connect(h, modHash, port, 9, port);
  x.soemdsp_graph_compile?.(h);
  Object.assign(proc, { efficientProduct: true, nativeGraphCompiled: true, nativeGraphHandle: h, nativeGraph: x, _nativeGraphParamCacheCold: true });
  proc.syncNativeGraphParams(128);
  x.soemdsp_graph_snap_controls(h);
  const out = [];
  for (let b = 0; b < 500; b += 1) {
    x.soemdsp_graph_process_block(h, 128);
    const mem = new Float64Array(x.memory.buffer);
    const q = x.soemdsp_graph_node_port_ptr(h, modHash, 1) / 8; // Left
    for (let k = 0; k < 128; k += 1) out.push(mem[q + k]);
  }
  x.soemdsp_graph_destroy?.(h);
  return out.slice(sr / 2); // past the STFT latency and the warm-up
};
for (const type of SPECTRAL) {
  const one = render(type, 1);
  const ref = rms(one);
  assert.ok(ref > 1e-3, `${type}: the module sounds (${ref})`);
  const half = rms(render(type, 0.5));
  const db = 20 * Math.log10(half / ref);
  assert.ok(Math.abs(db + 6.0206) < 0.01, `${type}: Amp 0.5 is -6.02 dB (${db.toFixed(4)})`);
  assert.equal(Math.max(...render(type, 0).map(Math.abs)), 0, `${type}: Amp 0 is silence`);
  const inv = render(type, -1);
  let worst = 0;
  for (let i = 0; i < one.length; i += 1) worst = Math.max(worst, Math.abs(inv[i] + one[i]));
  assert.ok(worst <= 1e-9 * Math.max(...one.map(Math.abs)), `${type}: Amp -1 inverts (${worst})`);
  console.log(`${type}: Amp reaches the engine through the worklet (0.5 = ${db.toFixed(3)} dB, 0 = silence, -1 = inverted)`);
}
console.log("test_amplitude_reaches_engine: ok");
