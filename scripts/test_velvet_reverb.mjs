// Dark Velvet Reverb (velvet_reverb v4): one job per parameter. Taps (key
// "density") = how many taps; Length (key "decay") only spreads them; Amp Decay
// = dB at the end of the tail (0 = flat / gated); Density Skew = where they sit
// (Step Graph rational warp); Darkness and Tail Darkness = continuous pulse
// widths. Also the face layout export (soemdsp_velvet_reverb_layout, L and R).
// Helpers take `taps`, or a legacy `density` (Hz) that means taps = density x decay.
//   node scripts/test_velvet_reverb.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;
const check = (ok, msg) => { if (!ok) { failed += 1; console.error("FAIL", msg); } else console.log("ok  ", msg); };

const mod = await WebAssembly.compile(fs.readFileSync(path.join(root, "native_modules", "velvet_reverb", "velvet_reverb.wasm")));
const imports = {};
for (const i of WebAssembly.Module.imports(mod)) { imports[i.module] ??= {}; imports[i.module][i.name] = i.kind === "function" ? () => 0 : undefined; }
const x = (await WebAssembly.instantiate(mod, imports)).exports;

const FS = 48000;
check(x.soemdsp_velvet_reverb_version() >= 9, `velvet_reverb version ${x.soemdsp_velvet_reverb_version()}`);

// Wet impulse response (Mix 1): impulse on both channels at sample 0.
const tapsOf = ({ taps, density, decay = 0.025 }) => taps ?? (density ?? 2500) * decay;
function ir({ taps, density, dark = 1, spread = 1, decay = 0.025, tail = 0, seed = 1, amp = -60, skew = 0, gap = 0.083, tailRand = 1, tailCurve = 0, n } = {}) { // gap: a dense test Min Gap (~4 samples); the default is 1 ms. tailRand 1 = previous random widths. tailCurve 0 = geometric width sweep
  const T = tapsOf({ taps, density, decay });
  const h = x.soemdsp_velvet_reverb_create(FS);
  if (!h) throw new Error("create failed");
  x.soemdsp_velvet_reverb_set_seed(h, seed);
  const len = n ?? Math.ceil(decay * FS) + 2048;
  const L = new Float64Array(len), R = new Float64Array(len);
  for (let i = 0; i < len; i += 1) {
    const v = i === 0 ? 1 : 0;
    L[i] = x.soemdsp_velvet_reverb_sample(h, v, v, T, dark, spread, 1, FS, decay, tail, amp, skew, gap, tailRand, tailCurve);
    R[i] = x.soemdsp_velvet_reverb_right(h);
  }
  x.soemdsp_velvet_reverb_destroy(h);
  return { L, R };
}
function layout({ taps, density, dark = 1, spread = 1, decay = 0.025, tail = 0, seed = 1, amp = -60, skew = 0, gap = 0.083, tailRand = 1, tailCurve = 0 } = {}) {
  const count = x.soemdsp_velvet_reverb_layout(tapsOf({ taps, density, decay }), dark, spread, FS, decay, tail, seed, amp, skew, gap, tailRand, tailCurve);
  const pos = new Float64Array(x.memory.buffer, x.soemdsp_velvet_reverb_layout_pos(), count).slice();
  const width = new Float64Array(x.memory.buffer, x.soemdsp_velvet_reverb_layout_width(), count).slice();
  const level = new Float64Array(x.memory.buffer, x.soemdsp_velvet_reverb_layout_level(), count).slice();
  const countR = x.soemdsp_velvet_reverb_layout_count_r();
  const posR = new Float64Array(x.memory.buffer, x.soemdsp_velvet_reverb_layout_pos_r(), countR).slice();
  const levelR = new Float64Array(x.memory.buffer, x.soemdsp_velvet_reverb_layout_level_r(), countR).slice();
  return { count, pos, width, level, countR, posR, levelR, length: x.soemdsp_velvet_reverb_layout_length(), flags: x.soemdsp_velvet_reverb_layout_flags() };
}
const energy = (a, from = 0, to = a.length) => { let e = 0; for (let i = from; i < to; i += 1) e += a[i] * a[i]; return e; };
const bright = (a) => { let d = 0; for (let i = 1; i < a.length; i += 1) d += (a[i] - a[i - 1]) ** 2; return d / energy(a); };
const dist = (a, b) => { let e = 0; for (let i = 0; i < a.length; i += 1) e += (a[i] - b[i]) ** 2; return Math.sqrt(e); };
const db = (v) => 10 * Math.log10(v);
const nonzeroStarts = (a, to = a.length) => { let c = 0, prev = 0; for (let i = 0; i < to; i += 1) { if (a[i] !== 0 && prev === 0) c += 1; prev = a[i]; } return c; };

// ---- Fractional Darkness: 1.66 is its own colour, between 1 and 2
{
  const opts = { decay: 0.1 };
  const a = ir({ ...opts, dark: 1 }).L, b = ir({ ...opts, dark: 1.66 }).L, c = ir({ ...opts, dark: 2 }).L;
  check(dist(a, b) > 1e-3 && dist(b, c) > 1e-3, `Darkness 1.66 differs from 1 (${dist(a, b).toFixed(4)}) and from 2 (${dist(b, c).toFixed(4)})`);
  const ba = bright(a), bb = bright(b), bc = bright(c);
  check(ba > bb && bb > bc, `brightness falls 1 -> 1.66 -> 2: ${ba.toFixed(4)} > ${bb.toFixed(4)} > ${bc.toFixed(4)}`);
}

