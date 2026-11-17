// Dark Velvet Reverb display levels: peak-hold of |width-filtered pulse
// x gain x table norm| per tap, L and R, taken by soemdsp_velvet_reverb_take_levels.
// The face treats a peak above NODE_GRAPH_VELVET_TAP_TRIGGER_LEVEL (-90 dB)
// as a binary trigger and latches it until one bright frame is drawn.
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
    this.nodeGraphVelvetTapsEnsureTriggers = nodeGraphVelvetTapsEnsureTriggers;
    this.nodeGraphVelvetTapsArmTriggers = nodeGraphVelvetTapsArmTriggers;
    this.nodeGraphVelvetTapsConsumeTriggers = nodeGraphVelvetTapsConsumeTriggers;
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

// ---- One-frame latch (face helpers): at least one bright consume per trigger
{
  const state = latch.nodeGraphVelvetTapsTriggerState("latch-test");
  const n = 3;
  const tL = latch.nodeGraphVelvetTapsEnsureTriggers(state, "triggeredL", n);
  const tR = latch.nodeGraphVelvetTapsEnsureTriggers(state, "triggeredR", n);

  latch.nodeGraphVelvetTapsArmTriggers(tL, [0, TRIGGER * 2, TRIGGER * 0.5]);
  check(tL[0] === 0 && tL[1] === 1 && tL[2] === 0, "arm: only peaks above -90 dB set the latch");

  const first = latch.nodeGraphVelvetTapsConsumeTriggers(tL);
  check(first[1] === 1 && first[0] === 0, "consume: triggered tap is on for this frame");
  check(tL[0] === 0 && tL[1] === 0 && tL[2] === 0, "consume: latch clears after the bright frame");
  const second = latch.nodeGraphVelvetTapsConsumeTriggers(tL);
  check(second[1] === 0, "second consume without a new snapshot stays off");

  // Snapshots faster than draws: two arms, then one consume still bright once
  latch.nodeGraphVelvetTapsArmTriggers(tL, [TRIGGER * 2, 0, 0]);
  latch.nodeGraphVelvetTapsArmTriggers(tL, [0, 0, 0]); // later silent snapshot must not clear the latch
  const held = latch.nodeGraphVelvetTapsConsumeTriggers(tL);
  check(held[0] === 1, "latch holds across a later empty snapshot until it is drawn");
  const after = latch.nodeGraphVelvetTapsConsumeTriggers(tL);
  check(after[0] === 0, "after the guaranteed bright frame the tap goes idle");

  // Draws faster than snapshots: TakeLit fallback arms once per new array identity
  const snap = new Float32Array([0, TRIGGER * 2, 0]);
  const litA = latch.nodeGraphVelvetTapsTakeLit("bus-fallback", snap, null, 3, 0, true);
  const litB = latch.nodeGraphVelvetTapsTakeLit("bus-fallback", snap, null, 3, 0, true);
  check(litA.onL[1] === 1, "draw-time fallback: first paint of a new snapshot is bright");
  check(litB.onL[1] === 0, "draw-time fallback: the same snapshot does not retrigger the next paint");
  const snap2 = new Float32Array([0, TRIGGER * 2, 0]);
  const litC = latch.nodeGraphVelvetTapsTakeLit("bus-fallback", snap2, null, 3, 0, true);
  check(litC.onL[1] === 1, "draw-time fallback: a new snapshot identity can trigger again");

  // L/R independent latch
  latch.nodeGraphVelvetTapsArmTriggers(tL, [TRIGGER * 2, 0, 0]);
  latch.nodeGraphVelvetTapsArmTriggers(tR, [0, TRIGGER * 2, 0]);
  const sides = {
    L: latch.nodeGraphVelvetTapsConsumeTriggers(tL),
    R: latch.nodeGraphVelvetTapsConsumeTriggers(tR),
  };
  check(sides.L[0] === 1 && sides.L[1] === 0, "latch L is independent of R");
  check(sides.R[1] === 1 && sides.R[0] === 0, "latch R is independent of L");
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
  let s = spans(0.25, 0.75);
  check(s.length === 1 && s[0].p === 0 && s[0].w === 1 && Math.abs(s[0].c - 0.5) < 1e-12, `sub-pixel width 0.5 is a 1 px bar with alpha 0.5 (${compact(s)})`);
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
}

if (failed) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log("all tap-level checks passed");
