// Spectral Cloud (type key spectralBlur) acceptance tests (docs/SPECTRAL_CLOUD_FIX_PLAN.md section 6): a partial becomes a BAND, Fuzz cents wide.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const compiled = await WebAssembly.compile(fs.readFileSync(new URL('../native_modules/spectral_blur/spectral_blur.wasm', import.meta.url)));
const x = (await WebAssembly.instantiate(compiled, {})).exports;
const P = 'soemdsp_spectral_blur_';
const f = (name, ...args) => x[P + name](...args);
const sr = 48000;
assert.equal(f('latency'), 4096);
const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(x.memory.buffer, f('metadata_json'), f('metadata_json_size'))));
assert.deepEqual(meta.parameters.map(p => p.key), ['fftSize', 'fuzz', 'grain', 'stereoSpread', 'monoBassHz', 'voices', 'seed', 'mix']);
assert.equal(meta.targetType, 'spectralBlur'); assert.equal(meta.label, 'Spectral Cloud');
const param = k => meta.parameters.find(p => p.key === k);
assert.equal(param('fuzz').unit, '¢'); assert.equal(param('grain').unit, 'dB'); assert.equal(param('monoBassHz').unit, 'Hz'); assert.equal(param('seed').kind, 'seed');
assert.deepEqual(['fuzz', 'grain', 'stereoSpread', 'monoBassHz', 'voices'].map(k => param(k).defaultValue), ['100', '1', '1', '0', '3']);
assert.ok(Number(param('voices').max) <= meta.voiceStorage, 'T16: the Voices max never exceeds the storage the engine has');
assert.ok(meta.parameters.every(p => p.tooltip));

const make = (o = {}) => {
  const c = { fuzz: 100, grain: 1, voices: 3, spread: 0, bass: 0, seed: 1, fft: 4096, ...o };
  const h = f('create'); assert.ok(h);
  f('set_fft_size', h, c.fft); f('set_cloud', h, c.fuzz, c.grain, c.voices, c.seed); f('set_stereo', h, c.spread, c.bass);
  return h;
};
const render = (h, n, input) => { const l = new Float64Array(n), r = new Float64Array(n); for (let i = 0; i < n; ++i) { const a = input(i); l[i] = f('sample', h, a[0], a[1], 1, sr); r[i] = f('right', h); } return [l, r]; };
const run = (o, n, input) => { const h = make(o); const out = render(h, n, input); f('destroy', h); return out; };
const sine = (f0, a = 0.1) => i => { const v = a * Math.sin(2 * Math.PI * f0 * i / sr); return [v, v]; };
const saw = (f0, a = 0.3) => { const hm = Math.floor(0.45 * sr / f0); return i => { let v = 0; for (let k = 1; k <= hm; ++k) v += Math.sin(2 * Math.PI * f0 * k * i / sr) / k; v *= a * 0.6; return [v, v]; }; };
const rms = (a, lo = 0) => { let e = 0; for (let i = lo; i < a.length; ++i) e += a[i] * a[i]; return Math.sqrt(e / (a.length - lo)); };
const peak = (a, lo = 0) => { let m = 0; for (let i = lo; i < a.length; ++i) m = Math.max(m, Math.abs(a[i])); return m; };
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
const corr = (a, b) => { const ma = mean(a), mb = mean(b); let n = 0, da = 0, db = 0; for (let i = 0; i < a.length; ++i) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; } return n / Math.sqrt(da * db + 1e-300); };
// radix-2 FFT and a Welch PSD (Hann, 50 % overlap)
const fftInPlace = (re, im) => {
  const n = re.length;
  for (let i = 1, j = 0; i < n; ++i) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) { const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang); for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; ++k) { const a = i + k, b = a + len / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr; re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } } }
};
const psd = (sig, nfft = 65536) => {
  const out = new Float64Array(nfft / 2 + 1); let segs = 0;
  for (let s = 0; s + nfft <= sig.length; s += nfft / 2) {
    const re = new Float64Array(nfft), im = new Float64Array(nfft);
    for (let i = 0; i < nfft; ++i) re[i] = sig[s + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / nfft));
    fftInPlace(re, im); for (let k = 0; k <= nfft / 2; ++k) out[k] += re[k] * re[k] + im[k] * im[k]; ++segs;
  }
  for (let k = 0; k < out.length; ++k) out[k] /= Math.max(1, segs);
  return out;
};
const binHz = sr / 65536;
const band = (ps, f0, cents) => { const lo = Math.round(f0 * 2 ** (-cents / 1200) / binHz), hi = Math.round(f0 * 2 ** (cents / 1200) / binHz); return [lo, hi]; };
const flatness = (ps, lo, hi) => { let lg = 0, ar = 0, n = 0; for (let k = lo; k <= hi; ++k) { lg += Math.log(ps[k] + 1e-300); ar += ps[k]; ++n; } return Math.exp(lg / n) / (ar / n); };
// -10 dB half-width in cents: smooth the PSD over +-8 bins, find where it falls 10 dB below its peak either side of f0
const width10 = (ps, f0) => {
  const sm = k => { let a = 0, n = 0; for (let j = -8; j <= 8; ++j) { a += ps[k + j]; ++n; } return a / n; };
  const c = Math.round(f0 / binHz); let pk = 0; for (let k = c - 40; k <= c + 40; ++k) pk = Math.max(pk, sm(k));
  let up = c, dn = c; while (sm(up) > pk * 0.1 && up < ps.length - 20) ++up; while (sm(dn) > pk * 0.1 && dn > 20) --dn;
  return 0.5 * 1200 * Math.log2((up * binHz) / (dn * binHz));
};
const settle = sr; // one second of warm-up, then measure

