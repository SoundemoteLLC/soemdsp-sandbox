// PASTE-7 release smoke, audio half: every module the native engine runs, headless against the real combined wasm (seconds, not the
// hours a headless browser needs). Default params, a 220 Hz sine on its first two inputs (and on Trigger when it stays silent):
//   - NaN / Inf on any output is a failure;
//   - a source (definition planRole "source") that stays silent is listed (may be fine: some sources wait for a gate or a clock).
//   node scripts/smoke_native_audio.mjs
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
const SR = 48000, BLK = 128, BLOCKS = 60, OSC = 1, SINE = 5, PORTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

function render(typeId, params, trigger) {
  const h = x.soemdsp_graph_create();
  x.soemdsp_graph_set_sample_rate(h, SR);
  x.soemdsp_graph_add_node(h, 1, OSC);
  x.soemdsp_graph_set_param(h, 1, PARAM_IDS.frequency, 220);
  const rc = x.soemdsp_graph_add_node(h, 2, typeId);
  if (rc !== 0) { x.soemdsp_graph_destroy?.(h); return { addError: rc }; }
  x.soemdsp_graph_add_node(h, 9, 6); // Output: only what reaches it runs
  for (const [id, v] of params) x.soemdsp_graph_set_param(h, 2, id, v);
  x.soemdsp_graph_connect(h, 1, SINE, 2, 0);
  x.soemdsp_graph_connect(h, 1, SINE, 2, 1);
  if (trigger) x.soemdsp_graph_connect(h, 1, SINE, 2, 20);
  for (const p of [0, 1, 2]) x.soemdsp_graph_connect(h, 2, p, 9, p);
  x.soemdsp_graph_compile?.(h);
  x.soemdsp_graph_snap_controls(h);
  let nonFinite = [];
  let peak = 0;
  for (let b = 0; b < BLOCKS; b += 1) {
    x.soemdsp_graph_process_block(h, BLK);
    const mem = new Float64Array(x.memory.buffer);
    for (const p of PORTS) {
      const q = x.soemdsp_graph_node_port_ptr(h, 2, p) / 8;
      for (let k = 0; k < BLK; k += 1) {
        const v = mem[q + k];
        if (!Number.isFinite(v)) { if (!nonFinite.includes(p)) nonFinite.push(p); }
        else if (p <= 2) peak = Math.max(peak, Math.abs(v));
      }
    }
  }
  x.soemdsp_graph_destroy?.(h);
  return { nonFinite, peak };
}

const rows = [];
for (const [type, def] of Object.entries(defs)) {
  if (!Object.hasOwn(TYPE_IDS, type) || type === "output") continue;
  const params = (def.parameters || [])
    .filter((q) => Object.hasOwn(PARAM_IDS, q.key) && Number.isFinite(Number(q.defaultValue)))
    .map((q) => [PARAM_IDS[q.key], Number(q.defaultValue)]);
  let r = render(TYPE_IDS[type], params, false);
  if (!r.addError && !(r.peak > 1e-6) && !r.nonFinite.length) r = render(TYPE_IDS[type], params, true);
  rows.push({ type, source: def.planRole === "source", ...r });
}
const nonFinite = rows.filter((r) => r.nonFinite?.length);
const addErrors = rows.filter((r) => r.addError);
const silentSources = rows.filter((r) => r.source && !r.addError && !r.nonFinite?.length && !(r.peak > 1e-6));
for (const r of nonFinite) console.log(`NaN   ${r.type}: ports ${r.nonFinite.join(",")}`);
for (const r of addErrors) console.log(`ADD   ${r.type}: add_node ${r.addError}`);
for (const r of silentSources) console.log(`QUIET ${r.type} (source, silent with defaults + sine / trigger)`);
console.log(`smoke_native_audio: ${rows.length} native modules, ${nonFinite.length} with NaN/Inf, ${addErrors.length} not added, ${silentSources.length} silent sources`);
process.exit(nonFinite.length || addErrors.length ? 1 : 0);
