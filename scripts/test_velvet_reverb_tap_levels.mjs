// Dark Velvet Reverb display levels: peak-hold of |width-filtered pulse
// x gain x table norm| per tap, L and R, taken by soemdsp_velvet_reverb_take_levels.
// The face treats a peak above NODE_GRAPH_VELVET_TAP_TRIGGER_LEVEL (-90 dB)
// as a binary trigger: it pops on the next paint, holds for the snapshot
// period, and goes dark promptly after a later quiet snapshot has been seen.
//   node scripts/test_velvet_reverb_tap_levels.mjs
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;
const check = (ok, msg) => { if (!ok) { failed += 1; console.error("FAIL", msg); } else console.log("ok  ", msg); };

const faceSrc = fs.readFileSync(path.join(root, "public", "node-graph-velvet-taps-display.js"), "utf8");
const armStart = faceSrc.indexOf("const NODE_GRAPH_VELVET_TAP_TRIGGER_LEVEL");
const armEnd = faceSrc.indexOf("nodeGraphVelvetTapsInstallIngestArm();");
if (armStart < 0 || armEnd < 0) throw new Error("could not extract tap-trigger helpers from the face");
const latch = { Map, Uint8Array, Float32Array, Math, Number, String };
vm.runInNewContext(
  faceSrc.slice(armStart, armEnd) + `
    this.NODE_GRAPH_VELVET_TAP_TRIGGER_LEVEL = NODE_GRAPH_VELVET_TAP_TRIGGER_LEVEL;
    this.nodeGraphVelvetTapsTriggerState = nodeGraphVelvetTapsTriggerState;
    this.nodeGraphVelvetTapsApplySnapshot = nodeGraphVelvetTapsApplySnapshot;
    this.nodeGraphVelvetTapsTakeLit = nodeGraphVelvetTapsTakeLit;
  `,
  latch,
);

const TRIGGER = latch.NODE_GRAPH_VELVET_TAP_TRIGGER_LEVEL;
check(Number.isFinite(TRIGGER) && Math.abs(TRIGGER - Math.pow(10, -90 / 20)) < 1e-12, `trigger threshold is -90 dB (${TRIGGER})`);

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

const on = (v) => v > TRIGGER;
const anyOn = (a) => { for (let i = 0; i < a.length; i += 1) if (on(a[i])) return true; return false; };
const starts = (pos) => Array.from(pos, (p) => Math.round(p * FS));

// ---- Zero input stays off
{
  const h = create();
  x.soemdsp_velvet_reverb_set_display(h, 1);
  for (let i = 0; i < 4000; i += 1) sample(h, 0, 0);
  const lv = take(h);
  check(lv.L.length > 0 && lv.R.length > 0, `zero input: took ${lv.L.length} L / ${lv.R.length} R taps`);
  check(!anyOn(lv.L) && !anyOn(lv.R), "zero input: every tap is below the -90 dB trigger");
  x.soemdsp_velvet_reverb_destroy(h);
}

// ---- Display off does not accumulate
{
  const h = create();
  x.soemdsp_velvet_reverb_set_display(h, 0);
  sample(h, 1, 1);
  for (let i = 1; i < 4000; i += 1) sample(h, 0, 0);
  const lv = take(h);
  check(!anyOn(lv.L) && !anyOn(lv.R), "display off: impulse stays below the trigger");
  x.soemdsp_velvet_reverb_destroy(h);
}

// ---- Impulse on L only: L on, R off (spread 1, independent lines)
{
  const h = create();
  x.soemdsp_velvet_reverb_set_display(h, 1);
  sample(h, 1, 0);
  for (let i = 1; i < 4000; i += 1) sample(h, 0, 0);
  const lv = take(h);
  check(anyOn(lv.L), "impulse L: at least one Left tap is on");
  check(!anyOn(lv.R), "impulse L: every Right tap stays off");
  x.soemdsp_velvet_reverb_destroy(h);
}

// ---- Impulse on R only: R on, L off
{
  const h = create();
  x.soemdsp_velvet_reverb_set_display(h, 1);
  sample(h, 0, 1);
  for (let i = 1; i < 4000; i += 1) sample(h, 0, 0);
  const lv = take(h);
  check(anyOn(lv.R), "impulse R: at least one Right tap is on");
  check(!anyOn(lv.L), "impulse R: every Left tap stays off");
  x.soemdsp_velvet_reverb_destroy(h);
}