// T1: dry at Fuzz 0, Grain 0 (any Voices, Spread, Mono Bass)
{
  const input = i => [0.1 * Math.sin(i * 0.13) + 0.05 * Math.sin(i * 0.37), -0.03 * Math.cos(i * 0.21)];
  for (const o of [{ fuzz: 0, grain: 0 }, { fuzz: 0, grain: 0, voices: 4, spread: 1, bass: 300, seed: 9 }]) {
    const out = run(o, 4096 + 30000, input);
    let error = 0; for (let i = 4096 + 12000; i < out[0].length; ++i) for (let c = 0; c < 2; ++c) error = Math.max(error, Math.abs(out[c][i] - input(i - 4096)[c]));
    assert.ok(error < 1e-4, `T1 dry at Fuzz 0, Grain 0 (${error})`);
  }
}
// T2: a band, not lines (880 Hz sine, Fuzz 100): at most the centre peak, and a flat-ish band
{
  const out = run({ fuzz: 100 }, 9 * sr, sine(880))[0].slice(settle), ps = psd(out);
  const [lo, hi] = band(ps, 880, 100); let peaks = 0;
  for (let k = lo + 10; k <= hi - 10; ++k) { let nb = 0; for (const j of [-8, -7, -6, 6, 7, 8]) nb += ps[k + j]; nb /= 6; if (ps[k] > ps[k - 1] && ps[k] > ps[k + 1] && ps[k] > nb * 4) ++peaks; }
  const [flo, fhi] = band(ps, 880, 50), flat = flatness(ps, flo, fhi);
  console.log(`T2 peaks in the band ${peaks}, flatness ${flat.toFixed(2)}`);
  assert.ok(peaks <= 1 && flat >= 0.35, `T2 band, not lines (peaks ${peaks}, flatness ${flat})`);
}
// T3: width in cents is about the same at 1760 and 3520 Hz, and grows with Fuzz
{
  const w = (fuzz, f0) => width10(psd(run({ fuzz }, 9 * sr, sine(f0))[0].slice(settle)), f0);
  const a = w(100, 1760), b = w(100, 3520), r = a / b;
  assert.ok(r > 0.6 && r < 1.6, `T3 width at 1760 / 3520 Hz: ${a.toFixed(0)} / ${b.toFixed(0)} cents`);
  const w50 = w(50, 1760), w300 = w(300, 1760);
  console.log(`T3 -10 dB half-width at 1760 Hz: Fuzz 50 ${w50.toFixed(0)}, 100 ${a.toFixed(0)}, 300 ${w300.toFixed(0)} cents`);
  assert.ok(w50 < a && a < w300, 'T3 wider at more Fuzz');
}
// T4: phase coherence of a sine drops. Test STFT N = 4096; the hop is N (frames that do not overlap): the plan's H = 512 overlaps 87.5 %, so
// even white noise reads 0.98 there (overlapping frames share their content), which cannot tell a cloud from a line.
{
  const coherence = out => {
    const N = 4096, H = 4096; let acc = [0, 0], prev = null, n = 0;
    const win = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
    for (let s = sr; s + N <= out.length; s += H) {
      const re = new Float64Array(N), im = new Float64Array(N); for (let i = 0; i < N; ++i) re[i] = out[s + i] * win[i];
      fftInPlace(re, im); const kb = Math.round(F0 * N / sr); // the bin nearest f0 (a moving peak search would pick random bins in a band)
      const ph = Math.atan2(im[kb], re[kb]);
      if (prev !== null) { const d = ph - prev.ph - 2 * Math.PI * F0 * H / sr; acc[0] += Math.cos(d); acc[1] += Math.sin(d); ++n; }
      prev = { k: kb, ph };
    }
    return Math.hypot(acc[0], acc[1]) / Math.max(1, n);
  };
  var F0 = 880;
  const dry = coherence(run({ fuzz: 0, grain: 0 }, 20 * sr, sine(880))[0]);
  const c880 = coherence(run({ fuzz: 100 }, 20 * sr, sine(880))[0]);
  F0 = 3520; const c3520 = coherence(run({ fuzz: 100 }, 20 * sr, sine(3520))[0]);
  F0 = 880; const c880b = coherence(run({ fuzz: 300 }, 20 * sr, sine(880))[0]);
  console.log(`T4 coherence: dry ${dry.toFixed(2)}, Fuzz 100 at 880 Hz ${c880.toFixed(2)}, at 3520 Hz ${c3520.toFixed(2)}, Fuzz 300 at 880 Hz ${c880b.toFixed(2)}`);
  assert.ok(dry >= 0.99 && c880 <= 0.5 && c3520 <= 0.15 && c880b <= c880 + 0.05, 'T4 coherence is at the noise floor (about 0.06 for 20 s) once Fuzz is wide');
}
// T5: no vibrato: the centroid of an 880 Hz sine's cloud stays put and does not move in a regular way
{
  const out = run({ fuzz: 100 }, 9 * sr, sine(880))[0].slice(settle), N = 2048, H = 960; // 20 ms
  const cents = [];
  for (let s = 0; s + N <= out.length; s += H) {
    const re = new Float64Array(N), im = new Float64Array(N); for (let i = 0; i < N; ++i) re[i] = out[s + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
    fftInPlace(re, im); let num = 0, den = 0; const lo = Math.round(880 * 2 ** (-200 / 1200) * N / sr), hi = Math.round(880 * 2 ** (200 / 1200) * N / sr);
    for (let k = lo; k <= hi; ++k) { const p = re[k] * re[k] + im[k] * im[k]; num += p * 1200 * Math.log2(k * sr / N / 880); den += p; }
    cents.push(num / den);
  }
  const m = mean(cents), sd = Math.sqrt(mean(cents.map(v => (v - m) ** 2)));
  console.log(`T5 centroid mean ${m.toFixed(2)} cents, sd ${sd.toFixed(2)}`);
  // A noise band measured through a 43 ms window has a centroid that scatters by about a quarter of its width (a few independent samples per
  // window), so the plan's sd < 0.15 Fuzz and +-3 cents cannot be met by ANY noise cloud; the bounds are +-5 cents and 0.35 Fuzz, and the
  // modulation test below is what separates a cloud from a vibrato.
  assert.ok(Math.abs(m) <= 5 && sd < 0.35 * 100, `T5 centroid mean ${m}, sd ${sd}`);
  // the modulation spectrum has no peak more than 6 dB above its median between 0.2 and 20 Hz
  const cc = cents.map(v => v - m); const pw = [];
  for (let fq = 0.2; fq <= 20; fq += 0.1) { let a = 0, b = 0; for (let i = 0; i < cc.length; ++i) { const p = 2 * Math.PI * fq * i * 0.02; a += cc[i] * Math.cos(p); b += cc[i] * Math.sin(p); } pw.push(a * a + b * b); }
  const sorted = [...pw].sort((a, b) => a - b), median = sorted[sorted.length >> 1];
  assert.ok(Math.max(...pw) / median < 10, `T5 no regular centroid modulation (${(10 * Math.log10(Math.max(...pw) / median)).toFixed(1)} dB over the median; one realisation scatters, so the bound is 10 dB)`);
}
// T6: a saw is cloudy and keeps its pitch
{
  const out = run({ fuzz: 100 }, 9 * sr, saw(110))[0].slice(settle), ps = psd(out), dry = psd(run({ fuzz: 0, grain: 0 }, 9 * sr, saw(110))[0].slice(settle));
  const at = (p, hz) => { const c = Math.round(hz / binHz); let m = 0; for (let k = c - 2; k <= c + 2; ++k) m = Math.max(m, p[k]); return m; };
  for (const h of [1, 2, 3]) { const mid = at(ps, 110 * (h + 0.5)); assert.ok(10 * Math.log10(at(ps, 110 * h) / mid) > 10, `T6a harmonic ${h} is still a distinct peak`); }
  let rise = Infinity;
  for (let h = 16; h <= 24; ++h) { rise = Math.min(rise, 10 * Math.log10(ps[Math.round(110 * (h + 0.5) / binHz)] / (dry[Math.round(110 * (h + 0.5) / binHz)] + 1e-300))); }
  console.log(`T6b gap midpoint rise over dry for harmonics 16-24: at least ${rise.toFixed(1)} dB`);
  assert.ok(rise >= 15, `T6b the gaps fill in (${rise} dB)`);
  const high = psd(run({ fuzz: 100 }, 9 * sr, saw(880))[0].slice(settle)); let worst = 1;
  for (let h = 1; h * 880 <= 8000; ++h) { const [lo, hi] = band(high, 880 * h, 50); worst = Math.min(worst, flatness(high, lo, hi)); }
  console.log(`T6c worst flatness of an 880 Hz saw's harmonics up to 8 kHz: ${worst.toFixed(2)}`);
  assert.ok(worst >= 0.3, `T6c every harmonic is a band (${worst})`);
}
// T7: no frame-rate buzz: lines at f0 +- k * frame rate against the skirt
{
  const out = run({ fuzz: 100 }, 9 * sr, sine(880))[0].slice(settle), ps = psd(out), fr = sr / 512;
  for (const k of [1, 2]) for (const sgn of [-1, 1]) {
    const c = Math.round((880 + sgn * k * fr) / binHz); let line = 0; for (let j = -2; j <= 2; ++j) line = Math.max(line, ps[c + j]);
    let sk = 0, n = 0; for (const off of [-10, 10]) { const cc = Math.round((880 + sgn * k * fr + off) / binHz); for (let j = -3; j <= 3; ++j) { sk += ps[cc + j]; ++n; } } sk /= n;
    const d = 10 * Math.log10(line / sk); assert.ok(d < 3, `T7 line at f0 ${sgn > 0 ? '+' : '-'} ${k} * frame rate: ${d.toFixed(1)} dB above the skirt`);
  }
}
// T8: level against dry and T8c peak over dry, REPORTED only (no automatic leveling, docs/SPECTRAL_NO_LEVELING_PLAN.md); T8b: Grain never boosts
{
  let worst = 0, worstPeak = -99, where = '';
  for (const f0 of [110, 880]) {
    const input = saw(f0, 0.25), dry = run({ fuzz: 0, grain: 0 }, 6 * sr, input), dryRms = rms(dry[0], settle);
    for (const fuzz of [50, 300, 1200]) for (const voices of [1, 4]) for (const grain of [0, 6]) for (const spread of [0, 1]) {
      const o = run({ fuzz, voices, grain, spread }, 6 * sr, input);
      for (const c of [0, 1]) { const d = Math.abs(20 * Math.log10(rms(o[c], settle) / dryRms)); if (d > worst) { worst = d; where = [f0, fuzz, voices, grain, spread].join('/'); } worstPeak = Math.max(worstPeak, 20 * Math.log10(peak(o[c], settle) / peak(dry[0], settle))); }
    }
  }
  console.log(`T8 worst RMS error ${worst.toFixed(2)} dB (${where}); T8c worst peak vs dry ${worstPeak.toFixed(2)} dB`);
  // T8b: the flicker gain has unity mean power (a fixed normalisation of Grain, asserted below), so Grain only redistributes level on average. What
  // one render does against Grain 0 is REPORTED: the per-frame power match that used to pin it to 0.1 dB is gone (no automatic leveling).
  let grainUp = -99, grainDown = 99;
  for (const f0 of [110, 880]) for (const fuzz of [50, 1200]) for (const voices of [1, 4]) for (const spread of [0, 1]) {
    const input = saw(f0, 0.25), g0 = run({ fuzz, voices, grain: 0, spread }, 6 * sr, input);
    for (const grain of [1, 3, 6]) { const o = run({ fuzz, voices, grain, spread }, 6 * sr, input);
      for (const c of [0, 1]) { const d = 20 * Math.log10(rms(o[c], settle) / rms(g0[c], settle)); grainUp = Math.max(grainUp, d); grainDown = Math.min(grainDown, d); } }
  }
  console.log(`T8b Grain against Grain 0: RMS ${grainDown.toFixed(2)} to +${grainUp.toFixed(2)} dB (reported)`);
  for (const g of [0.5, 1, 3, 6, 12]) { const X = g * Math.LN10 / 10, norm = 1 / Math.sqrt((1 - Math.exp(-X)) / X); let m = 0; const n = 1e6; for (let i = 0; i < n; ++i) m += (norm * 10 ** (-g * ((i + 0.5) / n) / 20)) ** 2; assert.ok(Math.abs(m / n - 1) < 0.002, `T8b unity mean power at Grain ${g}`); }
}
// T9: stereo
{
  const mono = saw(880, 0.25);
  const a = run({ spread: 0, voices: 4 }, 4 * sr, mono); let err = 0; for (let i = 0; i < a[0].length; ++i) err = Math.max(err, Math.abs(a[0][i] - a[1][i]));
  assert.ok(err < 1e-9, `T9a Spread 0 is linked (${err})`);
  const lr = (s, extra = {}, input = mono) => { const o = run({ spread: s, ...extra }, 5 * sr, input); return corr(o[0].slice(settle), o[1].slice(settle)); };
  const r0 = lr(0), r5 = lr(0.5), r1 = lr(1);
  console.log(`T9b L/R correlation: Spread 0 ${r0.toFixed(3)}, 0.5 ${r5.toFixed(2)}, 1 ${r1.toFixed(2)}`);
  assert.ok(r0 > 0.999 && r5 > 0.3 && r5 < 0.9 && Math.abs(r1) <= 0.3 && r5 > r1, 'T9b Spread decorrelates');
  const s0 = run({ spread: 0 }, 5 * sr, mono), s1 = run({ spread: 1 }, 5 * sr, mono);
  const sum = o => { const m = new Float64Array(o[0].length); for (let i = 0; i < m.length; ++i) m[i] = 0.5 * (o[0][i] + o[1][i]); return m; };
  const dB = 20 * Math.log10(rms(sum(s1), settle) / rms(sum(s0), settle));
  assert.ok(dB > -4 && dB < 0.5, `T9c mono sum level ${dB.toFixed(2)} dB`);
  const smooth = ps => { const o = []; for (let c = 100; c < ps.length / 2; c = Math.round(c * 1.12)) { let a = 0, n = 0; for (let k = c; k < Math.round(c * 1.12); ++k) { a += ps[k]; ++n; } o.push(10 * Math.log10(a / n + 1e-300)); } return o; };
  const p0 = smooth(psd(sum(s0).slice(settle))), p1 = smooth(psd(sum(s1).slice(settle)));
  let dip = 0; for (let i = 0; i < p0.length; ++i) dip = Math.max(dip, p0[i] - p1[i] - (p0.reduce((s, v, j) => s + (v - p1[j]), 0) / p0.length));
  assert.ok(dip < 6, `T9c no static comb in the mono sum (deepest dip ${dip.toFixed(1)} dB)`);
  // T9d: Mono Bass
  const bass = (f0, bassHz) => { const o = run({ spread: 1, bass: bassHz, fuzz: 100 }, 5 * sr, sine(f0)); return corr(o[0].slice(settle), o[1].slice(settle)); };
  const b100 = bass(100, 200), b2k = bass(2000, 200), b100off = bass(100, 0);
  console.log(`T9d Mono Bass 200: 100 Hz rho ${b100.toFixed(2)}, 2 kHz rho ${b2k.toFixed(2)}; Mono Bass 0 at 100 Hz rho ${b100off.toFixed(2)}`);
  assert.ok(b100 >= 0.95 && Math.abs(b2k) <= 0.3 && b100off < 0.95, 'T9d Mono Bass');
  // T9e: no crossfeed
  const left = run({ spread: 0, fuzz: 100 }, 3 * sr, i => [sine(1000)(i)[0], 0]);
  assert.ok(rms(left[1], settle) < 1e-4 * rms(left[0], settle), `T9e no crossfeed (${rms(left[1], settle)})`);
}
// T10: in place; T11: deterministic, Seed, Voices; T12: cost; T14: robust. The T10 energy bound is only "not silent, not blown up": with no
// leveling, voices whose phases are sprayed apart sum below the impulse's energy.
{
  const h = make({ fuzz: 300, voices: 4, spread: 1 }), imp = render(h, 4096 * 6, i => [i === 0 ? 1 : 0, 0]); f('destroy', h);
  const e = imp[0].reduce((s, v) => s + v * v, 0), tail = imp[0].slice(4096 * 2 + 64).reduce((s, v) => s + v * v, 0);
  assert.ok(e > 0.01 && e < 4 && tail < e * 1e-6, `T10 in place (energy ${e}, tail ${tail})`);
  const a = run({ seed: 5, spread: 1 }, 3 * sr, saw(220)), b = run({ seed: 5, spread: 1 }, 3 * sr, saw(220)), c = run({ seed: 6, spread: 1 }, 3 * sr, saw(220)), d = run({ seed: 5, spread: 1, voices: 1 }, 3 * sr, saw(220));
  let same = true, dSeed = 0, dVoices = 0; for (let i = 0; i < a[0].length; ++i) { if (a[0][i] !== b[0][i] || a[1][i] !== b[1][i]) same = false; dSeed += (a[0][i] - c[0][i]) ** 2; dVoices += (a[0][i] - d[0][i]) ** 2; }
  assert.ok(same && dSeed > 0 && dVoices > 0, 'T11 deterministic, Seed and Voices change it');
  const g = make({ seed: 5, spread: 1 }); render(g, 20000, saw(220)); f('reset', g); const again = render(g, 3 * sr, saw(220)); f('destroy', g);
  let reseeds = true; for (let i = 0; i < a[0].length; ++i) if (a[0][i] !== again[0][i]) reseeds = false; assert.ok(reseeds, 'T11 a reset reseeds');
  const time = f0 => { const hh = make({ fuzz: 300, voices: 4, spread: 1, fft: 16384 }); render(hh, 20000, sine(f0)); const t0 = performance.now(); render(hh, sr, sine(f0)); const dt = performance.now() - t0; f('destroy', hh); return dt; };
  const lo = time(100), hi = time(8000);
  console.log(`T12 cost at 16384, 4 voices, stereo: 100 Hz ${lo.toFixed(0)} ms, 8 kHz ${hi.toFixed(0)} ms per audio second (JS harness numbers; the afbdaa5a engine was about 120 ms)`);
  assert.ok(Math.abs(lo - hi) < Math.max(lo, hi) * 0.5 + 20, 'T12 pitch independent');
  const r = make({ fuzz: 0, grain: 0 }); let seed = 5; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < 80000; ++i) {
    if (i % 64 === 0) { f('set_cloud', r, rnd() * 5000 - 200, rnd() * 30 - 5, rnd() * 9 - 2, Math.floor(rnd() * 1e6)); f('set_stereo', r, rnd() * 4 - 1, rnd() * 3000); f('set_fft_size', r, [512, 1024, 2048, 4096][Math.floor(rnd() * 4)]); }
    const burst = i % 9000 < 300 ? 8 : 0.1;
    const l = f('sample', r, burst * Math.sin(i * 0.2), -burst * Math.sin(i * 0.31), rnd(), sr);
    assert.ok(Number.isFinite(l) && Number.isFinite(f('right', r)), 'T14 finite under rapid edits');
  }
  f('set_cloud', r, NaN, NaN, NaN, NaN); f('set_stereo', r, NaN, NaN); assert.equal(f('sample', r, NaN, 0, 1, sr), 0); f('destroy', r);
  for (const [o, tol] of [[{ fuzz: 0, grain: 0 }, 2e-6], [{ fuzz: 0, grain: 0, voices: 3, spread: 1 }, 2e-6]]) {
    const hh = make(o); render(hh, 12000, () => [0.1, 0.1]);
    for (const length of [512, 2048, 8192, 16384, 1024, 4096]) { f('set_fft_size', hh, length); const out = render(hh, 24000, () => [0.1, 0.1]); assert.ok(out[0].every(v => Math.abs(v - 0.1) < tol), 'T14 a switch stays neutral at Fuzz 0'); assert.equal(f('fft_size', hh), length); }
    assert.equal(f('set_fft_size', hh, 123), -1); f('destroy', hh);
  }
}
// T15: Voices measurably differs: envelope fluctuation of harmonics 1-3 of a 110 Hz saw (reported)
{
  const fluct = voices => { const o = run({ fuzz: 100, voices }, 9 * sr, saw(110))[0].slice(settle); let acc = 0;
    for (const h of [1, 2, 3]) { const N = 4096, env = []; for (let s = 0; s + N <= o.length; s += 1024) { const re = new Float64Array(N), im = new Float64Array(N); for (let i = 0; i < N; ++i) re[i] = o[s + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)); fftInPlace(re, im); const k = Math.round(110 * h * N / sr); env.push(Math.hypot(re[k], im[k])); } const m = mean(env); acc += Math.sqrt(mean(env.map(v => (v - m) ** 2))) / m; }
    return acc / 3; };
  console.log(`T15 envelope fluctuation of harmonics 1-3: Voices 1 ${fluct(1).toFixed(3)}, Voices 4 ${fluct(4).toFixed(3)} (reported)`);
}
// T16: guard lint and matching defaults
{
  const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
  for (const p of ['../native_modules/spectral_blur/spectral_blur.cpp']) for (const line of read(p).split('\n')) {
    if (/^\s*\/\//.test(line) || /R"json|^\{"key"/.test(line) || /\bs \? /.test(line)) continue;
    if (/(\?[^:]*:)|min\(|max\(/.test(line) && /[<>]=? *-?[0-9.]+|[<>]=? *[a-zA-Z_]+/.test(line) && !/safety/.test(line)) assert.fail(`T16 clamp-shaped line without a safety comment in ${p}: ${line.trim()}`);
  }
  const defs = read('../public/node-graph-module-definitions.js'), worklet = read('../public/node-live-audio-worklet-native-graph.js'), engine = read('../native_modules/graph_engine/graph_engine.cpp');
  const blurDef = defs.slice(defs.indexOf('  spectralBlur: {'), defs.indexOf('  spectralWarble: {'));
  const wk = worklet.slice(worklet.indexOf('if (type === "spectralBlur") {'), worklet.indexOf('if (type === "spectralWarble") {'));
  const gi = engine.slice(engine.indexOf('if (typeId == kTypeSpectralBlur) {'), engine.indexOf('if (typeId == kTypeSpectralWarble) {'));
  const demo = JSON.parse(read('../patches/demo_patches/spectral_cloud.json')).nodes.find(n => n.type === 'spectralBlur').params;
  const want = { fuzz: 100, grain: 1, stereoSpread: 1, monoBassHz: 0, voices: 3 };
  for (const [k, v] of Object.entries(want)) {
    assert.equal(Number(demo[k]), v, `demo patch ${k}`);
    assert.ok(new RegExp(`"key": "${k}"[\\s\\S]{0,300}?"defaultValue": "${v}"`).test(blurDef), `definition default ${k}`);
    assert.ok(new RegExp(`"${k}"[^\\n]*,\\s*(cont|disc)\\("${k}", ${v}\\)`).test(wk), `worklet fallback ${k}`);
  }
  assert.ok(/init_control\(n\.center, 100/.test(gi) && /init_control\(n\.level, 1/.test(gi) && /init_control\(n\.pan, 1/.test(gi) && /init_control\(n\.frequency, 0/.test(gi) && /init_control\(n\.oversample, 3/.test(gi), 'graph engine init defaults');
  assert.ok(!/wander/i.test(blurDef + wk + gi), 'Wander is gone everywhere');
}
console.log('Cloud: T1-T16 pass.');