// ---- Sweeping Darkness is continuous (no jump at whole numbers)
{
  const steps = [];
  let prev = null;
  const bs = [];
  for (let k = 0; k <= 300; k += 1) {
    const d = 1 + k * 0.01;
    const r = ir({ decay: 0.05, density: 2560, dark: d, n: 4000 }).L;
    if (prev) steps.push({ d, s: dist(prev, r) });
    bs.push(bright(r));
    prev = r;
  }
  const sorted = steps.map((s) => s.s).sort((p, q) => p - q);
  const median = sorted[sorted.length >> 1];
  const max = sorted[sorted.length - 1];
  const atInt = steps.filter((s) => Math.abs(s.d - Math.round(s.d)) < 1e-9).map((s) => s.s);
  check(max < 8 * median, `Darkness sweep 1..4 in 0.01 steps: largest step ${max.toFixed(5)} vs median ${median.toFixed(5)}`);
  check(atInt.every((v) => v < 4 * median), `no jump crossing 2, 3, 4: ${atInt.map((v) => v.toFixed(5)).join(", ")} (median ${median.toFixed(5)})`);
  let rises = 0;
  for (let i = 1; i < bs.length; i += 1) if (bs[i] > bs[i - 1] * 1.02) rises += 1;
  check(rises === 0, `brightness keeps falling as Darkness rises (${rises} rises over 2%)`);
}

// ---- Tail Darkness: continuous too; 0 = off
{
  const base = ir({ dark: 3, tail: 0, decay: 0.2, density: 640 }).L;
  const same = ir({ dark: 3, tail: 3, decay: 0.2, density: 640 }).L;
  check(dist(base, same) < 1e-12, "Tail Darkness 0 is off (same as Tail Darkness = Darkness)");
  const t1 = ir({ dark: 3, tail: 20, decay: 0.2, density: 640 }).L, t2 = ir({ dark: 3, tail: 20.5, decay: 0.2, density: 640 }).L, t3 = ir({ dark: 3, tail: 21, decay: 0.2, density: 640 }).L;
  check(dist(t1, t2) > 1e-6 && dist(t2, t3) > 1e-6, "Tail Darkness 20.5 differs from 20 and 21");
}

// ---- Each parameter has one job: Taps = how many, Length = spread (sparser, not more)
{
  const lens = [];
  for (const decay of [0.05, 0.2, 1]) {
    const r = ir({ decay, taps: 100 }).L;
    let last = 0;
    for (let i = 0; i < r.length; i += 1) if (Math.abs(r[i]) > 1e-12) last = i;
    lens.push(last / FS);
  }
  check(lens[0] < lens[1] && lens[1] < lens[2], `more Length = longer tail: ${lens.map((v) => v.toFixed(3)).join(" < ")} s`);
  const counts = [[50, 0.5], [50, 5], [62.5, 0.025], [64, 0.001], [33.3, 1], [1, 0.2]].map(([taps, decay]) => [taps, layout({ taps, decay }).count]);
  // ceil(Taps), unless the Length cannot give every tap a Min Gap cell (default 0.083 ms = 3.98 samples): 64 in 1 ms keep 13.
  const wantOf = (taps, decay) => Math.ceil(Math.min(taps, Math.max(1, decay * FS) / (0.083e-3 * FS)) - 1e-9);
  const want = [[50, 0.5], [50, 5], [62.5, 0.025], [64, 0.001], [33.3, 1], [1, 0.2]].map(([t, d]) => wantOf(t, d));
  check(counts.every(([, got], i) => got === want[i]), `tap count = ceil(Taps) at any Length, held by the cell floor only where it must: ${counts.map(([w, g]) => `${w}->${g}`).join(", ")}`);
  const a = nonzeroStarts(ir({ taps: 80, decay: 0.2, dark: 1 }).L), b = nonzeroStarts(ir({ taps: 80, decay: 2, dark: 1, n: 2 * FS + 2048 }).L);
  check(Math.abs(a - 80) <= 3 && Math.abs(b - 80) <= 3, `Length does not add taps: 80 taps -> ${a} onsets over 0.2 s, ${b} over 2 s`);
  const lay = layout({ taps: 20000, decay: 1 });
  check(lay.count === x.soemdsp_velvet_reverb_max_taps() && (lay.flags & 1), `past the engine's ${x.soemdsp_velvet_reverb_max_taps()} taps the layout says so (count ${lay.count}, flags ${lay.flags})`);
  const lay2 = layout({ taps: 100, decay: 30 });
  check((lay2.flags & 2) && lay2.length < 7.5 && lay2.length > 6, `only a Length that truly cannot fit (30 s, past the definition max) is held and flagged (${lay2.length.toFixed(3)} s, flags ${lay2.flags})`);
  const lay3 = layout({ taps: 120, decay: 0.4, dark: 5 });
  check(lay3.count === 120 && lay3.flags === 0 && lay3.pos.every((p, i) => i === 0 || p >= lay3.pos[i - 1] - 0.4 / 120) && lay3.pos[lay3.count - 1] < 0.4 && lay3.width.every((wd) => wd * FS >= 1 && wd * FS <= 5), "layout: 120 taps inside 0.4 s, widths 1..5 samples");
  const r3 = ir({ taps: 120, decay: 0.4, dark: 5 }).L;
  check(Math.abs(nonzeroStarts(r3) - lay3.count) <= 3, `layout matches the audio: ${lay3.count} taps in the layout, ${nonzeroStarts(r3)} pulse onsets in the impulse response`);
}

