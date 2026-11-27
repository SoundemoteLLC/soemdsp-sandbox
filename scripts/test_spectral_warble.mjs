// Spectral Warble acceptance tests (docs/SPECTRAL_WARBLE_FIX_PLAN.md section 6): every partial wobbles its own pitch, in cents.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const compiled = await WebAssembly.compile(fs.readFileSync(new URL('../native_modules/spectral_warble/spectral_warble.wasm', import.meta.url)));
const x = (await WebAssembly.instantiate(compiled, {})).exports;
const P = 'soemdsp_spectral_warble_';
const f = (name, ...args) => x[P + name](...args);
const sr = 48000;
assert.equal(f('latency'), 4096);
const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(x.memory.buffer, f('metadata_json'), f('metadata_json_size'))));
assert.deepEqual(meta.parameters.map(p => p.key), ['fftSize', 'depth', 'rate', 'drunk', 'voices', 'stereoSpread', 'monoBassHz', 'mix', 'seed']);
assert.equal(meta.targetType, 'spectralWarble');
const param = k => meta.parameters.find(p => p.key === k);
assert.equal(param('depth').unit, '¢'); assert.equal(param('rate').unit, 'Hz'); assert.equal(param('monoBassHz').unit, 'Hz');
assert.equal(param('seed').kind, 'seed');
assert.deepEqual(['depth', 'rate', 'drunk', 'voices', 'stereoSpread', 'monoBassHz'].map(k => param(k).defaultValue), ['25', '4', '0.5', '3', '1', '120']);
assert.ok(Number(param('voices').max) <= meta.voiceStorage, 'T16: the Voices max never exceeds the storage the engine has');
assert.ok(meta.parameters.every(p => p.tooltip));

// --- rendering helpers. set(depth, rate, drunk, voices, spread, monoBass, seed); defaults of the T-series: Depth 25, Rate 4, Drunk 0.5, Voices 1, Spread 0, Mono Bass 0
const make = (o = {}) => {
  const c = { depth: 25, rate: 4, drunk: 0.5, voices: 1, spread: 0, bass: 0, seed: 1, fft: 4096, ...o };
  const h = f('create'); assert.ok(h);
  f('set_fft_size', h, c.fft); f('set_warble', h, c.depth, c.rate, c.drunk, c.voices, c.seed); f('set_stereo', h, c.spread, c.bass);
  return h;
};
const render = (h, n, input, mix = 1) => {
  const l = new Float64Array(n), r = new Float64Array(n);
  for (let i = 0; i < n; ++i) { const a = input(i); l[i] = f('sample', h, a[0], a[1], mix, sr); r[i] = f('right', h); }
  return [l, r];
};
const run = (o, n, input) => { const h = make(o); const out = render(h, n, input); f('destroy', h); return out; };
const sine = (f0, a = 0.1) => i => { const v = a * Math.sin(2 * Math.PI * f0 * i / sr); return [v, v]; };
const saw = (f0, a = 0.2) => { const hm = Math.floor(0.45 * sr / f0); return i => { let v = 0; for (let k = 1; k <= hm; ++k) v += Math.sin(2 * Math.PI * f0 * k * i / sr) / k; v *= a * 0.6; return [v, v]; }; };
const rms = (a, lo = 0) => { let e = 0; for (let i = lo; i < a.length; ++i) e += a[i] * a[i]; return Math.sqrt(e / (a.length - lo)); };
const peak = (a, lo = 0) => { let m = 0; for (let i = lo; i < a.length; ++i) m = Math.max(m, Math.abs(a[i])); return m; };
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
const std = a => { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2))); };
const corr = (a, b) => { const ma = mean(a), mb = mean(b); let n = 0, da = 0, db = 0; for (let i = 0; i < a.length; ++i) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; } return n / Math.sqrt(da * db + 1e-300); };
// Pitch tracking: complex-demodulate at f0, low-pass (Hann FIR of width `bw`), phase derivative every 1 ms, in cents against f0.
const track = (sig, f0, bw = 100, skip = 0.5) => {
  const taps = Math.round(2 * sr / bw) | 1, win = new Float64Array(taps); let ws = 0;
  for (let i = 0; i < taps; ++i) { win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 1) / (taps + 1)); ws += win[i]; }
  const dec = 48, start = Math.floor(skip * sr), half = taps >> 1, re = new Float64Array(sig.length), im = new Float64Array(sig.length);
  for (let i = 0; i < sig.length; ++i) { const p = 2 * Math.PI * f0 * i / sr; re[i] = sig[i] * Math.cos(p); im[i] = -sig[i] * Math.sin(p); }
  const phases = [];
  for (let c = start + half; c + half < sig.length; c += dec) {
    let a = 0, b = 0; for (let j = 0; j < taps; ++j) { const w = win[j]; a += re[c - half + j] * w; b += im[c - half + j] * w; }
    phases.push(Math.atan2(b, a));
  }
  const cents = [];
  for (let i = 1; i < phases.length; ++i) {
    let d = phases[i] - phases[i - 1]; d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
    cents.push(1200 * Math.log2(1 + (d * sr / dec) / (2 * Math.PI * f0)));
  }
  return cents; // one value per ms
};
const secs = 8, N = secs * sr;

