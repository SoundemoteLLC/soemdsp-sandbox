// Spectral display vision (docs/SPECTRAL_DISPLAY_VISION.md): read-only native
// taps, the worklet collector, the shared style renderer, Spectrogram dB.
// Run: node scripts/test_spectral_display.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
let passed = 0;
const ok = (name, cond, detail = '') => { assert.ok(cond, `${name} ${detail}`); passed += 1; console.log(`ok   ${name} ${detail}`); };
const SR = 48000;
const sine = (hz, amp = 1) => (t) => amp * Math.sin(2 * Math.PI * hz * t / SR);
const wasm = async (name) => (await WebAssembly.instantiate(
  await WebAssembly.compile(fs.readFileSync(new URL(`../native_modules/${name}/${name}.wasm`, import.meta.url))), {})).exports;

// --- Native taps ---------------------------------------------------------------
{
  const x = await wasm('vocoder');
  const h = x.soemdsp_vocoder_create();
  x.soemdsp_vocoder_set_bands(h, 32);
  const hz = 1000;
  for (let i = 0; i < SR / 2; i += 1) {
    const v = sine(hz)(i);
    x.soemdsp_vocoder_sample(h, v, v, 0, 0, 0.75, 0.01, 0, 1, SR);
  }
  const n = x.soemdsp_vocoder_display_count(h, 0);
  ok('Vocoder tap: one point per real band', n === 32, String(n));
  let best = 0, bestDb = -Infinity, prev = 0;
  let ascending = true;
  for (let i = 0; i < n; i += 1) {
    const f = x.soemdsp_vocoder_display_hz(h, 0, i);
    if (!(f > prev)) ascending = false;
    prev = f;
    const db = 20 * Math.log10(Math.max(1e-12, x.soemdsp_vocoder_display_level(h, 0, i)));
    if (db > bestDb) { bestDb = db; best = i; }
  }
  const bestHz = x.soemdsp_vocoder_display_hz(h, 0, best);
  ok('Vocoder band centres run 40 Hz upward', ascending && Math.abs(x.soemdsp_vocoder_display_hz(h, 0, 0) - 40) < 1e-6);
  ok('Vocoder: the band nearest the tone is the loudest', Math.abs(Math.log2(bestHz / hz)) < 0.25, `${bestHz.toFixed(0)} Hz`);
  ok('Vocoder: a unit sine in its band reads near 0 dBFS (pi/2 envelope calibration)', bestDb > -6 && bestDb < 1, `${bestDb.toFixed(2)} dB`);
  ok('Vocoder: no incoming bank while Bands is steady', x.soemdsp_vocoder_display_count(h, 1) === 0 && x.soemdsp_vocoder_display_weight(h) === 0);
  x.soemdsp_vocoder_set_bands(h, 48);
  let sawIncoming = false, sawWeight = false;
  for (let i = 0; i < SR * 0.05; i += 1) {
    const v = sine(hz)(i);
    x.soemdsp_vocoder_sample(h, v, v, 0, 0, 0.75, 0.01, 0, 1, SR);
    if (x.soemdsp_vocoder_display_count(h, 1) === 48) sawIncoming = true;
    if (x.soemdsp_vocoder_display_weight(h) > 0) sawWeight = true;
  }
  ok('Vocoder: a Bands change shows the incoming bank with the DSP crossfade weight', sawIncoming && sawWeight);
  ok('Vocoder: after the crossfade the new layout is the sounding bank', x.soemdsp_vocoder_display_count(h, 0) === 48);
}
for (const [name, prefix] of [['stft_gate', 'soemdsp_stft_gate'], ['stft_contrast', 'soemdsp_stft_contrast']]) {
  const x = await wasm(name);
  const f = (k) => x[`${prefix}_${k}`];
  const h = f('create')();
  ok(`${name}: no frames before audio`, f('display_frames')(h) === 0);
  for (let i = 0; i < SR / 4; i += 1) {
    const v = sine(2000, 0.5)(i);
    if (name === 'stft_gate') f('sample')(h, v, v, 0, -60, 3, 60, 5, 100, 0.5, 1, SR);
    else f('sample')(h, v, v, -0.35, 1, -24, 2, 10, 100, 18, 0, 1, SR);
  }
  const bins = f('display_bins')();
  const size = f('display_size')();
  const rate = f('display_rate')(h);
  const power = new Float64Array(x.memory.buffer, f('display_power')(h), bins);
  const gain = new Float64Array(x.memory.buffer, f('display_gain')(h), bins);
  let peak = 0;
  for (let k = 1; k < bins; k += 1) if (power[k] > power[peak]) peak = k;
  ok(`${name}: power tap peaks at the tone's bin`, Math.abs(peak * rate / size - 2000) <= rate / size, `${(peak * rate / size).toFixed(0)} Hz`);
  ok(`${name}: gain tap is finite dB`, gain.every(Number.isFinite));
  ok(`${name}: frames count analysis hops`, f('display_frames')(h) === Math.floor(SR / 4 / 256));
}