// ---- Amp Decay: dB at the end of the tail; 0 dB = flat (gated), the fade is exponential
{
  const endDb = (amp) => {
    const lay = layout({ taps: 400, decay: 0.5, amp });
    const env = (k) => Math.abs(lay.level[k]);
    const n = lay.count, q = Math.floor(n / 10);
    let a = 0, b = 0;
    for (let k = 0; k < q; k += 1) { a += env(k); b += env(n - 1 - k); }
    return 20 * Math.log10(b / a);
  };
  const flat = endDb(0), rt = endDb(-60), deep = endDb(-96);
  check(Math.abs(flat) < 0.5, `Amp Decay 0 dB: last tenth of the taps at ${flat.toFixed(2)} dB vs the first (flat, gated)`);
  check(rt < -45 && rt > -60, `Amp Decay -60 dB: last tenth at ${rt.toFixed(1)} dB (fades toward -60 at the very end)`);
  check(deep < rt - 20, `Amp Decay -96 dB fades further: ${deep.toFixed(1)} dB`);
  const g = ir({ taps: 200, decay: 0.1, amp: 0, n: 7000 }).L;
  const len = Math.round(0.1 * FS);
  check(energy(g, len + 70) === 0 && energy(g, Math.floor(len * 0.9), len) > 0.05 * energy(g, 0, Math.floor(len * 0.1)), "gated: full level up to the end of Length, then silence");
  const cnt = [0, -30, -96].map((amp) => layout({ taps: 77.5, decay: 0.3, amp }).count);
  check(cnt.every((c) => c === 78), `Amp Decay leaves the tap count alone (${cnt.join(", ")})`);
  const lin = layout({ taps: 300, decay: 0.3, amp: -40 });
  let worst = 0;
  for (let k = 1; k < lin.count - 1; k += 1) {
    const want = -40 * lin.pos[k] / lin.length;
    const got = 20 * Math.log10(Math.abs(lin.level[k]));
    worst = Math.max(worst, Math.abs(got - want));
  }
  check(worst < 0.5, `Amp Decay is exponential (dB falls linearly with time): worst ${worst.toFixed(3)} dB off at Darkness 1`);
}

// ---- Density Skew: Step Graph rational warp of the positions (one-sided)
{
  const meanPos = (skew) => { const l = layout({ taps: 200, decay: 1, skew }); return [l.count, l.pos.reduce((p, q) => p + q, 0) / l.count / l.length]; };
  const [c0, m0] = meanPos(0), [cp, mp] = meanPos(0.6), [cn, mn] = meanPos(-0.6);
  check(c0 === 200 && cp === 200 && cn === 200, `Density Skew leaves the tap count alone (${c0}, ${cp}, ${cn})`);
  check(Math.abs(m0 - 0.5) < 0.03 && mp < 0.4 && mn > 0.6, `+ packs taps toward the start, - toward the end: mean position ${mp.toFixed(3)} / ${m0.toFixed(3)} / ${mn.toFixed(3)} of Length`);
  const l1 = layout({ taps: 100, decay: 0.5, skew: 0.5 }), l2 = layout({ taps: 100, decay: 0.5, skew: 0.5, amp: 0 });
  check(l1.pos.every((p, i) => p === l2.pos[i]), "Density Skew and Amp Decay are independent (same positions at any Amp Decay)");
  let prev = null, maxMove = 0;
  // Mid range stays smooth (the knob's fine control near 0).
  for (let k = 0; k <= 90; k += 1) {
    const l = layout({ taps: 64, decay: 0.2, skew: -0.9 + k * 0.02 });
    if (prev) for (let i = 0; i < l.count; i += 1) maxMove = Math.max(maxMove, Math.abs(l.pos[i] - prev.pos[i]));
    prev = l;
  }
  check(maxMove < 0.2 / 6, `Skew sweep -0.9..+0.9 in 0.02 steps moves taps smoothly (largest move ${(maxMove * 1000).toFixed(2)} ms)`);
  const e1 = layout({ taps: 64, decay: 0.2, skew: 0.9 }), e0 = layout({ taps: 64, decay: 0.2, skew: -0.9 });
  // At the previous range ends the taps already crowd the start / the end.
  const mean = (a) => a.reduce((p, q) => p + q, 0) / Math.max(1, a.length);
  check(mean(e1.pos) < 0.05 && mean(e0.pos) > 0.15, `Skew +0.9 packs toward the start, -0.9 toward the end (mean ${(mean(e1.pos) * 1000).toFixed(1)} / ${(mean(e0.pos) * 1000).toFixed(1)} ms of 200, ${e1.count} / ${e0.count} taps)`);
  // Full range -1..+1: well-behaved at the endpoints (no NaN, no infinite cells;
  // Min Gap still drops bunched taps). +1 packs at least as hard to the start
  // as +0.9; -1 at least as hard to the end as -0.9.
  const finiteLay = (l) => l.count >= 1
    && l.pos.every((p) => Number.isFinite(p) && p >= -1e-15 && p <= l.length + 1e-9)
    && l.width.every((w) => Number.isFinite(w) && w > 0)
    && l.level.every((v) => Number.isFinite(v));
  const p1 = layout({ taps: 64, decay: 0.2, skew: 1 }), n1 = layout({ taps: 64, decay: 0.2, skew: -1 });
  check(finiteLay(p1) && finiteLay(n1), `Skew +-1 stays finite (${p1.count} / ${n1.count} taps, no NaN)`);
  check(mean(p1.pos) <= mean(e1.pos) + 1e-12 && mean(n1.pos) >= mean(e0.pos) - 1e-12, `Skew +1 packs toward the start at least as hard as +0.9, -1 toward the end at least as hard as -0.9 (mean ${(mean(p1.pos) * 1000).toFixed(1)} / ${(mean(n1.pos) * 1000).toFixed(1)} ms of 200, ${p1.count} / ${n1.count} taps)`);
  const denseP = layout({ taps: 4096, decay: 0.05, skew: 1, dark: 1 });
  const denseN = layout({ taps: 4096, decay: 0.05, skew: -1, dark: 1 });
  const noShare = (l) => {
    const at = new Set();
    let shared = 0;
    for (let i = 0; i < l.count; i += 1) { const s = Math.round(l.pos[i] * FS); if (at.has(s)) shared += 1; at.add(s); }
    return shared;
  };
  check((denseP.flags & 4) && (denseN.flags & 4) && denseP.count < 4096 && denseN.count < 4096 && finiteLay(denseP) && finiteLay(denseN) && noShare(denseP) === 0 && noShare(denseN) === 0,
    `Skew +-1, 4096 taps in 50 ms: Min Gap still drops bunched taps (${denseP.count} / ${denseN.count} play, flags ${denseP.flags} / ${denseN.flags})`);
  const defs = fs.readFileSync(path.join(root, "public", "node-graph-module-definitions.js"), "utf8");
  const sk = defs.slice(defs.indexOf('key: "densitySkew",'), defs.indexOf('key: "densitySkew",') + 220);
  check(/max: "1"/.test(sk) && /min: "-1"/.test(sk) && /sliderCurve: "bipolarRational"/.test(sk) && /curveAmount: "-0.9",/.test(defs.slice(defs.indexOf('key: "densitySkew",') - 160, defs.indexOf('key: "densitySkew",'))), "Density Skew: range -1..+1, knob scaled by the bipolar rational slider curve (amount -0.9)");
}

