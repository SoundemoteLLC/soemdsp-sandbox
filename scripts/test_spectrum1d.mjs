// 1D Spectrum: shared analysis core, worklet analysis and face columns.
// Run: node scripts/test_spectrum1d.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const ctx = vm.createContext({ Math, Float32Array, Float64Array, Uint32Array, Map, Number, String, Object, Array, Set, console });
vm.runInContext(`
function nodeGraphFiniteNumber(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
class NodeLiveAudioProcessor {}
var sampleRate = 48000;
`, ctx);
vm.runInContext(read('public/lib/spectral-analysis.js'), ctx);
const curveSrc = read('public/modules/spectrogram/spectrogram-display.js').match(/function nodeGraphFrequencyCurveHz[\s\S]*?\n}\n/)[0];
vm.runInContext(curveSrc, ctx);
vm.runInContext(read('public/modules/spectrogram/spectrogram-worklet-evaluator.js'), ctx);
vm.runInContext(read('public/modules/spectrum1d/spectrum1d-display.js'), ctx);
const G = (name) => vm.runInContext(name, ctx);

let passed = 0;
const ok = (name, cond, detail = '') => { assert.ok(cond, `${name} ${detail}`); passed += 1; console.log(`ok   ${name} ${detail}`); };

// --- Shared core ---------------------------------------------------------
{
  const n = 64, re = new Float64Array(n), im = new Float64Array(n);
  const x = Array.from({ length: n }, (_, i) => Math.sin(i * 0.37) + 0.3 * Math.cos(i * 1.9));
  x.forEach((v, i) => { re[i] = v; });
  G('nodeGraphSpectralFftInPlace')(re, im);
  let err = 0;
  for (let k = 0; k < n; k++) {
    let sr = 0, si = 0;
    for (let t = 0; t < n; t++) { sr += x[t] * Math.cos(-2 * Math.PI * k * t / n); si += x[t] * Math.sin(-2 * Math.PI * k * t / n); }
    err = Math.max(err, Math.abs(sr - re[k]), Math.abs(si - im[k]));
  }
  ok('FFT matches a direct DFT', err < 1e-9, `max error ${err.toExponential(2)}`);
  const hann = G('nodeGraphSpectralWindow')(2048, 1);
  ok('Hann coherent gain', Math.abs(hann.sum - 1023.5) < 1e-6, String(hann.sum));
  ok('windows are cached', G('nodeGraphSpectralWindow')(2048, 1) === hann);
}

// --- Worklet analysis -------------------------------------------------------
const SR = 48000;
function makeAnalyser(type, params) {
  const proc = new (G('NodeLiveAudioProcessor'))();
  proc.engineSampleRate = SR;
  const cap = 1 << 16;
  const buf = { buffer: new Float32Array(cap), capacity: cap, writeIndex: 0, absoluteFrame: 0, writeSampleRate: SR };
  proc.visualInputBuffers = new Map([['n:In', buf]]);
  proc.nodes = new Map([['n', { type, params }]]);
  const state = proc.createSpectrogramState();
  const latest = {};
  let analyses = 0;
  // Feed `seconds` of signal in 128-sample quanta, as the worklet does.
  const run = (seconds, signal) => {
    const total = Math.round(seconds * SR);
    for (let done = 0; done < total; done += 128) {
      for (let i = 0; i < 128; i++) {
        buf.buffer[buf.writeIndex] = signal(buf.absoluteFrame + i);
        buf.writeIndex = (buf.writeIndex + 1) % cap;
      }
      buf.absoluteFrame += 128;
      const ports = [];
      proc.spectrogramCollectDisplayData('n', state, ports);
      for (const [, port, value] of ports) { latest[port] = value; if (port === 'SpectrumRaw') analyses += 1; }
    }
  };
  return { run, latest, state, analyses: () => analyses };
}
const sine = (hz, amp = 1) => (t) => amp * Math.sin(2 * Math.PI * hz * t / SR);
const params1d = (extra = {}) => ({ fftSize: 2048, window: 1, overlap: 2, freqOverlap: 0, bassDetail: 1, ...extra });
const settings = (extra = {}) => ({ minFreq: 20, maxFreq: 20000, frequencyCurve: 1, spectrumDbMode: 'exactDb', spectrumDbFloor: -96, spectrumDbCeiling: 0, ...extra });
const columns = (a, s, W = 800, withLow = true) => {
  const meta = a.latest.FftSize;
  const low = withLow && a.latest.SpectrumLowRaw ? { raw: a.latest.SpectrumLowRaw, windowSum: a.latest.SpectrumLowMeta[1] } : null;
  return G('nodeGraphSpectrumLineComputeColumns')(W, { raw: a.latest.SpectrumRaw, windowSum: a.latest.SpectrumGain[0], sampleRate: meta[4], low }, s);
};
const argmax = (c) => c.reduce((b, v, i) => (v > c[b] ? i : b), 0);
const toDb = (v, s) => s.spectrumDbFloor + v * (s.spectrumDbCeiling - s.spectrumDbFloor);
const xForHz = (hz, s, W) => {
  const lo = s.minFreq, hi = s.maxFreq;
  if (s.frequencyCurve === 0) return (hz - lo) / (hi - lo) * (W - 1);
  return Math.log(hz / lo) / Math.log(hi / lo) * (W - 1);
};