// ---- Triggers respond in tap order (later taps light later)
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
  const earlyMissed = [];
  const earlyLate = [];
  for (let i = 0; i < early.L.length; i += 1) {
    if (startL[i] <= untilFirst - 1) { if (!on(early.L[i])) earlyMissed.push(i); }
    else if (startL[i] > untilFirst) { if (on(early.L[i])) earlyLate.push(i); }
  }
  check(earlyMissed.length === 0, `after sample ${untilFirst}: early taps are on (${earlyMissed.length} missed)`);
  check(earlyLate.length === 0, `after sample ${untilFirst}: later taps still off (on ${earlyLate.join(",") || "none"})`);

  for (let i = untilFirst; i < mid + 2; i += 1) sample(h, 0, 0);
  const middle = take(h);
  check(!on(middle.L[0]), "take_levels clears a spent early peak (first tap off)");
  check(on(middle.L[midI]), `mid tap ${midI} (start ${mid}) is on after sample ${mid + 2}`);
  const stillLate = [];
  for (let i = 0; i < middle.L.length; i += 1) {
    if (startL[i] > mid + 2 && on(middle.L[i])) stillLate.push(i);
  }
  check(stillLate.length === 0, `after mid window: later taps still off (on ${stillLate.join(",") || "none"})`);

  for (let i = mid + 2; i < last + 4; i += 1) sample(h, 0, 0);
  const late = take(h);
  check(on(late.L[lay.count - 1]), `last tap is on after sample ${last + 4}`);
  x.soemdsp_velvet_reverb_destroy(h);
}

// ---- Snapshot-period latch (face helpers): pop, hold, then prompt off
{
  const apply = (id, side, levels) => latch.nodeGraphVelvetTapsApplySnapshot(
    latch.nodeGraphVelvetTapsTriggerState(id),
    side,
    levels,
  );
  const take = (id, rawL, rawR, nL, nR, armFromBus) => latch.nodeGraphVelvetTapsTakeLit(
    id, rawL, rawR, nL, nR, armFromBus,
  );

  const idArm = "hold-threshold";
  apply(idArm, "L", [0, TRIGGER * 2, TRIGGER * 0.5]);
  const armed = take(idArm, null, null, 3, 0, false);
  check(armed.onL[0] === 0 && armed.onL[1] === 1 && armed.onL[2] === 0, "apply: only peaks above -90 dB light the latch");

  // Paints faster than snapshots: stay bright for the whole snapshot period
  const idHold = "hold-same-snap";
  const snap = new Float32Array([0, TRIGGER * 2, 0]);
  apply(idHold, "L", snap);
  const first = take(idHold, snap, null, 3, 0, false);
  const second = take(idHold, snap, null, 3, 0, false);
  check(first.onL[1] === 1 && second.onL[1] === 1, "paints faster than snapshots: hit stays bright (no strobe)");

  const quiet = new Float32Array([0, 0, 0]);
  apply(idHold, "L", quiet);
  const afterQuiet = take(idHold, quiet, null, 3, 0, false);
  check(afterQuiet.onL[1] === 0, "quiet snapshot after a shown hit goes dark promptly");

  // Quiet snapshot arrives before any paint: still one bright paint
  const idGap = "hold-pre-paint-quiet";
  apply(idGap, "L", snap);
  apply(idGap, "L", quiet);
  const guaranteed = take(idGap, quiet, null, 3, 0, false);
  check(guaranteed.onL[1] === 1, "quiet snapshot before the first paint still gets one bright paint");
  const afterGap = take(idGap, quiet, null, 3, 0, false);
  check(afterGap.onL[1] === 0, "after that guaranteed paint the tap goes idle");

  apply(idGap, "L", snap);
  const retrigger = take(idGap, snap, null, 3, 0, false);
  check(retrigger.onL[1] === 1, "a later energy snapshot pops bright again");

  // Draw-time fallback: same array identity must not strobe off
  const idBus = "bus-fallback-hold";
  const snapB = new Float32Array([0, TRIGGER * 2, 0]);
  const litA = take(idBus, snapB, null, 3, 0, true);
  const litB = take(idBus, snapB, null, 3, 0, true);
  check(litA.onL[1] === 1 && litB.onL[1] === 1, "draw-time fallback: same snapshot stays bright (no strobe)");
  const snapQuiet = new Float32Array([0, 0, 0]);
  const litC = take(idBus, snapQuiet, null, 3, 0, true);
  check(litC.onL[1] === 0, "draw-time fallback: a later quiet snapshot goes dark after being shown");
  const snap2 = new Float32Array([0, TRIGGER * 2, 0]);
  const litD = take(idBus, snap2, null, 3, 0, true);
  check(litD.onL[1] === 1, "draw-time fallback: a new energy snapshot pops bright again");

  // A new quiet snapshot before the first paint of a retrigger still flashes once
  const idAgain = "hold-retrigger-gap";
  apply(idAgain, "L", snap);
  take(idAgain, snap, null, 3, 0, false);
  apply(idAgain, "L", quiet);
  take(idAgain, quiet, null, 3, 0, false);
  apply(idAgain, "L", snap);
  apply(idAgain, "L", quiet);
  const gap2 = take(idAgain, quiet, null, 3, 0, false);
  check(gap2.onL[1] === 1, "retrigger: quiet before the first paint still gets one bright paint");
  const gap2After = take(idAgain, quiet, null, 3, 0, false);
  check(gap2After.onL[1] === 0, "retrigger: goes idle after that guaranteed paint");

  // L/R independent latch
  const idLR = "hold-lr";
  apply(idLR, "L", [TRIGGER * 2, 0, 0]);
  apply(idLR, "R", [0, TRIGGER * 2, 0]);
  const sides = take(idLR, null, null, 3, 3, false);
  check(sides.onL[0] === 1 && sides.onL[1] === 0, "latch L is independent of R");
  check(sides.onR[1] === 1 && sides.onR[0] === 0, "latch R is independent of L");
}