// ---- Face height is amplitude only: sign x the Amp Decay envelope at the pulse
// centre, with no darkness gain (no 1/width, no Tail Darkness make-up).
{
  const opts = { taps: 150, decay: 0.3, amp: -40, seed: 9 };
  let worst = 0, n = 0;
  for (const [dark, tail] of [[1, 0], [1, 400], [64, 0], [8, 200]]) {
    const l = layout({ ...opts, dark, tail });
    for (let i = 0; i < l.count - 1; i += 1) { // the last tap also carries its fraction
      const want = Math.pow(10, (opts.amp / 20) * (l.pos[i] + 0.5 * l.width[i]) / l.length);
      worst = Math.max(worst, Math.abs(Math.abs(l.level[i]) / want - 1));
      n += 1;
    }
  }
  check(worst < 0.005, `layout amplitude = the Amp Decay envelope at Darkness 1 / 8 / 64 and Tail Darkness 0 / 200 / 400 (${n} taps, worst ${(worst * 100).toFixed(3)}% off)`);
}

// ---- Deterministic: a pure function of Seed and the settings
{
  const a = ir({ taps: 90, decay: 0.1, seed: 42, skew: 0.3, amp: -20 }), b = ir({ taps: 90, decay: 0.1, seed: 42, skew: 0.3, amp: -20 });
  const c = ir({ taps: 90, decay: 0.1, seed: 43, skew: 0.3, amp: -20 });
  check(dist(a.L, b.L) === 0 && dist(a.R, b.R) === 0 && dist(a.L, c.L) > 1e-3, "same Seed + settings = bit-identical taps (L and R); another Seed differs");
}

// ---- Always fades out, never gated, over extreme settings
{
  let worstEnd = -Infinity, misses = 0, cases = 0, after = 0;
  for (const density of [20, 100, 2500, 20000]) {
    for (const decay of [0.001, 0.025, 0.5, 2, 5]) {
      for (const dark of [1, 64]) {
        const len = Math.ceil(decay * FS);
        const r = ir({ density, decay, dark, n: len + 2048 }).L;
        const seg = 10;
        const segE = [];
        for (let k = 0; k < seg; k += 1) segE.push(energy(r, Math.floor(k * len / seg), Math.floor((k + 1) * len / seg)));
        const first = Math.max(...segE.slice(0, 2));
        const taps = Math.min(4096, density * decay);
        if (taps >= 20) worstEnd = Math.max(worstEnd, db((segE[seg - 1] + 1e-300) / (first + 1e-300)));
        const h1 = segE.slice(0, 5).reduce((p, q) => p + q, 0), h2 = segE.slice(5).reduce((p, q) => p + q, 0);
        if (taps >= 20 && !(h2 < h1 * 0.01)) misses += 1;
        if (energy(r, len + 70) > 0) after += 1;
        cases += 1;
      }
    }
  }
  check(worstEnd < -40, `last tenth of the tail is at most ${worstEnd.toFixed(1)} dB vs its start over ${cases} Density/Decay/Darkness cases (fades out, not gated)`);
  check(misses === 0, `second half of the tail is >20 dB below the first in every case with 20+ taps (${misses} misses)`);
  check(after === 0, `no output past Decay + pulse width in any case (${after} misses)`);
}

