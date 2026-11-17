// Dark Velvet Reverb display levels: peak-hold of |width-filtered pulse
// x gain x table norm| per tap, L and R, taken by soemdsp_velvet_reverb_take_levels.
//   node scripts/test_velvet_reverb_tap_levels.mjs
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
check(typeof x.soemdsp_velvet_reverb_set_display === "function", "set_display is exported");
check(typeof x.soemdsp_velvet_reverb_take_levels === "function", "take_levels is exported");
check(x.soemdsp_velvet_reverb_version() >= 10, `velvet_reverb version ${x.soemdsp_velvet_reverb_version()}`);

const OPTS = { taps: 8, dark: 1, spread: 1, mix: 1, decay: 0.05, tail: 0, amp: -60, skew: 0, gap: 1, tailRand: 0, tailCurve: 0, seed: 1 };

function sample(h, inL, inR, o = OPTS) {
  return x.soemdsp_velvet_reverb_sample(h, inL, inR, o.taps, o.dark, o.spread, o.mix, FS, o.decay, o.tail, o.amp, o.skew, o.gap, o.tailRand, o.tailCurve);
}

function take(h) {
  const nL = x.soemdsp_velvet_reverb_take_levels(h) | 0;
  const nR = x.soemdsp_velvet_reverb_levels_count_r() | 0;
  const L = nL ? new Float64Array(x.memory.buffer, x.soemdsp_velvet_reverb_levels_l(), nL).slice() : new Float64Array(0);
  const R = nR ? new Float64Array(x.memory.buffer, x.soemdsp_velvet_reverb_levels_r(), nR).slice() : new Float64Array(0);
  return { L, R };
}

function layout(o = OPTS) {
  const count = x.soemdsp_velvet_reverb_layout(o.taps, o.dark, o.spread, FS, o.decay, o.tail, o.seed, o.amp, o.skew, o.gap, o.tailRand, o.tailCurve);
  const pos = new Float64Array(x.memory.buffer, x.soemdsp_velvet_reverb_layout_pos(), count).slice();
  const countR = x.soemdsp_velvet_reverb_layout_count_r();
  const posR = new Float64Array(x.memory.buffer, x.soemdsp_velvet_reverb_layout_pos_r(), countR).slice();
  return { count, pos, countR, posR };
}

function create() {
  const h = x.soemdsp_velvet_reverb_create(FS);
  if (!h) throw new Error("create failed");
  x.soemdsp_velvet_reverb_set_seed(h, OPTS.seed);
  return h;
}

const peak = (a) => { let m = 0; for (let i = 0; i < a.length; i += 1) m = Math.max(m, a[i]); return m; };
const starts = (pos) => Array.from(pos, (p) => Math.round(p * FS));

// ---- Zero input gives zero levels (display on)
{
  const h = create();
  x.soemdsp_velvet_reverb_set_display(h, 1);
  for (let i = 0; i < 4000; i += 1) sample(h, 0, 0);
  const lv = take(h);
  check(lv.L.length > 0 && lv.R.length > 0, `zero input: took ${lv.L.length} L / ${lv.R.length} R taps`);
  check(peak(lv.L) === 0 && peak(lv.R) === 0, `zero input: levels are 0 (L ${peak(lv.L)}, R ${peak(lv.R)})`);
  x.soemdsp_velvet_reverb_destroy(h);
}

// ---- Display off does not accumulate
{
  const h = create();
  x.soemdsp_velvet_reverb_set_display(h, 0);
  sample(h, 1, 1);
  for (let i = 1; i < 4000; i += 1) sample(h, 0, 0);
  const lv = take(h);
  check(peak(lv.L) === 0 && peak(lv.R) === 0, `display off: impulse leaves levels at 0 (L ${peak(lv.L)}, R ${peak(lv.R)})`);
  x.soemdsp_velvet_reverb_destroy(h);
}

// ---- Impulse on L only: L lights, R stays 0 (spread 1, independent lines)
{
  const h = create();
  x.soemdsp_velvet_reverb_set_display(h, 1);
  sample(h, 1, 0);
  for (let i = 1; i < 4000; i += 1) sample(h, 0, 0);
  const lv = take(h);
  check(peak(lv.L) > 1e-6, `impulse L: Left peak ${peak(lv.L).toExponential(2)}`);
  check(peak(lv.R) === 0, `impulse L: Right stays 0 (got ${peak(lv.R)})`);
  x.soemdsp_velvet_reverb_destroy(h);
}

// ---- Impulse on R only: R lights, L stays 0
{
  const h = create();
  x.soemdsp_velvet_reverb_set_display(h, 1);
  sample(h, 0, 1);
  for (let i = 1; i < 4000; i += 1) sample(h, 0, 0);
  const lv = take(h);
  check(peak(lv.R) > 1e-6, `impulse R: Right peak ${peak(lv.R).toExponential(2)}`);
  check(peak(lv.L) === 0, `impulse L silent: Left stays 0 (got ${peak(lv.L)})`);
  x.soemdsp_velvet_reverb_destroy(h);
}

// ---- Levels respond in tap order (later taps light later)
{
  const lay = layout();
  const startL = starts(lay.pos);
  check(lay.count >= 3, `layout has ${lay.count} L taps for order test`);
  const first = startL[0];
  const midI = Math.floor((lay.count - 1) / 2);
  const mid = startL[midI];
  const last = startL[lay.count - 1];
  check(mid > first + 2 && last > mid + 2, `taps are spaced: first=${first} mid[${midI}]=${mid} last=${last}`);

  const h = create();
  x.soemdsp_velvet_reverb_set_display(h, 1);
  sample(h, 1, 0); // impulse at sample 0
  const untilFirst = Math.min(first + 2, mid - 1);
  for (let i = 1; i < untilFirst; i += 1) sample(h, 0, 0);
  const early = take(h);
  const earlyLit = [];
  const earlyQuiet = [];
  for (let i = 0; i < early.L.length; i += 1) {
    if (startL[i] <= untilFirst - 1) { if (!(early.L[i] > 1e-9)) earlyQuiet.push(i); }
    else if (startL[i] > untilFirst) { if (early.L[i] > 1e-12) earlyLit.push(i); }
  }
  check(earlyQuiet.length === 0, `after sample ${untilFirst}: early taps have lit (${earlyQuiet.length} missed)`);
  check(earlyLit.length === 0, `after sample ${untilFirst}: later taps still quiet (lit ${earlyLit.join(",") || "none"})`);

  for (let i = untilFirst; i < mid + 2; i += 1) sample(h, 0, 0);
  const middle = take(h);
  check(!(early.L[0] > 0) || middle.L[0] === 0, "take_levels clears a spent early peak");
  check(middle.L[midI] > 1e-9, `mid tap ${midI} (start ${mid}) lit after sample ${mid + 2}: ${middle.L[midI]}`);
  const stillLate = [];
  for (let i = 0; i < middle.L.length; i += 1) {
    if (startL[i] > mid + 2 && middle.L[i] > 1e-12) stillLate.push(i);
  }
  check(stillLate.length === 0, `after mid window: later taps still quiet (lit ${stillLate.join(",") || "none"})`);

  for (let i = mid + 2; i < last + 4; i += 1) sample(h, 0, 0);
  const late = take(h);
  check(late.L[lay.count - 1] > 1e-9, `last tap lit after sample ${last + 4}: ${late.L[lay.count - 1]}`);
  x.soemdsp_velvet_reverb_destroy(h);
}

if (failed) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log("all tap-level checks passed");
