// Modal Snare strike tap (__Strike, Phase01): velocity on each struck sample.
// The display no longer sizes its window from hits (a varied rhythm resized
// it); rhythms use the shared Window = Beats (scripts/test_scope_window_beats.mjs).
//   node scripts/test_modal_snare_cycles.mjs
// 1. modal_snare.wasm: strike tap = velocity on each struck sample, else 0
//    (Trigger hits of either sign, Reset re-strikes; silent Reset is no hit).
// 2. Combined graph engine: the modalSnare node's Phase01 port carries exactly
//    the standalone module's strikes for the same trigger stream.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;
const check = (ok, msg) => { if (!ok) { failed += 1; console.error("FAIL", msg); } else console.log("ok  ", msg); };
const load = async (rel) => {
  const mod = await WebAssembly.compile(fs.readFileSync(path.join(root, rel)));
  const imports = {};
  for (const i of WebAssembly.Module.imports(mod)) { imports[i.module] ??= {}; imports[i.module][i.name] = i.kind === "function" ? () => 0 : undefined; }
  const x = (await WebAssembly.instantiate(mod, imports)).exports;
  if (typeof x.soemdsp_memory_set_budget_mb === "function") x.soemdsp_memory_set_budget_mb(256);
  return x;
};
const SR = 48000;

// ------------------------------------------------------------ 1. strike tap
const sn = await load("native_modules/modal_snare/modal_snare.wasm");
check(sn.soemdsp_modal_snare_version() >= 8, `modal_snare version ${sn.soemdsp_modal_snare_version()}`);
const snareStrikes = (trig, reset = null) => {
  const h = sn.soemdsp_modal_snare_create();
  const out = new Float64Array(trig.length);
  for (let i = 0; i < trig.length; i += 1) {
    sn.soemdsp_modal_snare_sample(h, trig[i], reset ? reset[i] : 0, 180, 0.5, 0.5, 0.25, 0.2, 0, 1, 3000, 1, 0.3, 2, 0, SR, 0, 0);
    out[i] = sn.soemdsp_modal_snare_strike(h);
  }
  sn.soemdsp_modal_snare_destroy(h);
  return out;
};
{
  const n = 4000;
  const trig = new Float64Array(n);
  const reset = new Float64Array(n);
  reset[50] = 1; // before any Trigger: silent, no hit
  for (let i = 100; i < 110; i += 1) trig[i] = 0.7; // one 10-sample gate = one hit at 0.7
  trig[1000] = -0.4; // negative height rectifies: a hit at 0.4
  reset[2000] = 1; // re-strike at the last velocity
  const s = snareStrikes(trig, reset);
  const hitsAt = [...s.keys()].filter((i) => s[i] !== 0);
  check(JSON.stringify(hitsAt) === JSON.stringify([100, 1000, 2000]), `strikes land on samples 100, 1000, 2000 (got ${hitsAt})`);
  check(Math.abs(s[100] - 0.7) < 1e-12 && Math.abs(s[1000] - 0.4) < 1e-12 && Math.abs(s[2000] - 0.4) < 1e-12, "strike value = velocity (0.7, rectified 0.4, Reset re-strike 0.4)");
}

// ------------------------------------------------------------ 2. graph engine tap
{
  const x = await load("native_modules/combined/soemdsp_combined.wasm");
  const BLK = 128, OSC = 1, SNARE = 228, OUT_PORT = 5, TRIGGER_IN = 20, PHASE01 = 10;
  const h = x.soemdsp_graph_create();
  x.soemdsp_graph_set_sample_rate(h, SR);
  x.soemdsp_graph_add_node(h, 1, OSC);
  x.soemdsp_graph_set_param(h, 1, 10, 37);
  x.soemdsp_graph_add_node(h, 2, SNARE);
  x.soemdsp_graph_connect(h, 1, OUT_PORT, 2, TRIGGER_IN);
  check(x.soemdsp_graph_compile(h) === 0, "engine: Osc -> Modal Snare Trigger compiles");
  const port = (node, p) => { const q = x.soemdsp_graph_node_port_ptr(h, node, p) / 8; return new Float64Array(x.memory.buffer).slice(q, q + BLK); };
  const trig = [], tap = [];
  for (let b = 0; b < 400; b += 1) {
    x.soemdsp_graph_process_block(h, BLK);
    trig.push(...port(1, OUT_PORT));
    tap.push(...port(2, PHASE01));
  }
  const ref = snareStrikes(Float64Array.from(trig));
  let same = true;
  for (let i = 0; i < ref.length; i += 1) if (!(Math.abs(ref[i] - tap[i]) < 1e-12)) { same = false; break; }
  const count = tap.filter((v) => v > 0).length;
  check(same && count > 0, `engine: Phase01 (__Strike) == standalone strikes for the same trigger stream (${count} struck samples)`);
}

if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log("all passed");