// ---- Sweeps are continuous (no jumps; the last tap fades in and out)
{
  const sweep = (name, values, mk) => {
    let prev = null; const s = [];
    for (const v of values) { const r = ir({ ...mk(v), n: 30000 }).L; if (prev) s.push(dist(prev, r)); prev = r; }
    const sorted = [...s].sort((p, q) => p - q);
    const med = sorted[sorted.length >> 1], max = sorted[sorted.length - 1];
    check(max < 10 * med + 1e-9, `${name} sweep: largest step ${max.toFixed(5)} vs median ${med.toFixed(5)}`);
  };
  sweep("Length 0.1..0.3 s at 120 taps", Array.from({ length: 101 }, (_, i) => 0.1 + i * 0.002), (v) => ({ decay: v, taps: 120 }));
  sweep("Amp Decay -96..0 dB", Array.from({ length: 101 }, (_, i) => -96 + i * 0.96), (v) => ({ decay: 0.3, taps: 120, amp: v }));
  sweep("Taps 90..90.3 at 0.3 s", Array.from({ length: 101 }, (_, i) => 90 + i * 0.003), (v) => ({ decay: 0.3, taps: v }));
  sweep("Density Skew -0.5..0.5", Array.from({ length: 101 }, (_, i) => -0.5 + i * 0.01), (v) => ({ decay: 0.3, taps: 90, skew: v }));
}

// ---- Wet level stays put across Darkness (energy normalization with fractional widths)
{
  const noiseIn = (n, seed) => { let s = seed >>> 0 || 1; const a = new Float64Array(n); for (let i = 0; i < n; i += 1) { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; a[i] = (s / 4294967296) * 2 - 1; } return a; };
  const input = noiseIn(FS, 7);
  const level = (dark) => {
    const h = x.soemdsp_velvet_reverb_create(FS); x.soemdsp_velvet_reverb_set_seed(h, 3);
    let e = 0;
    for (let i = 0; i < input.length; i += 1) { const v = x.soemdsp_velvet_reverb_sample(h, input[i], input[i], 256, dark, 1, 1, FS, 0.1, 0, -60, 0, 0, 1); if (i > FS / 4) e += v * v; }
    x.soemdsp_velvet_reverb_destroy(h);
    return e;
  };
  const ref = level(1);
  const spreadDb = [1.5, 2, 4.33, 16.5, 64].map((d) => db(level(d) / ref));
  check(spreadDb.every((v) => v < 0.5 && v > -2), `wet level vs Darkness 1 at 1.5/2/4.33/16.5/64: ${spreadDb.map((v) => v.toFixed(2)).join(", ")} dB`);
}

// ---- Face layout level is signed: the same +/- the audio plays (bipolar face)
{
  const opts = { taps: 125, dark: 1, decay: 0.05, seed: 5 };
  const lay = layout(opts);
  const { L } = ir(opts);
  let pos = 0, neg = 0, match = 0, tested = 0;
  const at = new Map();
  for (let i = 0; i < lay.count; i += 1) { const k = Math.round(lay.pos[i] * FS); at.set(k, (at.get(k) || 0) + 1); }
  for (let i = 0; i < lay.count; i += 1) {
    if (lay.level[i] > 0) pos += 1; else if (lay.level[i] < 0) neg += 1;
    const k = Math.round(lay.pos[i] * FS);
    if (at.get(k) !== 1 || L[k] === 0) continue;
    tested += 1;
    if (Math.sign(L[k]) === Math.sign(lay.level[i])) match += 1;
  }
  check(pos > lay.count * 0.3 && neg > lay.count * 0.3, `layout level has both signs: ${pos} +, ${neg} - of ${lay.count}`);
  check(tested > lay.count * 0.9 && match === tested, `layout sign = impulse response sign at every tap (${match}/${tested})`);
  const { R } = ir(opts);
  let mR = 0, tR = 0;
  const atR = new Map();
  for (let i = 0; i < lay.countR; i += 1) { const k = Math.round(lay.posR[i] * FS); atR.set(k, (atR.get(k) || 0) + 1); }
  for (let i = 0; i < lay.countR; i += 1) {
    const k = Math.round(lay.posR[i] * FS);
    if (atR.get(k) !== 1 || R[k] === 0) continue;
    tR += 1;
    if (Math.sign(R[k]) === Math.sign(lay.levelR[i])) mR += 1;
  }
  check(lay.countR === lay.count && tR > lay.countR * 0.9 && mR === tR, `Right layout = Right impulse response (positions and signs, ${mR}/${tR})`);
  const mono = layout({ ...opts, spread: 0 });
  check(mono.posR.every((p, i) => p === mono.pos[i]) && mono.levelR.every((v, i) => v === mono.level[i]), "Spread 0: Right taps = Left taps (the face draws them white)");
}