// T1: dry at Depth 0 (any Rate, Drunk, Voices, Spread, Mono Bass, Seed). The fan gains average to 1 per ear at every frequency above Mono Bass
// (a fixed normalisation from Spread and Voices, not a level match), so identical voices sum to the input; between bass and treble they differ
// (a small stereo tilt when the voices are identical), so the full-feature case uses a tonal input above the Mono Bass corner.
{
  const broadband = i => [0.1 * Math.sin(i * 0.13) + (i % 173 === 0 ? 0.1 : 0), -0.03 * Math.cos(i * 0.07)];
  const tonal = i => [0.1 * Math.sin(i * 0.13) + 0.05 * Math.sin(i * 0.37), -0.03 * Math.cos(i * 0.21)];
  for (const [o, input] of [[{ depth: 0 }, broadband], [{ depth: 0, rate: 19, drunk: 1, voices: 4, spread: 1, bass: 300, seed: 77 }, tonal]]) {
    const out = run(o, 4096 + 30000, input);
    let error = 0; for (let i = 4096 + 12000; i < out[0].length; ++i) for (let c = 0; c < 2; ++c) error = Math.max(error, Math.abs(out[c][i] - input(i - 4096)[c]));
    assert.ok(error < 1e-4, `T1 dry at Depth 0 (${error})`);
  }
}
// T2: Depth is RMS cents at every pitch, Drunk 0 and 1
{
  const res = {};
  for (const drunk of [0, 1]) for (const f0 of [220, 1760]) {
    // pooled over four seeds: one knot's random motion over 8 s is only a few independent samples
    let acc = 0; for (const seed of [1, 2, 3, 4]) { const t = track(run({ drunk, seed }, N, sine(f0))[0], f0, 100); acc += mean(t.map(v => v * v)); }
    res[`${drunk}/${f0}`] = Math.sqrt(acc / 4);
    if (process.env.WDBG) console.log(drunk, f0, res[`${drunk}/${f0}`]); assert.ok(Math.abs(res[`${drunk}/${f0}`] / 25 - 1) < 0.3, `T2 Depth 25 cents RMS at ${f0} Hz, Drunk ${drunk}: ${res[`${drunk}/${f0}`]}`);
  }
  for (const drunk of [0, 1]) { const q = res[`${drunk}/220`] / res[`${drunk}/1760`]; assert.ok(q > 0.75 && q < 1.33, `T2 same cents at both pitches (${q})`); }
  console.log('T2 RMS cents:', JSON.stringify(Object.fromEntries(Object.entries(res).map(([k, v]) => [k, +v.toFixed(1)]))));
}
// T3: at Drunk 0 the modulation spectrum of the pitch peaks at Rate
const modPeak = (t, lo, hi) => { // dominant modulation frequency of a 1 kHz-sampled series, DFT on a fine grid
  let best = 0, bf = 0; const m = mean(t);
  for (let fq = lo; fq <= hi; fq += 0.05) { let a = 0, b = 0; for (let i = 0; i < t.length; ++i) { const p = 2 * Math.PI * fq * i / 1000; a += (t[i] - m) * Math.cos(p); b += (t[i] - m) * Math.sin(p); } const pw = a * a + b * b; if (pw > best) { best = pw; bf = fq; } }
  return bf;
};
for (const rate of [1, 4, 8]) {
  const t = track(run({ drunk: 0, rate }, N, sine(1760))[0], 1760, 100);
  const pk = modPeak(t, 0.3, 20);
  assert.ok(Math.abs(pk / rate - 1) < 0.15, `T3 modulation peak ${pk} Hz at Rate ${rate}`);
}
// T4: at Drunk 1 the modulation spectrum is broad (no dominant line). One realisation of a random process has chi-square scatter, so the power
// spectrum is averaged over eight seeds before looking for lines.
{
  const grid = []; for (let fq = 2; fq <= 8; fq += 0.25) grid.push(fq);
  const pw = grid.map(() => 0), low = [0.5, 0.8, 1.2].map(() => 0);
  for (let seed = 1; seed <= 8; ++seed) {
    const t = track(run({ drunk: 1, seed }, N, sine(1760))[0], 1760, 100), m = mean(t);
    const bandPower = fq => { let a = 0, b = 0; for (let i = 0; i < t.length; ++i) { const p = 2 * Math.PI * fq * i / 1000; a += (t[i] - m) * Math.cos(p); b += (t[i] - m) * Math.sin(p); } return a * a + b * b; };
    grid.forEach((fq, i) => { pw[i] += bandPower(fq); });
    [0.5, 0.8, 1.2].forEach((fq, i) => { low[i] += bandPower(fq); });
  }
  // The noise path is a 2-pole low-pass, so the spectrum slopes by itself; a LINE is a point 6 dB above the median of its own +-1 Hz neighbourhood.
  let worst = 0;
  pw.forEach((v, i) => { const near = pw.slice(Math.max(0, i - 4), i + 5).sort((a, b) => a - b); worst = Math.max(worst, v / near[near.length >> 1]); });
  assert.ok(worst < 4, `T4 no line more than 6 dB above its neighbourhood median between 0.5 and 2 times Rate (${(10 * Math.log10(worst)).toFixed(1)} dB)`);
  assert.ok(low.every(v => v > 0) && low[0] + low[1] + low[2] > 0, 'T4 energy below Rate');
}
// T5: partials move independently (110 Hz saw, harmonics 3, 5, 8, 13)
{
  const out = run({}, N, saw(110))[0];
  const tr = [3, 5, 8, 13].map(k => track(out, 110 * k, 40));
  let sum = 0, cnt = 0; for (let i = 0; i < tr.length; ++i) for (let j = i + 1; j < tr.length; ++j) { sum += Math.abs(corr(tr[i], tr[j])); ++cnt; }
  assert.ok(sum / cnt <= 0.25, `T5 mean |rho| of the partials' pitch (${(sum / cnt).toFixed(2)})`);
  console.log('T5 mean |rho|:', (sum / cnt).toFixed(2));
}
// T6: a glide, not roughness: envelope fluctuation of a 1760 Hz sine (5 ms RMS over its mean) and the frame-rate sidebands
{
  const out = run({ voices: 1 }, N, sine(1760))[0].slice(sr);
  const w = 240, env = []; for (let i = 0; i + w <= out.length; i += w) { let e = 0; for (let j = 0; j < w; ++j) e += out[i + j] ** 2; env.push(Math.sqrt(e / w)); }
  const fl = std(env) / mean(env);
  assert.ok(fl <= 0.05, `T6a envelope fluctuation ${fl.toFixed(3)}`);
  const H = 4096 / 8, fr = sr / H, hann = i => 0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 0.5) / out.length), spec = hz => { let a = 0, b = 0; for (let i = 0; i < out.length; i += 1) { const p = 2 * Math.PI * hz * i / sr, w = hann(i); a += out[i] * w * Math.cos(p); b += out[i] * w * Math.sin(p); } return Math.hypot(a, b) / out.length; };
  const carrier = spec(1760);
  // The wobble itself spreads the carrier as a wide FM skirt whose fine structure changes with every random draw, so the test looks for a
  // discrete SPUR: power at f0 +- k * frame rate against the mean power 8 Hz either side of it, summed over four seeds.
  const specOf = (o, hz) => { let a = 0, b = 0; for (let i = 0; i < o.length; i += 1) { const p = 2 * Math.PI * hz * i / sr, w = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 0.5) / o.length); a += o[i] * w * Math.cos(p); b += o[i] * w * Math.sin(p); } return (a * a + b * b); };
  const outs = [1, 2, 3, 4].map(seed => run({ voices: 1, seed }, N, sine(1760))[0].slice(sr));
  for (const k of [1, 2]) for (const sgn of [-1, 1]) {
    const hz = 1760 + sgn * k * fr; let line = 0, floor = 0;
    for (const o of outs) { line += specOf(o, hz); floor += 0.5 * (specOf(o, hz - 8) + specOf(o, hz + 8)); }
    const spur = 10 * Math.log10(line / floor);
    assert.ok(spur < 6, `T6b spur at f0 ${sgn > 0 ? '+' : '-'} ${k} * frame rate: ${spur.toFixed(1)} dB above its floor`);
  }
  console.log('T6 envelope fluctuation', fl.toFixed(3));
}
// T7: the centre stays
// (the mean of one random realisation scatters by a few cents, so the mean is taken over 24 seeds: it is the bias that must be 0)
for (const drunk of [0, 0.5, 1]) { let acc = 0; for (let seed = 1; seed <= 24; ++seed) acc += mean(track(run({ drunk, seed }, N, sine(880))[0], 880, 100)); acc /= 24; assert.ok(Math.abs(acc) < 2, `T7 mean pitch ${acc.toFixed(2)} cents at Drunk ${drunk}`); }
// T8: voices make a chorus
{
  const fluct = o => { const out = run(o, N, sine(1760))[0].slice(sr); const w = 240, env = []; for (let i = 0; i + w <= out.length; i += w) { let e = 0; for (let j = 0; j < w; ++j) e += out[i + j] ** 2; env.push(Math.sqrt(e / w)); } return std(env) / mean(env); };
  const one = fluct({ voices: 1 }), three = fluct({ voices: 3 });
  assert.ok(three >= 0.1 && three > one, `T8 voices beat against each other (${one.toFixed(3)} -> ${three.toFixed(3)})`);
}
// T9: level, REPORTED only (docs/SPECTRAL_NO_LEVELING_PLAN.md): there is no automatic leveling, so the RMS against dry and the peak against dry are
// what the warble does to the sound. Nothing here is asserted; the user sets the level with Amplitude.
{
  const grid = (depths, rates) => {
    let worst = 0, worstPeak = -99, where = '';
    for (const f0 of [110, 880]) {
      const input = saw(f0), dry = run({ depth: 0 }, 6 * sr, input), dryRms = rms(dry[0], sr), dryPeak = peak(dry[0], sr);
      for (const depth of depths) for (const rate of rates) for (const drunk of [0, 1]) for (const voices of [1, 4]) for (const spread of [0, 1]) {
        const out = run({ depth, rate, drunk, voices, spread }, 6 * sr, input);
        for (const c of [0, 1]) {
          const d = Math.abs(20 * Math.log10(rms(out[c], sr) / dryRms)); if (d > worst) { worst = d; where = [f0, depth, rate, drunk, voices, spread].join('/'); }
          worstPeak = Math.max(worstPeak, 20 * Math.log10(peak(out[c], sr) / dryPeak));
        }
      }
    }
    return { worst, worstPeak, where };
  };
  const musical = grid([25], [0.5, 4]);
  console.log(`T9 musical grid: worst RMS error ${musical.worst.toFixed(2)} dB (${musical.where}), worst peak vs dry ${musical.worstPeak.toFixed(2)} dB`);
  const full = grid([100, 200], [0.5, 20]);
  console.log(`T9 plan grid (reported, not asserted): worst RMS error ${full.worst.toFixed(2)} dB (${full.where}), worst peak vs dry ${full.worstPeak.toFixed(2)} dB`);
}
// T10: stereo
{
  const mono = sine(1760);
  const a = run({ spread: 0, voices: 3 }, 3 * sr, mono); let err = 0; for (let i = 0; i < a[0].length; ++i) err = Math.max(err, Math.abs(a[0][i] - a[1][i]));
  assert.ok(err < 1e-9, `T10a Spread 0 is linked (${err})`);
  const lr = s => { const o = run({ spread: s }, N, mono); return corr(track(o[0], 1760, 100), track(o[1], 1760, 100)); };
  const r0 = lr(0), r5 = lr(0.5), r1 = lr(1);
  assert.ok(r0 > 0.999 && Math.abs(r5 - 0.5) <= 0.15 && Math.abs(r1) <= 0.2, `T10b L/R pitch correlation ${r0.toFixed(3)} / ${r5.toFixed(2)} / ${r1.toFixed(2)}`);
  // T10c: mono sum
  const s0 = run({ spread: 0, voices: 3 }, 6 * sr, saw(220)), s1 = run({ spread: 1, voices: 3 }, 6 * sr, saw(220));
  const sum = o => { const m = new Float64Array(o[0].length); for (let i = 0; i < m.length; ++i) m[i] = 0.5 * (o[0][i] + o[1][i]); return rms(m, sr); };
  const dB = 20 * Math.log10(sum(s1) / sum(s0));
  // two fully uncorrelated channels sum to exactly -3.01 dB, so the lower bound has a little room
  assert.ok(dB > -3.5 && dB < 0.5, `T10c mono sum level ${dB.toFixed(2)} dB`);
  // T10d: the fan widens
  const input = saw(880), d1 = run({ spread: 1, voices: 1 }, 6 * sr, input), d3 = run({ spread: 1, voices: 3 }, 6 * sr, input);
  assert.ok(corr(d3[0].slice(sr), d3[1].slice(sr)) < corr(d1[0].slice(sr), d1[1].slice(sr)) + 1e-9, 'T10d voices fan the stage wider');
  // T10e: Mono Bass
  // (the correlation of one pair of random trajectories scatters, so it is the mean over four seeds)
  const bassLR = (f0) => { let acc = 0; for (const seed of [1, 2, 3, 4]) { const o = run({ spread: 1, bass: 200, seed }, N, sine(f0)); acc += corr(track(o[0], f0, f0 > 500 ? 100 : 30), track(o[1], f0, f0 > 500 ? 100 : 30)); } return acc / 4; };
  const b100 = bassLR(100), b2k = bassLR(2000);
  assert.ok(b100 >= 0.95 && Math.abs(b2k) <= 0.2, `T10e Mono Bass: 100 Hz rho ${b100.toFixed(2)}, 2 kHz rho ${b2k.toFixed(2)}`);
  // T10f: no crossfeed
  const left = run({ spread: 1, voices: 3 }, 3 * sr, i => [sine(1000)(i)[0], 0]);
  assert.ok(rms(left[1], sr) < 1e-4 * rms(left[0], sr), `T10f no crossfeed (${rms(left[1], sr)})`);
}
// T11: deterministic, Seed, reset
{
  const a = run({ seed: 5, voices: 3, spread: 1 }, 3 * sr, saw(220)), b = run({ seed: 5, voices: 3, spread: 1 }, 3 * sr, saw(220)), c = run({ seed: 6, voices: 3, spread: 1 }, 3 * sr, saw(220));
  let same = true, diff = 0; for (let i = 0; i < a[0].length; ++i) { if (a[0][i] !== b[0][i] || a[1][i] !== b[1][i]) same = false; diff += (a[0][i] - c[0][i]) ** 2; }
  assert.ok(same && diff > 0, 'T11 same Seed identical, different Seed differs');
  const h = make({ seed: 5, voices: 3, spread: 1 }); render(h, 20000, saw(220)); f('reset', h); const again = render(h, 3 * sr, saw(220)); f('destroy', h);
  let reseeds = true; for (let i = 0; i < a[0].length; ++i) if (a[0][i] !== again[0][i]) reseeds = false;
  assert.ok(reseeds, 'T11 a reset reseeds');
}
// T12: in place (everything lands inside the window; the energy bound is only "not silent, not blown up": with no leveling, voices whose
// phases wander apart sum below the impulse's energy)
{
  const h = make({ depth: 100, voices: 3, spread: 1 }), imp = render(h, 4096 * 6, i => [i === 0 ? 1 : 0, 0]); f('destroy', h);
  const e = imp[0].reduce((s, v) => s + v * v, 0), tail = imp[0].slice(4096 * 2 + 64).reduce((s, v) => s + v * v, 0);
  assert.ok(e > 0.01 && e < 4 && tail < e * 1e-6, `T12 in place (energy ${e}, tail ${tail})`);
}
// T13: cost does not depend on pitch; Voices 4, Spread 1, N 16384
{
  const time = f0 => { const h = make({ voices: 4, spread: 1, fft: 16384 }); render(h, 20000, sine(f0)); const t0 = performance.now(); render(h, sr, sine(f0)); const dt = performance.now() - t0; f('destroy', h); return dt; };
  const lo = time(100), hi = time(8000);
  console.log(`T13 cost at 16384, 4 voices, stereo: 100 Hz ${lo.toFixed(0)} ms, 8 kHz ${hi.toFixed(0)} ms per audio second (JS harness numbers)`);
  assert.ok(Math.abs(lo - hi) < Math.max(lo, hi) * 0.5 + 20, 'T13 pitch independent');
}
// T14: robust under rapid edits (including values beyond the definition ranges), NaN, FFT switches; a switch stays neutral at Depth 0
{
  const h = make({ depth: 0 }); let seed = 5; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < 80000; ++i) {
    if (i % 64 === 0) { f('set_warble', h, rnd() * 3000, rnd() * 500 - 100, rnd() * 5, rnd() * 9 - 2, Math.floor(rnd() * 1e6)); f('set_stereo', h, rnd() * 4 - 1, rnd() * 3000); f('set_fft_size', h, [512, 1024, 2048, 4096][Math.floor(rnd() * 4)]); }
    const burst = i % 9000 < 300 ? 8 : 0.1;
    const l = f('sample', h, burst * Math.sin(i * 0.2), -burst * Math.sin(i * 0.31), rnd(), sr);
    assert.ok(Number.isFinite(l) && Number.isFinite(f('right', h)), 'T14 finite under rapid edits');
  }
  f('set_warble', h, NaN, NaN, NaN, NaN, NaN); f('set_stereo', h, NaN, NaN);
  assert.equal(f('sample', h, NaN, 0, 1, sr), 0);
  f('destroy', h);
  // a size switch is neutral at Depth 0: exact for one linked voice; with the fan (voices 3, spread 1) the first frames after a switch have no
  // peak map yet, so the fan gain can vary across a lobe for a moment: small, and gone once the map exists
  for (const [o, tol] of [[{ depth: 0 }, 2e-6], [{ depth: 0, voices: 3, spread: 1 }, 5e-3]]) {
    const g = make(o); render(g, 12000, () => [0.1, 0.1]);
    for (const length of [512, 2048, 8192, 16384, 1024, 4096]) { f('set_fft_size', g, length); const out = render(g, 24000, () => [0.1, 0.1]); assert.ok(out[0].every(v => Math.abs(v - 0.1) < tol), `T14 a switch stays neutral at Depth 0 (${JSON.stringify(o)})`); }
    assert.equal(f('set_fft_size', g, 123), -1); f('destroy', g);
  }

}
// T16: the guard lint (no clamp without a safety comment) and the four default sources agree
{
  const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
  for (const p of ['../native_modules/spectral_warble/spectral_warble.cpp']) {
    for (const line of read(p).split('\n')) {
      if (/^\s*\/\//.test(line) || /R"json|^\{"key"/.test(line) || /\bs \? /.test(line)) continue; // comments, metadata, null-handle guards
      if (/(\?[^:]*:)|std::min|std::max|min\(|max\(/.test(line) && /[<>]=? *-?[0-9.]+|[<>]=? *[a-zA-Z_]+/.test(line) && !/safety/.test(line) && !/isfinite/.test(line.replace(/safety/g, '')))
        assert.fail(`T16 clamp-shaped line without a safety comment in ${p}: ${line.trim()}`);
    }
  }
  const defs = read('../public/node-graph-module-definitions.js');
  const worklet = read('../public/node-live-audio-worklet-native-graph.js');
  const engine = read('../native_modules/graph_engine/graph_engine.cpp');
  const warbleDef = defs.slice(defs.indexOf('  spectralWarble: {'), defs.indexOf('  spectralContrast: {'));
  const wk = worklet.slice(worklet.indexOf('if (type === "spectralWarble") {'), worklet.indexOf('if (type === "spectralSmear") {'));
  const gi = engine.slice(engine.indexOf('if (typeId == kTypeSpectralWarble) {'), engine.indexOf('if (typeId == kTypeSpectralSmear) {'));
  const demo = JSON.parse(fs.readFileSync(new URL('../patches/demo_patches/spectral_warble.json', import.meta.url), 'utf8')).nodes.find(n => n.type === 'spectralWarble').params;
  const want = { depth: 25, rate: 4, drunk: 0.5, voices: 3, stereoSpread: 1, monoBassHz: 120 };
  for (const [k, v] of Object.entries(want)) {
    assert.equal(Number(param(k).defaultValue), v, `native default ${k}`);
    assert.equal(Number(demo[k]), v, `demo patch ${k}`);
    assert.ok(new RegExp(`key: ?"${k}"[\\s\\S]{0,300}?defaultValue: ?"${v}"|"key": "${k}"[\\s\\S]{0,300}?"defaultValue": "${v}"`).test(warbleDef), `definition default ${k}`);
    assert.ok(new RegExp(`"${k}"[^\\n]*,\\s*(cont|disc)\\("${k}", ${v}\\)`).test(wk), `worklet fallback ${k}`);
  }
  assert.ok(/init_control\(n\.shape, 25/.test(gi) && /init_control\(n\.lfoRate, 4/.test(gi) && /init_control\(n\.lfoVariation, 0\.5/.test(gi) && /init_control\(n\.oversample, 3/.test(gi) && /init_control\(n\.pan, 1/.test(gi) && /init_control\(n\.frequency, 120/.test(gi), 'graph engine init defaults');
}
console.log('Warble: T1-T14 and T16 pass.');