// ---- Device-pixel coverage spans (subpixel AA) and stackable add-alpha
{
  const covStart = faceSrc.indexOf("const NODE_GRAPH_VELVET_TAP_IDLE_ALPHA");
  const covEnd = faceSrc.indexOf("function drawNodeGraphVelvetTapsDisplay");
  if (covStart < 0 || covEnd < 0) throw new Error("could not extract coverage helpers from the face");
  const cov = { Math };
  vm.runInNewContext(
    faceSrc.slice(covStart, covEnd) + `
      this.NODE_GRAPH_VELVET_TAP_IDLE_ALPHA = NODE_GRAPH_VELVET_TAP_IDLE_ALPHA;
      this.NODE_GRAPH_VELVET_TAP_ON_ALPHA = NODE_GRAPH_VELVET_TAP_ON_ALPHA;
      this.NODE_GRAPH_VELVET_TAP_ON_LIFT = NODE_GRAPH_VELVET_TAP_ON_LIFT;
      this.nodeGraphVelvetTapsAxisSpans = nodeGraphVelvetTapsAxisSpans;
      this.nodeGraphVelvetTapsDarknessShade = nodeGraphVelvetTapsDarknessShade;
      this.nodeGraphVelvetTapsShade = nodeGraphVelvetTapsShade;
    `,
    cov,
  );
  const idleA = cov.NODE_GRAPH_VELVET_TAP_IDLE_ALPHA;
  const onA = cov.NODE_GRAPH_VELVET_TAP_ON_ALPHA;
  check(idleA >= 0.85 && idleA <= 1, `idle alpha ${idleA} is near the pre-animation solid look`);
  check(onA === 1 && onA >= idleA, `triggered alpha ${onA} is full/opaque`);
  check(idleA * 2 >= 1, `two idle overlaps reach a burst (2 x ${idleA} = ${idleA * 2})`);

  const dim = cov.nodeGraphVelvetTapsDarknessShade;
  const d1 = dim(1 / 48000, 48000);
  const d2 = dim(2 / 48000, 48000);
  const d3 = dim(3 / 48000, 48000);
  const d4 = dim(4 / 48000, 48000);
  const d8 = dim(8 / 48000, 48000);
  check(d1 === 1, `width 1 sample is full brightness (${d1})`);
  check(d2 > d3 && d3 > d4 && d4 > d8 && d8 === 0.2, `darkness dim is monotonic and floors at 0.2 (${d2} > ${d3} > ${d4} > ${d8})`);

  const ink = [0.8, 0.15, 0.15, 1];
  const idle1 = cov.nodeGraphVelvetTapsShade(ink, 1, false);
  const idle2 = cov.nodeGraphVelvetTapsShade(ink, d2, false);
  const idle4 = cov.nodeGraphVelvetTapsShade(ink, d4, false);
  const on1 = cov.nodeGraphVelvetTapsShade(ink, 1, true);
  const onDark = cov.nodeGraphVelvetTapsShade(ink, d8, true);
  check(idle1[0] === ink[0] && idle1[3] === idleA, "idle width-1 uses full channel ink at idle alpha");
  check(idle2[0] < idle1[0] && idle4[0] < idle2[0], "idle rgb follows the monotonic darkness shade");
  check(on1[0] > idle1[0] && on1[3] === 1, "triggered width-1 is brighter (lifted toward white) than idle");
  check(onDark[0] === on1[0] && onDark[0] > idle4[0], "triggered wide taps also lift to the same near-white channel colour");

  const spans = cov.nodeGraphVelvetTapsAxisSpans;
  const compact = (s) => s.map((x) => `${x.p}:${x.c.toFixed(4)}x${x.w}`).join(",");
  let s = spans(0.25, 0.75, 1);
  check(s.length === 1 && s[0].p === 0 && s[0].w === 1 && s[0].c === 1, `sub-pixel width 0.5 is a 1 px bar at full coverage (${compact(s)})`);
  s = spans(10.1, 10.3, 1);
  check(s.length === 1 && s[0].p === 10 && s[0].c === 1 && s[0].w === 1, `sub-pixel bar is centred on the exact position (${compact(s)})`);
  s = spans(0, 2);
  check(s.length === 2 && s[0].c === 1 && s[1].c === 1 && s[0].p === 0 && s[1].p === 1, `exact 2 px span is two full pixels (${compact(s)})`);
  s = spans(0.25, 2.25);
  check(
    s.length === 3 && s[0].p === 0 && Math.abs(s[0].c - 0.75) < 1e-12 && s[1].p === 1 && s[1].c === 1 && s[1].w === 1 && s[2].p === 2 && Math.abs(s[2].c - 0.25) < 1e-12,
    `fractional edges get partial coverage (${compact(s)})`,
  );
  const fwd = compact(spans(1.2, 4.6));
  const rev = compact(spans(4.6, 1.2));
  check(fwd === rev && fwd.length > 0, "coverage spans are independent of endpoint order");
  check(spans(1, 1).length === 0, "a zero-width span is empty");

  // Without minFull, a sub-pixel span still reports fractional coverage (height AA).
  const rawH = spans(0.25, 0.75);
  check(rawH.length === 1 && Math.abs(rawH[0].c - 0.5) < 1e-12, "height axis still uses coverage-weighted alpha");

  // Same 1-sample pulse at Length 25 ms vs 6 s: on-screen width shrinks, coverage stays 1.
  const pulse = 1 / 48000;
  const spanPx = 300 * 2; // CSS width x dpr, in device pixels
  const deviceSpan = (length, pos, width) => {
    const xa = (pos / length) * spanPx;
    const xb = ((pos + width) / length) * spanPx;
    return spans(xa, xb, 1);
  };
  const w25 = pulse / 0.025 * spanPx;
  const w6 = pulse / 6 * spanPx;
  check(w25 < 1 && w6 < 1 && w6 < w25, `1-sample tap is sub-pixel at 25 ms (${w25.toFixed(4)} px) and dimmer-narrow at 6 s (${w6.toFixed(4)} px)`);
  const a25 = deviceSpan(0.025, 0.01, pulse);
  const a6 = deviceSpan(6, 0.01, pulse);
  const shade = cov.nodeGraphVelvetTapsDarknessShade(pulse, 48000);
  check(shade === 1, "darkness shade of a 1-sample pulse does not depend on Length");
  check(a25.length === 1 && a25[0].c === 1 && a25[0].w === 1, `25 ms isolated tap is a 1 px bar at full coverage (${compact(a25)})`);
  check(a6.length === 1 && a6[0].c === 1 && a6[0].w === 1, `6 s isolated tap is a 1 px bar at full coverage (${compact(a6)})`);
  const idle25 = cov.nodeGraphVelvetTapsShade(ink, shade, false);
  const idle6 = cov.nodeGraphVelvetTapsShade(ink, shade, false);
  check(
    idle25[0] === idle6[0] && idle25[3] * a25[0].c === idle6[3] * a6[0].c,
    "same isolated tap is equally bright at Length 25 ms and 6 s",
  );
  // Two sub-pixel taps in one pixel still both contribute full coverage (additive burst).
  const pA = spans(10.1, 10.2, 1);
  const pB = spans(10.6, 10.8, 1);
  check(pA[0].p === pB[0].p && pA[0].c === 1 && pB[0].c === 1, "two sub-pixel taps in the same pixel both have full coverage to add");
}

if (failed) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log("all tap-level checks passed");