// ---- Cell floor: taps that would bunch up are not used (fewer taps, never stacked)
{
  const floorOf = (w) => Math.max(4, w);
  for (const skew of [-0.9, -0.6, 0.6, 0.9]) {
    const lay = layout({ taps: 4096, decay: 0.05, skew, dark: 1 });
    let shared = 0, overlap = 0, close2 = 0;
    for (let i = 1; i < lay.count; i += 1) {
      const a = Math.round(lay.pos[i - 1] * FS), b = Math.round(lay.pos[i] * FS);
      if (b <= a) shared += 1;
      if (lay.pos[i] * FS < lay.pos[i - 1] * FS + Math.floor(lay.width[i - 1] * FS + 1e-9) - 1e-6) overlap += 1; // whole samples (a fractional end sample may touch the next start)
      // A whole cell lies between taps i-2 and i, so they are at least a floor apart.
      if (i >= 2 && b - Math.round(lay.pos[i - 2] * FS) < floorOf(1) - 1) close2 += 1;
    }
    check(lay.count < 4096 && (lay.flags & 4) && shared === 0 && overlap === 0 && close2 === 0,
      `Skew ${skew}, 4096 taps in 50 ms: ${lay.count} / 4096 taps play (flag ${lay.flags}), none share a sample (${shared}), none overlap (${overlap}), every cell >= the 4-sample floor (${close2} short)`);
  }
  const dense = layout({ taps: 64, decay: 0.025, skew: 0.9 });
  const plain = layout({ taps: 64, decay: 0.025, skew: 0 });
  check(dense.count < 64 && plain.count === 64 && !(plain.flags & 4), `Taps 64 / 25 ms: Skew 0.9 plays ${dense.count} / 64, Skew 0 all ${plain.count}`);
  // Smooth: the kept count moves continuously with Skew (the last tap fades in).
  let jump = 0, prevN = null;
  const counts = [];
  for (let k = 0; k <= 200; k += 1) {
    const lay = layout({ taps: 256, decay: 0.05, skew: -0.9 + k * 0.009 });
    counts.push(lay.count);
    if (prevN !== null) jump = Math.max(jump, Math.abs(lay.count - prevN));
    prevN = lay.count;
  }
  // Continuous, but steep near the ends (the curve itself is): no more than 3% of the taps per step.
  check(jump <= 8, `Skew -0.9..0.9 (256 taps, 50 ms): the played count steps by at most ${jump} per 0.009 (${Math.min(...counts)}..${Math.max(...counts)})`);
  const steps = [];
  let prev = null;
  for (let k = 0; k <= 100; k += 1) {
    const r = ir({ taps: 256, decay: 0.05, skew: 0.5 + k * 0.004, n: 3000 }).L;
    if (prev) steps.push(dist(prev, r));
    prev = r;
  }
  const med = [...steps].sort((p, q) => p - q)[steps.length >> 1];
  check(Math.max(...steps) < 6 * med + 1e-9, `audio: Skew 0.5..0.9 sweep through the thinning has no pop (largest step ${Math.max(...steps).toFixed(4)} vs median ${med.toFixed(4)})`);
  // Darker pulses need wider cells: Darkness 32 keeps fewer of the same taps.
  const dark = layout({ taps: 256, decay: 0.05, dark: 32 });
  check(dark.count < 256 && dark.count >= 70 && dark.count <= 80, `Darkness 32: 256 taps in 50 ms keep ${dark.count} (2400 samples / 32-sample cells = 75)`);
}

// ---- Min Gap (ms): least spacing between consecutive taps, taps that do not fit are not used
{
  const one = layout({ taps: 256, decay: 0.05, gap: 1 });
  let short2 = 0;
  for (let i = 2; i < one.count; i += 1) if ((one.pos[i] - one.pos[i - 2]) * FS < 48 - 1) short2 += 1;
  check(one.count === 50 && (one.flags & 4) && short2 === 0, `Min Gap 1 ms: 256 taps in 50 ms keep ${one.count} (2400 / 48 samples = 50), every cell >= 48 samples (${short2} short)`);
  const none = layout({ taps: 4096, decay: 0.05, gap: 0 });
  check(none.count === 2400, `Min Gap 0: the floor is the pulse (1 sample at Darkness 1): 4096 taps in 2400 samples keep ${none.count}`);
  const wide = layout({ taps: 256, decay: 0.05, gap: 0.1, dark: 32 });
  check(wide.count === 75, `Min Gap never below the pulse: 0.1 ms (4.8 samples) at Darkness 32 keeps ${wide.count} (32-sample cells = 75)`);
  const a = ir({ taps: 256, decay: 0.05, gap: 0.5, n: 3000 }).L, b = ir({ taps: 256, decay: 0.05, gap: 0.51, n: 3000 }).L, c = ir({ taps: 256, decay: 0.05, gap: 0.52, n: 3000 }).L;
  check(dist(a, b) > 0 && dist(a, b) < 3 * dist(b, c) + 1e-9 && dist(b, c) < 3 * dist(a, b) + 1e-9, `audio: Min Gap moves smoothly (0.50 -> 0.51 ${dist(a, b).toFixed(4)}, 0.51 -> 0.52 ${dist(b, c).toFixed(4)})`);
  const defs = fs.readFileSync(path.join(root, "public", "node-graph-module-definitions.js"), "utf8");
  const mg = defs.slice(defs.indexOf('key: "minGap",') - 60, defs.indexOf('key: "minGap",') + 320);
  check(/defaultValue: "1"/.test(mg) && /max: "10"/.test(mg) && /min: "0"/.test(mg) && /unit: "ms"/.test(mg), "Min Gap definition: 0..10 ms, default 1 ms");
  // Defaults everywhere (Taps 64, Length 25 ms, Min Gap 1 ms via NaN -> the native default): 1200 / 48 samples = 25 taps play.
  const dc = x.soemdsp_velvet_reverb_layout(64, 1, 1, FS, 0.025, 0, 1, -60, 0, NaN, 1);
  check(dc === 25 && (x.soemdsp_velvet_reverb_layout_flags() & 4), `default Taps 64 / Length 25 ms / Min Gap 1 ms: ${dc} / 64 taps play`);
}

