import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const root = new URL("../", import.meta.url), sr = 48000;
const definitions = fs.readFileSync(new URL("public/node-graph-module-definitions.js", root), "utf8");
const cases = [
  ["stft_contrast", "stftContrast", "stftGate", ["contrast", "scale", "thresholdDb", "ratio", "attackMs", "releaseMs", "maxBoostDb", "gainDb", "mix"]],
  ["stft_gate", "stftGate", "vocoder", ["profileMode", "thresholdDb", "marginDb", "depthDb", "attackMs", "releaseMs", "smooth", "mix"]],
];
const modules = {};
for (const [snake, type, next, order] of cases) {
  const { instance } = await WebAssembly.instantiate(fs.readFileSync(new URL(`native_modules/${snake}/${snake}.wasm`, root)));
  const x = instance.exports, prefix = `soemdsp_${snake}_`;
  const metadata = JSON.parse(new TextDecoder().decode(new Uint8Array(x.memory.buffer, x[prefix + "metadata_json"](), x[prefix + "metadata_json_size"]())));
  const start = definitions.indexOf(`\n  ${type}: {`), end = definitions.indexOf(`\n  ${next}: {`, start);
  assert.ok(start >= 0 && end > start);
  const def = vm.runInNewContext(`({${definitions.slice(start, end)}}).${type}`);
  assert.deepEqual(JSON.parse(JSON.stringify(def.parameters)), metadata.parameters, `${type} C++ metadata/UI agreement`);
  assert.deepEqual(Array.from(def.outputs), metadata.outputs);
  assert.equal(def.displayType, "scope1dTrace");
  const defaults = Object.fromEntries(metadata.parameters.map(p => [p.key, Number(p.defaultValue)]));
  modules[type] = { x, prefix, defaults, order,
    create: x[prefix + "create"], destroy: x[prefix + "destroy"], reset: x[prefix + "reset"],
    tick(h, l, r, p = {}, rate = sr) {
      const params = { ...defaults, ...p };
      if (type === "stftGate") x[prefix + "set_knee"](h, params.kneeDb);
      return x[prefix + "sample"](h, l, r, ...order.map(k => params[k]), rate);
    }, right: x[prefix + "right"] };
  assert.equal(x[prefix + "latency"](), 1024);
}
const c = modules.stftContrast, g = modules.stftGate;
const neutral = { contrast: 0, ratio: 1, gainDb: 0 };
const tone = (hz, i) => Math.sin(2 * Math.PI * hz * i / sr);
function render(m, p, signal, length = 16384, h = m.create()) {
  const out = new Float64Array(length);
  for (let i = 0; i < length; ++i) {
    const v = signal(i); out[i] = m.tick(h, v, v * 0.25, p);
    assert.ok(Number.isFinite(out[i]) && Number.isFinite(m.right(h)));
    assert.ok(Math.abs(m.right(h) - 0.25 * out[i]) < 1e-5, "stereo-linked gains preserve channel ratios");
  }
  return { out, h };
}
const rms = a => Math.sqrt(a.reduce((sum, v) => sum + v * v, 0) / a.length);
for (const [m, p] of [[c, neutral], [g, { depthDb: 0 }], [g, { profileMode: 2 }]]) {
  const signal = i => i === 0 ? 2 : 0.2 + tone(750, i) + 0.3 * tone(6000, i) + (i % 2 ? -0.1 : 0.1);
  const { out, h } = render(m, p, signal);
  let error = 0;
  for (let i = 0; i < out.length; ++i) error = Math.max(error, Math.abs(out[i] - (i >= 1024 ? signal(i - 1024) : 0)));
  assert.ok(error < 2e-6, `neutral reconstruction, DC, Nyquist and latency: ${error}`);
  m.destroy(h);
}
for (const m of [c, g]) {
  const { out, h } = render(m, {}, () => 0, 4096);
  assert.ok(out.every(v => v === 0)); m.destroy(h);
}
const ratios = [];
for (const amount of [-0.5, 0, 0.5]) {
  const { out, h } = render(c, { ...neutral, contrast: amount, scale: 0.2, attackMs: 0, releaseMs: 0, maxBoostDb: 36 },
    i => tone(750, i) + 0.05 * tone(6000, i));
  function magnitude(hz) {
    let re = 0, im = 0;
    for (let i = 8192; i < out.length; ++i) { re += out[i] * Math.cos(2 * Math.PI * hz * i / sr); im += out[i] * Math.sin(2 * Math.PI * hz * i / sr); }
    return Math.hypot(re, im);
  }
  ratios.push(magnitude(750) / magnitude(6000)); c.destroy(h);
}
assert.ok(ratios[0] < 10 && Math.abs(ratios[1] - 20) < 0.01 && ratios[2] > 40, `contrast directions: ${ratios}`);
const levels = [];
for (const amplitude of [1, 10]) {
  const { out, h } = render(c, { ...neutral, ratio: 4, thresholdDb: -50, attackMs: 0, releaseMs: 0, scale: 0.5 }, i => amplitude * tone(750, i));
  levels.push(rms(out.slice(8192))); c.destroy(h);
}
assert.ok(Math.abs(levels[1] / levels[0] - Math.pow(10, 0.25)) < 0.03, "4:1 compression slope above threshold");
const invariant = [];
for (const amplitude of [1, 3]) {
  const { out, h } = render(c, { ...neutral, contrast: -0.5, attackMs: 0, releaseMs: 0 }, i => amplitude * (tone(750, i) + 0.05 * tone(6000, i)));
  invariant.push(out); c.destroy(h);
}
assert.ok(invariant[0].every((v, i) => Math.abs(3 * v - invariant[1][i]) < 1e-5), "relative contrast does not change with input level");
for (const amplitude of [0.001, 0.5]) {
  const { out, h } = render(g, { thresholdDb: -45, attackMs: 0, releaseMs: 0, smooth: 0 }, i => amplitude * tone(750, i));
  const ratio = rms(out.slice(8192)) / (amplitude / Math.sqrt(2));
  assert.ok(amplitude < 0.01 ? ratio < 0.002 : ratio > 0.99, `manual gate ${amplitude}: ${ratio}`); g.destroy(h);
}
const kneeRatios = [];
for (const kneeDb of [0, 6, 24]) {
  const levels = [];
  for (const offset of [-0.1, 0.1]) {
    const id = g.create(), samples = [];
    // A bin-centered unit sine has center-bin one-sided power 1/3.
    const thresholdDb = 10 * Math.log10(1 / 3) + offset;
    for (let i = 0; i < 16384; ++i) {
      const v = tone(750, i);
      const y = g.tick(id, v, v, { kneeDb, thresholdDb, depthDb: 60, attackMs: 0, releaseMs: 0, smooth: 0 });
      if (i >= 8192) samples.push(y);
    }
    levels.push(rms(samples)); g.destroy(id);
  }
  kneeRatios.push(levels[0] / levels[1]);
}
assert.ok(kneeRatios[0] > 500, `zero-knee harmonic pop-in must be abrupt: ${kneeRatios}`);
assert.ok(kneeRatios[1] < 2 && kneeRatios[2] < kneeRatios[1], "wide knees retain progressive opening");
console.log(`Gate Knee: 0/6/24 dB near-threshold amplitude ratios ${kneeRatios.map(v => v.toFixed(2))} pass.`);
let seed = 1;
function noise() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed / 0x100000000 - 0.5) * 0.01; }
const gh = g.create();
assert.equal(g.x.soemdsp_stft_gate_ready(gh), 0);
for (let i = 0; i < sr; ++i) { const v = noise(); g.tick(gh, v, v, { profileMode: 1 }); }
assert.equal(g.x.soemdsp_stft_gate_ready(gh), 1);
const frames = g.x.soemdsp_stft_gate_profile_frames(gh);
assert.ok(frames > 100);
let inputPower = 0, outputPower = 0;
for (let i = 0; i < sr; ++i) {
  const v = noise(), y = g.tick(gh, v, v, { profileMode: 2, marginDb: 9, attackMs: 0, releaseMs: 0 });
  if (i > 4096) { inputPower += v * v; outputPower += y * y; }
}
assert.equal(g.x.soemdsp_stft_gate_profile_frames(gh), frames, "Use Profile freezes learning");
const noiseReductionDb = 10 * Math.log10(outputPower / inputPower);
assert.ok(noiseReductionDb < -12, `learned broadband noise reduction: ${noiseReductionDb}`);
let wantedPower = 0;
for (let i = 0; i < sr / 2; ++i) {
  const v = 0.4 * tone(750, i) + noise();
  const y = g.tick(gh, v, v, { profileMode: 2, marginDb: 3, attackMs: 0, releaseMs: 0 });
  if (i > 4096) wantedPower += y * y;
}
assert.ok(Math.sqrt(wantedPower / (sr / 2 - 4097)) > 0.15, "wanted tone survives learned gate");
g.reset(gh); assert.equal(g.x.soemdsp_stft_gate_ready(gh), 1, "signal reset retains a frozen profile");
g.tick(gh, 0, 0, { profileMode: 1 });
assert.equal(g.x.soemdsp_stft_gate_ready(gh), 0, "a new Learn clears the old profile");
for (let i = 0; i < 512; ++i) g.tick(gh, 0.01, 0.01, { profileMode: 1 });
assert.equal(g.x.soemdsp_stft_gate_ready(gh), 0, "Learn waits for a full fresh window");
for (let i = 0; i < 1024; ++i) g.tick(gh, 0.01, 0.01, { profileMode: 1 });
assert.equal(g.x.soemdsp_stft_gate_ready(gh), 1);
g.tick(gh, 0, 0, { profileMode: 2 }); g.reset(gh);
g.tick(gh, 0, 0, { profileMode: 2 }, 44100);
assert.equal(g.x.soemdsp_stft_gate_ready(gh), 0, "sample-rate change invalidates even a retained profile");
g.destroy(gh);
for (const m of [c, g]) {
  for (const rate of [8000, 44100, 96000]) {
    const id = m.create();
    for (let i = 0; i < 4096; ++i) {
      const y = m.tick(id, Math.sin(i * 0.17), -Math.sin(i * 0.17), m === c ? neutral : { depthDb: 0 }, rate);
      assert.ok(Math.abs(y - (i >= 1024 ? Math.sin((i - 1024) * 0.17) : 0)) < 2e-6, "sample-rate-independent neutral timing");
    }
    m.destroy(id);
  }
  const h = m.create(); assert.equal(m.tick(h, NaN, 0), 0);
  assert.equal(m.tick(h, 1e100, 0), 0, "unrepresentable FFT input recovers without contaminating state");
  for (let i = 0; i < 4096; ++i) assert.equal(m.tick(h, 0, 0), 0);
  m.destroy(h);
  const handles = Array.from({ length: 64 }, m.create);
  assert.equal(new Set(handles).size, 64); assert.ok(handles.every(Boolean)); assert.equal(m.create(), 0);
  handles.forEach(m.destroy);
}
console.log(`STFT dynamics: neutral reconstruction/latency/stereo, contrast ratios ${ratios.map(v => v.toFixed(2))}, 4:1 slope, level independence, manual gate, learned noise ${noiseReductionDb.toFixed(1)} dB, wanted tone, profiles, recovery and pool reuse pass.`);
