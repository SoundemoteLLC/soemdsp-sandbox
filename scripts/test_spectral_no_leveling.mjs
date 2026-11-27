// docs/SPECTRAL_NO_LEVELING_PLAN.md: Spectral Cloud, Warble and Smear have no automatic leveling.
//   1. No signal-dependent gain: a steady sine and the same sine 20 dB quieter come out 20 dB +- 0.1 dB apart (a leveler shrinks the gap).
//   2. Beating is not flattened: with several voices the per-hop RMS of a steady tone varies (the per-frame power match used to pin it).
//   3. Amplitude (after Mix, through the real combined-wasm graph): linear and signed. 0.5 is half, 0 is silence, -1 inverts, and 4 is
//      four times with nothing clipped above 1.0.
// Also reports the default-settings peak level of each module on a saw and on pink noise, against dry.
//   node scripts/test_spectral_no_leveling.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sr = 48000;
const load = async (name) => (await WebAssembly.instantiate(await WebAssembly.compile(fs.readFileSync(path.join(root, `native_modules/${name}/${name}.wasm`))), {})).exports;
const cloudX = await load("spectral_blur"), warbleX = await load("spectral_warble"), smearX = await load("spectral_smear");
const fn = (x, p) => (name, ...a) => x[p + name](...a);
const cloud = fn(cloudX, "soemdsp_spectral_blur_"), warble = fn(warbleX, "soemdsp_spectral_warble_"), smear = fn(smearX, "soemdsp_spectral_smear_");