// ---- Darkness spawn range: slider max 64, mid 2, mid-skew curve; hardMax 1024
{
  const defs = fs.readFileSync(path.join(root, "public", "node-graph-module-definitions.js"), "utf8");
  const dk = defs.slice(defs.indexOf('key: "darkness",'), defs.indexOf('key: "darkness",') + 280);
  const before = defs.slice(defs.indexOf('key: "darkness",') - 280, defs.indexOf('key: "darkness",'));
  check(/max: "64"/.test(dk) && /mid: "2"/.test(dk) && /sliderCurve: "skew"/.test(dk) && /hardMax: "1024"/.test(before) && /nonlinearSlider: true/.test(dk),
    "Darkness: spawn max 64, mid 2, mid-skew curve, hardMax 1024");
}

// ---- Tail Random: 0 = smooth monotonic widths along the tail; 1 = previous random widths
{
  const opts = { taps: 64, decay: 0.2, dark: 2, tail: 48, seed: 7, amp: 0, skew: 0, gap: 1 };
  const smooth = layout({ ...opts, tailRand: 0 });
  const random = layout({ ...opts, tailRand: 1 });
  const prev = layout({ ...opts }); // default tailRand 1
  check(smooth.count >= 2 && random.count >= 2, `Tail Random layouts play taps (0: ${smooth.count}, 1: ${random.count})`);
  let monoUp = true;
  for (let i = 1; i < smooth.count; i += 1) if (smooth.width[i] + 1e-15 < smooth.width[i - 1]) monoUp = false;
  const firstW = smooth.width[0] * FS, lastW = smooth.width[smooth.count - 1] * FS;
  check(monoUp && lastW > firstW + 1, `Tail Random 0: widths are smooth and increase along the tail (${firstW.toFixed(2)} -> ${lastW.toFixed(2)} smp, ${smooth.count} taps)`);
  const uniq = new Set(random.width.map((w) => w.toFixed(9))).size;
  check(uniq > 8, `Tail Random 1: per-tap widths still vary (${uniq} distinct widths of ${random.count})`);
  check(random.width.every((w, i) => w === prev.width[i]) && random.count === prev.count, "Tail Random 1 matches the previous (default) layout");
  const a = ir({ ...opts, tailRand: 1, n: 12000 }).L, b = ir({ ...opts, n: 12000 }).L, c = ir({ ...opts, tailRand: 0, n: 12000 }).L;
  check(dist(a, b) === 0, "Tail Random 1 matches previous audio (default)");
  check(dist(a, c) > 1e-6, `Tail Random 0 differs from the previous random tail (dist ${dist(a, c).toFixed(4)})`);
}

// ---- Tail Curve: log-width Darkness->Tail Dark sweep, Step Graph rational bend
{
  const opts = { taps: 64, decay: 0.2, dark: 2, tail: 48, seed: 7, amp: 0, skew: 0, gap: 1, tailRand: 0 };
  const mid = layout({ ...opts, tailCurve: 0 });
  const plus = layout({ ...opts, tailCurve: 0.8 });
  const minus = layout({ ...opts, tailCurve: -0.8 });
  const firstW = mid.width[0] * FS, lastW = mid.width[mid.count - 1] * FS;
  check(Math.abs(firstW - 2) < 1e-9, `Tail Curve 0: first width is Darkness (${firstW.toFixed(4)} smp)`);
  check(lastW > 40 && lastW <= 48 + 1e-9, `Tail Curve 0: last width approaches Tail Dark (${lastW.toFixed(2)} smp, target 48)`);
  const mono = (lay, up) => {
    for (let i = 1; i < lay.count; i += 1) {
      if (up && lay.width[i] + 1e-15 < lay.width[i - 1]) return false;
      if (!up && lay.width[i] > lay.width[i - 1] + 1e-15) return false;
    }
    return lay.count >= 2;
  };
  check(mono(mid, true) && mono(plus, true) && mono(minus, true), `Tail Curve: widths stay monotonic 2 -> 48 at 0 / +0.8 / -0.8 (${mid.count}/${plus.count}/${minus.count} taps)`);
  const down = layout({ ...opts, dark: 48, tail: 2, tailCurve: 0 });
  check(mono(down, false) && Math.abs(down.width[0] * FS - 48) < 1e-9, `Tail Curve 0: a falling sweep is monotonic and starts at Darkness (${(down.width[0] * FS).toFixed(2)} -> ${(down.width[down.count - 1] * FS).toFixed(2)} smp)`);
  // Mid-tail width at curve 0 is the geometric mean (log-domain), not the arithmetic mean.
  const midIdx = Math.floor(mid.count / 2);
  const midW = mid.width[midIdx] * FS;
  const geo = Math.sqrt(2 * 48);
  const arith = 0.5 * (2 + 48);
  check(Math.abs(midW - geo) < 3 && Math.abs(midW - arith) > 8, `Tail Curve 0: mid-tail width is geometric (${midW.toFixed(2)} smp, geo ${geo.toFixed(2)}, arith ${arith.toFixed(1)})`);
  // Positive curve raises mid-segment weight (Step Graph sign): mid width is closer to Tail Dark.
  const plusW = plus.width[Math.floor(plus.count / 2)] * FS;
  const minusW = minus.width[Math.floor(minus.count / 2)] * FS;
  check(plusW > midW + 1 && midW > minusW + 1, `Tail Curve sign: +0.8 mid ${plusW.toFixed(2)} > 0 mid ${midW.toFixed(2)} > -0.8 mid ${minusW.toFixed(2)} ( + reaches Tail Dark sooner )`);
  // Tail Random 0: every width sits on the curve (no scatter around the maxWidth).
  const scatter = layout({ ...opts, tailRand: 1, tailCurve: 0 });
  const uniqSmooth = new Set(mid.width.map((w) => w.toFixed(9))).size;
  const uniqRand = new Set(scatter.width.map((w) => w.toFixed(9))).size;
  check(uniqSmooth >= mid.count - 1 && uniqRand > 8, `Tail Random 0 + Tail Curve 0: widths stay on the curve (${uniqSmooth} distinct of ${mid.count}); random still varies (${uniqRand})`);
  const defs = fs.readFileSync(path.join(root, "public", "node-graph-module-definitions.js"), "utf8");
  const i = defs.indexOf('key: "tailCurve",');
  const tc = defs.slice(i - 80, i + 280);
  check(/defaultValue: "0"/.test(tc) && /max: "1"/.test(tc) && /min: "-1"/.test(tc) && /sliderCurve: "bipolarRational"/.test(tc) && /curveAmount: "-0.9",/.test(tc),
    "Tail Curve definition: -1..+1, default 0, bipolar rational knob (amount -0.9)");
}

