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
check(x.soemdsp_velvet_reverb_version() >= 5, `velvet_reverb version ${x.soemdsp_velvet_reverb_version()}`);

// Wet impulse response (Mix 1): impulse on both channels at sample 0.
const tapsOf = ({ taps, density, decay = 0.025 }) => taps ?? (density ?? 2500) * decay;
function ir({ taps, density, dark = 1, spread = 1, decay = 0.025, tail = 0, seed = 1, amp = -60, skew = 0, n } = {}) {
  const T = tapsOf({ taps, density, decay });
  const h = x.soemdsp_velvet_reverb_create();
  if (!h) throw new Error("create failed");
  x.soemdsp_velvet_reverb_set_seed(h, seed);
  const len = n ?? Math.ceil(decay * FS) + 2048;
  const L = new Float64Array(len), R = new Float64Array(len);
  for (let i = 0; i < len; i += 1) {
    const v = i === 0 ? 1 : 0;
    L[i] = x.soemdsp_velvet_reverb_sample(h, v, v, T, dark, spread, 1, FS, decay, tail, amp, skew);
    R[i] = x.soemdsp_velvet_reverb_right(h);
  }
  x.soemdsp_velvet_reverb_destroy(h);
  return { L, R };
}
function layout({ taps, density, dark = 1, spread = 1, decay = 0.025, tail = 0, seed = 1, amp = -60, skew = 0 } = {}) {
  const count = x.soemdsp_velvet_reverb_layout(tapsOf({ taps, density, decay }), dark, spread, FS, decay, tail, seed, amp, skew);
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
  check(counts.every(([want, got]) => got === Math.ceil(want - 1e-9)), `tap count = ceil(Taps) at any Length: ${counts.map(([w, g]) => `${w}->${g}`).join(", ")}`);
  const a = nonzeroStarts(ir({ taps: 80, decay: 0.2, dark: 1 }).L), b = nonzeroStarts(ir({ taps: 80, decay: 2, dark: 1, n: 2 * FS + 2048 }).L);
  check(Math.abs(a - 80) <= 3 && Math.abs(b - 80) <= 3, `Length does not add taps: 80 taps -> ${a} onsets over 0.2 s, ${b} over 2 s`);
  const lay = layout({ taps: 20000, decay: 1 });
  check(lay.count === x.soemdsp_velvet_reverb_max_taps() && (lay.flags & 1), `past the engine's ${x.soemdsp_velvet_reverb_max_taps()} taps the layout says so (count ${lay.count}, flags ${lay.flags})`);
  const lay2 = layout({ taps: 100, decay: 10 });
  check((lay2.flags & 2) && lay2.length < 5.5 && lay2.length > 5.4, `a Length past the delay line is held there and flagged (${lay2.length.toFixed(3)} s, flags ${lay2.flags})`);
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

// ---- Density Skew: Step Graph rational warp of the positions, count unchanged
{
  const meanPos = (skew) => { const l = layout({ taps: 200, decay: 1, skew }); return [l.count, l.pos.reduce((p, q) => p + q, 0) / l.count / l.length]; };
  const [c0, m0] = meanPos(0), [cp, mp] = meanPos(0.6), [cn, mn] = meanPos(-0.6);
  check(c0 === 200 && cp === 200 && cn === 200, `Density Skew leaves the tap count alone (${c0}, ${cp}, ${cn})`);
  check(Math.abs(m0 - 0.5) < 0.03 && mp < 0.4 && mn > 0.6, `+ packs taps toward the start, - toward the end: mean position ${mp.toFixed(3)} / ${m0.toFixed(3)} / ${mn.toFixed(3)} of Length`);
  const l1 = layout({ taps: 100, decay: 0.5, skew: 0.5 }), l2 = layout({ taps: 100, decay: 0.5, skew: 0.5, amp: 0 });
  check(l1.pos.every((p, i) => p === l2.pos[i]), "Density Skew and Amp Decay are independent (same positions at any Amp Decay)");
  let prev = null, maxMove = 0;
  // The rational curve's ends (+-1) pack every tap onto the start / the end, so
  // the last steps there are steep; smoothness is checked over -0.9 .. +0.9.
  for (let k = 0; k <= 90; k += 1) {
    const l = layout({ taps: 64, decay: 0.2, skew: -0.9 + k * 0.02 });
    if (prev) for (let i = 0; i < l.count; i += 1) maxMove = Math.max(maxMove, Math.abs(l.pos[i] - prev.pos[i]));
    prev = l;
  }
  check(maxMove < 0.2 / 6, `Skew sweep -0.9..+0.9 in 0.02 steps moves taps smoothly (largest move ${(maxMove * 1000).toFixed(2)} ms)`);
  const e1 = layout({ taps: 64, decay: 0.2, skew: 1 }), e0 = layout({ taps: 64, decay: 0.2, skew: -1 });
  check(e1.count === 64 && e0.count === 64 && e1.pos.every((q) => q < 0.001) && e0.pos.every((q) => q > 0.199 - 1 / FS), `Skew +1 / -1 = the curve's ends: all 64 taps at the start / the end`);
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
    const h = x.soemdsp_velvet_reverb_create(); x.soemdsp_velvet_reverb_set_seed(h, 3);
    let e = 0;
    for (let i = 0; i < input.length; i += 1) { const v = x.soemdsp_velvet_reverb_sample(h, input[i], input[i], 256, dark, 1, 1, FS, 0.1, 0, -60, 0); if (i > FS / 4) e += v * v; }
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

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log("all velvet reverb checks passed");