// One renderer per module at its definition's defaults, stereo in, stereo out, Mix 1.
const smearAt = (o) => (n, input) => {
  const c = { seconds: 2, hz: 100, cents: 0, diff: 1, speed: 30, hop: 4, spread: 1, bass: 120, phase: 10, amp: 0, seed: 0, ...o };
  const h = smear("create"); smear("set_fft_size", h, 4096); smear("set_overlap", h, c.hop); smear("set_smoothing", h, c.phase, c.amp); smear("set_stereo", h, c.spread, c.bass, c.speed); smear("set_blur_cents", h, c.cents); smear("set_seed", h, c.seed);
  const l = new Float64Array(n), r = new Float64Array(n);
  for (let i = 0; i < n; ++i) { const a = input(i); l[i] = smear("sample", h, a[0], a[1], c.seconds, c.hz, c.diff, 1, sr); r[i] = smear("right", h); }
  smear("destroy", h); return [l, r];
};
const modules = {
  cloud: (n, input) => {
    const h = cloud("create"); cloud("set_fft_size", h, 4096); cloud("set_cloud", h, 100, 1, 3, 0); cloud("set_stereo", h, 1, 0);
    const l = new Float64Array(n), r = new Float64Array(n);
    for (let i = 0; i < n; ++i) { const a = input(i); l[i] = cloud("sample", h, a[0], a[1], 1, sr); r[i] = cloud("right", h); }
    cloud("destroy", h); return [l, r];
  },
  warble: (n, input) => {
    const h = warble("create"); warble("set_fft_size", h, 4096); warble("set_warble", h, 25, 4, 0.5, 3, 0); warble("set_stereo", h, 1, 120);
    const l = new Float64Array(n), r = new Float64Array(n);
    for (let i = 0; i < n; ++i) { const a = input(i); l[i] = warble("sample", h, a[0], a[1], 1, sr); r[i] = warble("right", h); }
    warble("destroy", h); return [l, r];
  },
  smear: smearAt({}),
};
const sine = (f0, a) => (i) => { const v = a * Math.sin(2 * Math.PI * f0 * i / sr); return [v, v]; };
const saw = (f0, a = 0.3) => { const hm = Math.floor(0.45 * sr / f0); return (i) => { let v = 0; for (let k = 1; k <= hm; ++k) v += Math.sin(2 * Math.PI * f0 * k * i / sr) / k; v *= a * 0.6; return [v, v]; }; };
const pink = (() => { let sd = 7, b0 = 0, b1 = 0, b2 = 0; const a = new Float64Array(6 * sr); for (let i = 0; i < a.length; ++i) { const w = ((sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5) * 0.3; b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; a[i] = b0 + b1 + b2 + w * 0.1848; } return (i) => [a[i], a[i]]; })();
const rms = (a, lo = 0, hi = a.length) => { let e = 0; for (let i = lo; i < hi; ++i) e += a[i] * a[i]; return Math.sqrt(e / (hi - lo)); };
const peak = (a, lo = 0) => { let m = 0; for (let i = lo; i < a.length; ++i) m = Math.max(m, Math.abs(a[i])); return m; };
const dB = (v) => 20 * Math.log10(v);

// 1. No signal-dependent gain (the defaults, plus a Smear that runs every stage: Pitch Blur, the Smooth hop, Amplitude Smooth).
for (const [name, run] of [...Object.entries(modules), ["smear (Pitch Blur 300, hop 8, Amplitude Smooth 20)", smearAt({ cents: 300, hop: 8, amp: 20 })]]) {
  const loud = run(4 * sr, sine(880, 0.1)), quiet = run(4 * sr, sine(880, 0.01));
  for (const c of [0, 1]) {
    const gap = dB(rms(loud[c], sr) / rms(quiet[c], sr));
    assert.ok(Math.abs(gap - 20) <= 0.1, `${name} ch ${c}: a sine 20 dB quieter comes out 20 dB quieter (${gap.toFixed(3)} dB)`);
  }
  console.log(`no leveling: ${name} keeps a 20 dB input step at ${dB(rms(loud[0], sr) / rms(quiet[0], sr)).toFixed(4)} dB`);
}

// 2. Beating is not flattened: per-hop (512-sample) RMS of a steady 1760 Hz sine, its spread over its mean.
const hopSpread = (out) => { const w = 512, env = []; for (let i = sr; i + w <= out.length; i += w) env.push(rms(out, i, i + w)); const m = env.reduce((s, v) => s + v, 0) / env.length; return Math.sqrt(env.reduce((s, v) => s + (v - m) ** 2, 0) / env.length) / m; };
for (const name of ["cloud", "warble"]) {
  const s = hopSpread(modules[name](5 * sr, sine(1760, 0.1))[0]);
  console.log(`beating: ${name} (3 voices) per-hop RMS spread ${s.toFixed(3)}`);
  assert.ok(s > 0.05, `${name}: with 3 voices the per-hop RMS of a steady tone varies (${s})`);
}

// Report: default-settings peak and RMS against dry.
for (const [label, input] of [["saw 110 Hz", saw(110)], ["pink noise", pink]]) {
  const dry = []; for (let i = 0; i < 6 * sr; ++i) dry.push(input(i)[0]);
  const dryPeak = peak(dry, sr), dryRms = rms(dry, sr);
  for (const [name, run] of Object.entries(modules)) {
    const o = run(6 * sr, input), lat = 4096;
    const pk = Math.max(peak(o[0], sr + lat), peak(o[1], sr + lat)), r = Math.max(rms(o[0], sr + lat), rms(o[1], sr + lat));
    console.log(`level report, ${label}: ${name} peak ${dB(pk).toFixed(2)} dBFS (${(dB(pk) - dB(dryPeak)).toFixed(2)} dB vs dry ${dB(dryPeak).toFixed(2)}), RMS ${(dB(r) - dB(dryRms)).toFixed(2)} dB vs dry`);
  }
}

// 3. Amplitude through the native graph (the combined wasm): sine oscillator -> module -> Output, every param at its definition's default
// sent through the worklet's own key map (what the app sends).
const hostSrc = fs.readFileSync(path.join(root, "public/node-live-audio-worklet-native-graph.js"), "utf8");
const typeId = (t) => Number(new RegExp(`\\n  ${t}: (\\d+),`).exec(hostSrc)[1]);
const paramId = (k) => Number(new RegExp(`NATIVE_GRAPH_PARAM_${k} = (\\d+);`).exec(hostSrc)?.[1] ?? NaN);
const AMP = paramId("AMPLITUDE"), FREQ = paramId("FREQUENCY");
assert.ok(Number.isFinite(AMP) && Number.isFinite(FREQ), `param ids found (amplitude ${AMP}, frequency ${FREQ})`);
const keyMap = (type) => {
  const a = hostSrc.indexOf(`  if (t === "${type}") {`), b = hostSrc.indexOf("\n  }", a), out = {};
  for (const m of hostSrc.slice(a, b).matchAll(/if \(k === "(\w+)"\) return P\.NATIVE_GRAPH_PARAM_(\w+);/g)) out[m[1]] = paramId(m[2]);
  assert.equal(out.amplitude, AMP, `${type}: the worklet maps amplitude to the engine's Amplitude`);
  return out;
};
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
const mod = await WebAssembly.compile(fs.readFileSync(path.join(root, "native_modules/combined/soemdsp_combined.wasm")));
const imports = {};
for (const i of WebAssembly.Module.imports(mod)) { imports[i.module] ??= {}; imports[i.module][i.name] = i.kind === "function" ? () => 0 : undefined; }
const g = (await WebAssembly.instantiate(mod, imports)).exports;
const graphRender = (type, amp) => {
  const h = g.soemdsp_graph_create(); g.soemdsp_graph_set_sample_rate(h, sr);
  g.soemdsp_graph_add_node(h, 1, typeId("polyBlep")); g.soemdsp_graph_set_param(h, 1, FREQ, 220);
  assert.equal(g.soemdsp_graph_add_node(h, 2, typeId(type)), 0, `${type} added`);
  g.soemdsp_graph_add_node(h, 9, typeId("output"));
  const map = keyMap(type);
  for (const q of defs[type].parameters) if (q.key !== "amplitude" && Object.hasOwn(map, q.key) && Number.isFinite(Number(q.defaultValue))) g.soemdsp_graph_set_param(h, 2, map[q.key], Number(q.defaultValue));
  assert.equal(Number(defs[type].parameters.find((q) => q.key === "amplitude")?.defaultValue), 1, `${type}: Amplitude defaults to 1`);
  if (amp !== null) g.soemdsp_graph_set_param(h, 2, AMP, amp);
  g.soemdsp_graph_connect(h, 1, 5, 2, 0); // the oscillator's 1.0 sine on the first input (the inputs add, so one is a 0 dBFS source)
  for (const p of [0, 1, 2]) g.soemdsp_graph_connect(h, 2, p, 9, p);
  g.soemdsp_graph_compile?.(h); g.soemdsp_graph_snap_controls(h);
  const out = [[], [], []];
  for (let b = 0; b < 600; ++b) { // 1.6 s
    g.soemdsp_graph_process_block(h, 128);
    const mem = new Float64Array(g.memory.buffer);
    for (const p of [0, 1, 2]) { const q = g.soemdsp_graph_node_port_ptr(h, 2, p) / 8; for (let k = 0; k < 128; ++k) out[p].push(mem[q + k]); }
  }
  g.soemdsp_graph_destroy?.(h);
  return out;
};
for (const type of ["spectralBlur", "spectralWarble", "spectralSmear"]) {
  const unset = graphRender(type, null), one = graphRender(type, 1);
  const scale = Math.max(...one.map((c) => peak(c)));
  assert.ok(scale > 1e-3, `${type}: the graph render is not silent (${scale})`);
  const maxDiff = (a, b, k) => { let m = 0; for (let p = 0; p < 3; ++p) for (let i = 0; i < a[p].length; ++i) m = Math.max(m, Math.abs(a[p][i] - k * b[p][i])); return m; };
  assert.ok(maxDiff(unset, one, 1) <= 1e-12 * scale, `${type}: the default Amplitude is 1`);
  for (const k of [0.5, 0, -1, 4]) {
    const o = graphRender(type, k), d = maxDiff(o, one, k);
    assert.ok(d <= 1e-9 * scale, `${type}: Amplitude ${k} is exactly ${k} x the Amplitude 1 output (worst ${d})`);
    if (k === 0) assert.ok(Math.max(...o.map((c) => peak(c))) === 0, `${type}: Amplitude 0 is silence`);
    if (k === 4) assert.ok(Math.max(...o.map((c) => peak(c))) > 1 && Math.abs(Math.max(...o.map((c) => peak(c))) - 4 * scale) <= 1e-9 * scale,`${type}: Amplitude 4 goes past 1.0 unclipped (peak ${Math.max(...o.map((c) => peak(c)))})`);
  }
  console.log(`amplitude: ${type} is linear and signed (0.5, 0, -1, 4), nothing clipped; defaults on a 1.0 sine at 220 Hz peak at ${scale.toFixed(3)} (${dB(scale).toFixed(2)} dBFS)`);
}
console.log("test_spectral_no_leveling: ok");