// ---- 6 s Length (the definition max): the delay line is sized from the sample rate, so it always fits
{
  const defs = fs.readFileSync(path.join(root, "public", "node-graph-module-definitions.js"), "utf8");
  const vr = defs.slice(defs.indexOf("\n  velvetReverb: {"));
  const dec = vr.slice(vr.indexOf('key: "decay",') - 200, vr.indexOf('key: "decay",') + 400);
  const defMax = Number(/max: "([^"]+)"/.exec(dec.slice(dec.indexOf('key: "decay",')))?.[1]);
  check(defMax === 6 && x.soemdsp_velvet_reverb_max_length() === defMax, `Length definition max ${defMax} s = the delay line's design length ${x.soemdsp_velvet_reverb_max_length()} s`);
  const fits = [44100, 48000, 96000, 192000].map((sr) => {
    const count = x.soemdsp_velvet_reverb_layout(64, 1024, 1, sr, 6, 1024, 1, -60, 0, 1, 1);
    return [sr, count, x.soemdsp_velvet_reverb_layout_length(), x.soemdsp_velvet_reverb_layout_flags()];
  });
  check(fits.every(([, c, len, fl]) => c === 64 && Math.abs(len - 6) < 1e-9 && fl === 0), `6 s with the widest pulses (Darkness / Tail Darkness 1024) fits unflagged at ${fits.map(([sr, c, len, fl]) => `${sr / 1000} kHz (${c} taps, ${len} s, flags ${fl})`).join(", ")}`);
  const mb = (sr) => x.soemdsp_velvet_reverb_block_bytes(sr) / 1e6;
  console.log(`     memory per instance: ${mb(44100).toFixed(1)} MB at 44.1 kHz, ${mb(48000).toFixed(1)} MB at 48 kHz, ${mb(96000).toFixed(1)} MB at 96 kHz, ${mb(192000).toFixed(1)} MB at 192 kHz`);
  check(mb(96000) < 2.1 * mb(48000) && mb(48000) < 13, `memory follows the sample rate (${mb(48000).toFixed(1)} / ${mb(96000).toFixed(1)} MB at 48 / 96 kHz)`);
  // The audio holds a tap near 6 s: impulse response energy right before the end.
  const { L } = ir({ taps: 64, decay: 6, amp: 0, n: 6 * FS + 2048 });
  let last = 0;
  for (let i = 0; i < L.length; i += 1) if (L[i] !== 0) last = i;
  check(last / FS > 5.75 && last / FS <= 6 + 0.01, `audio: the last tap of a 6 s tail plays at ${(last / FS).toFixed(3)} s`);
  // A 96 kHz instance holds 6 s too (the line grows with the rate it is created at).
  const h = x.soemdsp_velvet_reverb_create(96000);
  let lastHi = 0;
  for (let i = 0; i < 6 * 96000 + 4096; i += 1) {
    const v = i === 0 ? 1 : 0;
    const o = x.soemdsp_velvet_reverb_sample(h, v, v, 32, 1, 1, 1, 96000, 6, 0, 0, 0, 1, 1);
    if (o !== 0) lastHi = i;
  }
  x.soemdsp_velvet_reverb_destroy(h);
  check(lastHi / 96000 > 5.5 && lastHi / 96000 <= 6.01, `96 kHz: the last tap of a 6 s tail plays at ${(lastHi / 96000).toFixed(3)} s`);
}

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log("all velvet reverb checks passed");