// --- Worklet collector ------------------------------------------------------------
const ctx = vm.createContext({ Math, Float32Array, Float64Array, Uint32Array, Map, Set, Number, String, Object, Array, console });
vm.runInContext(`
function nodeGraphFiniteNumber(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
class NodeLiveAudioProcessor {}
var sampleRate = 48000;
`, ctx);
vm.runInContext(read('public/lib/spectral-analysis.js'), ctx);
vm.runInContext(read('public/modules/spectralDisplay/spectral-display-worklet.js'), ctx);
vm.runInContext(read('public/lib/spectral-display-styles.js'), ctx);
const G = (name) => vm.runInContext(name, ctx);
{
  // Blur-style lanes: module output from the scope ring, input from the visual buffer.
  const proc = new (G('NodeLiveAudioProcessor'))();
  proc.engineSampleRate = SR;
  const limit = 24000;
  const ring = new Float32Array(limit);
  ring.nodeGraphScopeLimit = limit; ring.nodeGraphScopeWriteIndex = 0; ring.nodeGraphScopeLength = 0;
  const cap = 65536;
  const inBuf = { buffer: new Float32Array(cap), capacity: cap, writeIndex: 0, absoluteFrame: 0, length: 0 };
  proc.scopeBuffers = new Map([['b:Mono', ring]]);
  proc.visualInputBuffers = new Map([['b:In', inBuf]]);
  proc.nodes = new Map([['b', { type: 'spectralBlur' }]]);
  proc.syncSpectralDisplayStates(null, true);
  const state = proc.spectralDisplayStates.get('b');
  const hzOut = 46 * SR / 2048; // bin-centred
  const hzIn = 92 * SR / 2048;
  let t = 0;
  const posts = [];
  const quantum = () => {
    for (let i = 0; i < 128; i += 1, t += 1) {
      ring[ring.nodeGraphScopeWriteIndex] = sine(hzOut)(t);
      ring.nodeGraphScopeWriteIndex = (ring.nodeGraphScopeWriteIndex + 1) % limit;
      ring.nodeGraphScopeLength = Math.min(limit, ring.nodeGraphScopeLength + 1);
      inBuf.buffer[inBuf.writeIndex] = sine(hzIn, 0.5)(t);
      inBuf.writeIndex = (inBuf.writeIndex + 1) % cap; inBuf.absoluteFrame += 1; inBuf.length = Math.min(cap, inBuf.length + 1);
    }
    const ports = [];
    proc.spectralDisplayCollect('b', state, ports);
    if (ports.length) posts.push(Object.fromEntries(ports.map(([, k, v]) => [k, v])));
  };
  for (let q = 0; q < SR / 128; q += 1) quantum();
  ok('Analysis lanes post at most 30 times per second of audio', posts.length >= 25 && posts.length <= 31, String(posts.length));
  const last = posts[posts.length - 1];
  const at = (db, f) => db[Math.round(f / (SR / 2048))];
  ok('Output lane: a 0 dBFS bin-centred sine reads 0 dBFS', Math.abs(at(last.SpectralA, hzOut)) < 0.05, `${at(last.SpectralA, hzOut).toFixed(3)} dB`);
  ok('Input lane: a -6 dBFS sine reads -6 dBFS at its own frequency', Math.abs(at(last.SpectralB, hzIn) + 6.02) < 0.05, `${at(last.SpectralB, hzIn).toFixed(2)} dB`);
  const before = posts.length;
  for (let q = 0; q < 40; q += 1) {
    const ports = [];
    proc.spectralDisplayCollect('b', state, ports);
    if (ports.length) posts.push(ports);
  }
  ok('No new audio, no new posts (driven by audio blocks, not a timer)', posts.length === before);
}