{
  const binHz = SR / 2048;
  const hz = 43 * binHz; // centred on bin 43, about 1008 Hz
  const a = makeAnalyser('spectrum1d', params1d());
  a.run(1, sine(hz));
  ok('1D Spectrum posts no compressed Spectrum column', !('Spectrum' in a.latest) && !('SpectrumBatch' in a.latest));
  const s = settings();
  const c = columns(a, s);
  const peak = argmax(c);
  ok('0 dBFS bin-centred sine peaks at 0 dBFS', Math.abs(toDb(c[peak], s)) < 0.05, `${toDb(c[peak], s).toFixed(3)} dB`);
  ok('log axis puts it at the right x', Math.abs(peak - xForHz(hz, s, 800)) <= 1, `x ${peak} vs ${xForHz(hz, s, 800).toFixed(1)}`);
  const lin = settings({ frequencyCurve: 0 });
  const cl = columns(a, lin);
  ok('linear axis puts it at the right x', Math.abs(argmax(cl) - xForHz(hz, lin, 800)) <= 1, `x ${argmax(cl)} vs ${xForHz(hz, lin, 800).toFixed(1)}`);
  ok('analysis rate stays at or under 60 per second', a.analyses() <= 61, `${a.analyses()} in 1 s`);

  const off = makeAnalyser('spectrum1d', params1d());
  off.run(1, sine(43.5 * binHz));
  const co = columns(off, s);
  ok('worst-case off-bin sine stays within Hann scalloping (1.5 dB)', toDb(co[argmax(co)], s) > -1.5, `${toDb(co[argmax(co)], s).toFixed(2)} dB`);

  const moved = columns(a, settings({ spectrumDbFloor: -60, spectrumDbCeiling: -20 }));
  ok('Ceiling below the signal marks over-range (> 1), no fake clip', moved[peak] > 1, moved[peak].toFixed(3));
  const loud = makeAnalyser('spectrum1d', params1d());
  loud.run(1, sine(hz, 2));
  const cLoud = columns(loud, s);
  ok('+6 dBFS sine reads +6 dB above the 0 dB Ceiling', Math.abs(toDb(cLoud[argmax(cLoud)], s) - 6.02) < 0.05, toDb(cLoud[argmax(cLoud)], s).toFixed(2));
  const half = columns(a, settings({ spectrumDbFloor: -40, spectrumDbCeiling: 40 }));
  ok('Floor / Ceiling are continuous (0 dB sits half way in -40..40)', Math.abs(half[peak] - 0.5) < 0.002, half[peak].toFixed(4));
  const linear = columns(a, settings({ spectrumDbMode: 'linear' }));
  ok('Linear scale: full-scale sine at the top', Math.abs(linear[argmax(linear)] - 1) < 0.01, linear[argmax(linear)].toFixed(4));
}

{
  // Bass detail: 40 Hz and 80 Hz together must separate at a glance.
  const s = settings({ minFreq: 20, maxFreq: 400 });
  const both = (t) => sine(40)(t) + sine(80)(t);
  const between = (c) => {
    const x40 = Math.round(xForHz(40, s, 800)), x80 = Math.round(xForHz(80, s, 800));
    const dip = Math.min(...c.slice(x40, x80 + 1));
    return toDb(Math.min(c[x40], c[x80]), s) - toDb(dip, s);
  };
  const on = makeAnalyser('spectrum1d', params1d());
  on.run(1.5, both);
  ok('Bass detail posts the 8192-sample spectrum', on.latest.SpectrumLowMeta?.[0] === 8192, String(on.latest.SpectrumLowMeta?.[0]));
  const dipOn = between(columns(on, s));
  const offA = makeAnalyser('spectrum1d', params1d({ bassDetail: 0 }));
  offA.run(1.5, both);
  ok('Bass detail Off posts no long-window spectrum', !('SpectrumLowRaw' in offA.latest));
  const dipOff = between(columns(offA, s, 800, false));
  ok('40 Hz and 80 Hz separate with Bass detail (dip >= 30 dB)', dipOn >= 30, `dip ${dipOn.toFixed(1)} dB (off: ${dipOff.toFixed(1)} dB)`);
  ok('Bass detail is clearly better than the FFT size alone', dipOn > dipOff + 15, `${dipOn.toFixed(1)} vs ${dipOff.toFixed(1)} dB`);
  const cOn = columns(on, s);
  const x40 = Math.round(xForHz(40, s, 800));
  ok('Bass detail keeps 0 dBFS calibration at 40 Hz', Math.abs(toDb(Math.max(...cOn.slice(x40 - 2, x40 + 3)), s)) < 1.5, toDb(Math.max(...cOn.slice(x40 - 2, x40 + 3)), s).toFixed(2));
  const big = makeAnalyser('spectrum1d', params1d({ fftSize: 16384 }));
  big.run(1, both);
  ok('no second FFT when the window is already at the 16384 cap', !('SpectrumLowRaw' in big.latest));
}

{
  const a = makeAnalyser('spectrum1d', params1d());
  a.run(0.5, () => 0);
  const c = columns(a, settings());
  ok('silence: no NaN, sits on the Floor', c.every((v) => Number.isFinite(v) && v === 0));
  const serial0 = a.latest.FftSize[5];
  a.run(0.1, sine(1000));
  ok('hopSerial advances with new analyses (paint is hop driven)', a.latest.FftSize[5] > serial0);
}

{
  // Spectrogram path is unchanged in shape: compressed columns + batch.
  const a = makeAnalyser('spectrogram', { fftSize: 1024, window: 1, overlap: 2, freqOverlap: 0 });
  a.run(0.5, sine(1000));
  ok('Spectrogram still gets Spectrum + SpectrumBatch', a.latest.Spectrum?.length === 512 && a.latest.SpectrumBatch?.length % 512 === 0);
  ok('Spectrogram FftSize carries the window sum', Math.abs(a.latest.FftSize[7] - G('nodeGraphSpectralWindow')(1024, 1).sum) < 1e-3);
}

{
  // Peak envelope: Fall at 12 dB/s over a 96 dB span drops 1/8 per second.
  const st = { peak: new Float32Array([1]), holdUntil: new Float64Array(1) };
  G('nodeGraphSpectrumLineUpdatePeaks')(st, new Float32Array([0]), 'fall', 0, 1, 12 / 96);
  ok('Peak Fall uses dB per second', Math.abs(st.peak[0] - 0.875) < 1e-6, String(st.peak[0]));
  const hold = { peak: new Float32Array([0]), holdUntil: new Float64Array(1) };
  G('nodeGraphSpectrumLineUpdatePeaks')(hold, new Float32Array([1.4]), 'hold', 0, 0, 0.1);
  ok('held peak never goes above the top', hold.peak[0] === 1);
  G('nodeGraphSpectrumLineUpdatePeaks')(hold, new Float32Array([0]), 'hold', 100, 0.1, 0.1);
  ok('Hold keeps the peak for 0.5 s', hold.peak[0] === 1);
  const sm = {};
  G('nodeGraphSpectrumLineSmoothColumns')(sm, new Float32Array([0]), 100, 0);
  const out = G('nodeGraphSpectrumLineSmoothColumns')(sm, new Float32Array([1]), 100, 0.1);
  ok('Smooth (ms) is a time constant', Math.abs(out[0] - (1 - Math.exp(-1))) < 1e-6, out[0].toFixed(4));
}

console.log(`all ${passed} 1D Spectrum checks passed`);