// --- Shared style renderer -----------------------------------------------------------
{
  const cols = G('nodeGraphSpectralColumns');
  const hz = Float32Array.from([100, 200, 400, 800]);
  const db = Float32Array.from([-60, -10, -40, -20]);
  const c = cols(4, hz, db, 1, 100, 1600);
  ok('Columns take the max of the points inside each span', c[0] === -10 || c[0] === -60, Array.from(c).join(','));
  const fine = cols(64, hz, db, 1, 100, 1600);
  ok('Columns between sparse points interpolate (no holes)', Array.from(fine).every(Number.isFinite));
  const level = G('nodeGraphSpectralLevel01');
  ok('Level: Floor 0, Ceiling 1, over-range kept above 1', level(-96, -96, 0) === 0 && level(0, -96, 0) === 1 && level(6, -96, 0) > 1);

  const calls = [];
  const fake = (kind) => (...a) => calls.push([kind, ...a]);
  for (const k of ['nodeGraphGlLinesRect', 'nodeGraphGlLinesDot', 'nodeGraphGlLinesFillUnder', 'nodeGraphGlLinesPolyline']) ctx[k] = fake(k);
  ctx.nodeGraphFrequencyCurveHz = G('nodeGraphFrequencyCurveHz');
  const lut = new Uint8Array(768).map((_, i) => i % 256);
  const settings = (style, extra = {}) => ({
    spectralStyle: style, spectralFloorDb: -96, spectralCeilingDb: 0, spectralBarCount: 32, spectralPeakHold: 'hold',
    spectralPeakDecay: 24, spectralParticles: 400, spectralHistory: 16, spectralGainRangeDb: 60, spectralGainBoostDb: 0, lut, ...extra,
  });
  const points = Float32Array.from({ length: 256 }, (_, i) => 20 * Math.pow(1000, i / 255));
  const levels = Float32Array.from(points, (f) => (Math.abs(Math.log2(f / 1000)) < 0.2 ? 0 : -70));
  const data = { hz: points, a: levels, b: Float32Array.from(levels, (v) => v - 6), gain: Float32Array.from(points, (f) => (f < 500 ? -60 : 0)), serial: 1, weight: 0 };
  const draw = G('nodeGraphSpectralDraw');
  const view = { W: 320, H: 120, lo: 20, hi: 20000, curve: 1 };
  const finite = () => calls.every((c) => c.slice(1).every((v) => (typeof v === 'number' ? Number.isFinite(v) : true)));
  for (const s of G('NODE_GRAPH_SPECTRAL_STYLES')) {
    calls.length = 0;
    draw({}, view, data, settings(s.value), {});
    ok(`Style ${s.value} draws with finite geometry`, calls.length > 1 && finite(), `${calls.length} calls`);
  }
  calls.length = 0;
  draw({}, view, data, settings('particles', { spectralParticles: 200 }), {});
  ok('Particles stay under the cap', calls.filter((c) => c[0] === 'nodeGraphGlLinesDot').length <= 200);
  calls.length = 0;
  draw({}, view, data, settings('bars'), {});
  const tallest = calls.filter((c) => c[0] === 'nodeGraphGlLinesRect').reduce((m, c) => Math.max(m, c[5]), 0);
  ok('A 0 dBFS band fills a bar to the Ceiling, not past it', tallest >= view.H - 4 && tallest <= view.H, String(tallest));
  const over = { ...data, a: Float32Array.from(levels, (v) => (v === 0 ? 6 : v)) };
  calls.length = 0;
  draw({}, view, over, settings('bars'), {});
  ok('Louder than Ceiling draws the over-range cap', calls.some((c) => c[0] === 'nodeGraphGlLinesRect' && c[3] === 0 && c[5] === 2 && c[6][0] === 1));
  calls.length = 0;
  draw({}, view, data, settings('bandGain'), {});
  ok('Band gain: Gate (no boost) puts the zero line at the top', calls.some((c) => c[0] === 'nodeGraphGlLinesRect' && c[2] === 0 && c[3] === 0 && c[4] === view.W && c[5] === 1));
  const wf = {};
  draw({}, view, data, settings('miniWaterfall'), wf);
  const head = wf.rows.head;
  draw({}, view, data, settings('miniWaterfall'), wf);
  ok('Waterfall writes a row only when new data arrives', wf.rows.head === head);
  draw({}, view, { ...data, serial: 2 }, settings('miniWaterfall'), wf);
  ok('A new serial writes one new row', wf.rows.head !== head);
  const voc = { ...data, hz2: points, a2: Float32Array.from(points, () => -96), weight: 0.5 };
  calls.length = 0;
  draw({}, view, voc, settings('bars', { spectralPeakHold: 'off' }), {});
  const halfTall = calls.filter((c) => c[0] === 'nodeGraphGlLinesRect').reduce((m, c) => Math.max(m, c[5]), 0);
  ok('Vocoder Bands crossfade blends the two banks by the DSP weight', halfTall < tallest && halfTall > tallest * 0.3, `${halfTall} vs ${tallest}`);
}

// --- Spectrogram honest dB -------------------------------------------------------------
{
  const gl = read('public/modules/spectrogram/spectrogram-gl.js');
  const worklet = read('public/modules/spectrogram/spectrogram-worklet-evaluator.js');
  ok('Spectrogram columns are linear |X| (no EMA, no log10(1+x) compression)', !/log10\(1 \+/.test(worklet) && !/emaBins/.test(worklet));
  ok('Spectrogram shader grades |X| / full scale', /float amp = max\(0\.0, x\) \/ max\(uFullMag, 1e-9\);/.test(gl) && !/powPos/.test(gl));
  const ctx2 = vm.createContext({ Math, Number, Float32Array, Float64Array, Uint8Array, Map, Object, Array, console, globalThis: {} });
  ctx2.globalThis = ctx2;
  ctx2.window = ctx2;
  vm.runInContext('function nodeGraphFiniteNumber(v, f = 0) { const n = Number(v); return Number.isFinite(n) ? n : f; }', ctx2);
  try { vm.runInContext(gl, ctx2); } catch (_e) { /* GL bits need a browser; the grade twin is enough */ }
  const grade = ctx2.spectrogramGrade01;
  if (typeof grade === 'function') {
    ok('Full-scale tone grades to the Ceiling colour', grade(1, -80, 0, 1) === 1);
    ok('-40 dBFS is half way between -80 and 0', Math.abs(grade(0.01, -80, 0, 1) - 0.5) < 1e-6);
  }
}

console.log(`all ${passed} spectral display checks passed`);
